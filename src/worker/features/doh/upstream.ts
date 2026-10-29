import {
  buildResponse,
  cacheTtl,
  clampTtls,
  type ClientSubnet,
  decrementTtls,
  dnssecOk,
  Flag,
  hasFlag,
  type Message,
  parseMessage,
  Rcode,
  rcodeOf,
  subnetOptedOut,
  subnetText,
  withClientSubnet,
  withId,
} from "#dns";
import type { UpstreamMode } from "../settings/store.ts";

export const DNS_MESSAGE = "application/dns-message";
const STORED_AT = "x-cf-dns-stored-at";

export interface UpstreamConfig {
  upstreams: string[];
  mode: UpstreamMode;
  timeoutMs: number;
  cache: CacheConfig;
  /** Sent upstream as EDNS Client Subnet; answers are then cached per subnet */
  subnet?: ClientSubnet | undefined;
}

export interface CacheConfig {
  enabled: boolean;
  /** Bounds for upstream TTLs, applied to the cached copy and the answer alike */
  minTtl: number;
  maxTtl: number;
}

export interface Resolution {
  response: Uint8Array;
  source: "cache" | "upstream" | "error";
  /** Upstream that produced the answer, when it came from the network */
  upstream?: string;
  /** Seconds the response may be cached by the client, when cacheable */
  ttl?: number;
}

/**
 * Answers `query` from the colo-local Cache API when possible, otherwise from the first
 * healthy upstream. Never throws: total failure becomes a SERVFAIL response
 */
export async function resolve(
  query: Message,
  raw: Uint8Array,
  config: UpstreamConfig,
  ctx: Pick<ExecutionContext, "waitUntil">,
): Promise<Resolution> {
  const { cache } = config;
  const subnet = config.subnet && !subnetOptedOut(query) ? config.subnet : undefined;
  const key = cacheKey(query, config.upstreams, subnet);
  if (cache.enabled) {
    const cached = await readCache(key, query, raw);
    if (cached) return cached;
  }

  const sent = subnet ? withClientSubnet(raw, query, subnet) : raw;
  const result = config.mode === "parallel" ? await fetchParallel(sent, config) : await fetchUpstreams(sent, config);
  if (!result) {
    return { response: buildResponse(query, raw, { rcode: Rcode.SERVFAIL }), source: "error" };
  }

  let body = result.body;
  const ttl = cacheableTtl(result.message, cache);
  if (ttl !== undefined) {
    body = clampTtls(body, result.message, cache.minTtl, cache.maxTtl);
    ctx.waitUntil(writeCache(key, body, ttl));
  }
  return { response: withId(body, query.header.id), source: "upstream", upstream: result.upstream, ttl };
}

interface UpstreamAnswer {
  body: Uint8Array;
  message: Message;
  upstream: string;
}

async function fetchUpstreams(raw: Uint8Array, config: UpstreamConfig): Promise<UpstreamAnswer | undefined> {
  // ID 0 is recommended for DoH so identical queries are byte-identical (RFC 8484 section 4.1)
  const body = withId(raw, 0);
  let fallback: UpstreamAnswer | undefined;

  for (const upstream of config.upstreams) {
    const answer = await fetchUpstream(upstream, body, config.timeoutMs);
    if (!answer) continue;
    if (rcodeOf(answer.message.header) !== Rcode.SERVFAIL) return answer;
    fallback ??= answer;
  }
  return fallback;
}

/** Asks every upstream at once; the first answer that is not SERVFAIL wins and the rest are cancelled */
async function fetchParallel(raw: Uint8Array, config: UpstreamConfig): Promise<UpstreamAnswer | undefined> {
  const body = withId(raw, 0);
  const losers = new AbortController();
  const attempts = config.upstreams.map((upstream) => fetchUpstream(upstream, body, config.timeoutMs, losers.signal));
  try {
    const winner = await Promise.any(
      attempts.map(async (attempt) => {
        const answer = await attempt;
        if (!answer || rcodeOf(answer.message.header) === Rcode.SERVFAIL) throw new Error("no usable answer");
        return answer;
      }),
    );
    losers.abort();
    return winner;
  } catch {
    // Every upstream failed or said SERVFAIL; pass a SERVFAIL on rather than inventing one
    return (await Promise.all(attempts)).find(Boolean);
  }
}

async function fetchUpstream(upstream: string, body: Uint8Array, timeoutMs: number, cancel?: AbortSignal): Promise<UpstreamAnswer | undefined> {
  try {
    const timeout = AbortSignal.timeout(timeoutMs);
    const res = await fetch(upstream, {
      method: "POST",
      headers: { "content-type": DNS_MESSAGE, accept: DNS_MESSAGE },
      body,
      signal: cancel ? AbortSignal.any([timeout, cancel]) : timeout,
    });
    if (!res.ok || !res.headers.get("content-type")?.startsWith(DNS_MESSAGE)) {
      console.warn("upstream rejected query", { upstream, status: res.status });
      return undefined;
    }
    const answer = new Uint8Array(await res.arrayBuffer());
    const message = parseMessage(answer);
    if (!hasFlag(message.header, Flag.QR) || message.header.id !== 0) {
      console.warn("upstream returned a mismatched message", { upstream });
      return undefined;
    }
    return { body: answer, message, upstream };
  } catch (err) {
    if (!cancel?.aborted) console.warn("upstream failed", { upstream, error: String(err) });
    return undefined;
  }
}

/** Seconds to keep the answer, already within the configured bounds; undefined when it must not be cached */
function cacheableTtl(msg: Message, cache: CacheConfig): number | undefined {
  if (!cache.enabled) return undefined;
  const rcode = rcodeOf(msg.header);
  if (rcode !== Rcode.NOERROR && rcode !== Rcode.NXDOMAIN) return undefined;
  if (hasFlag(msg.header, Flag.TC)) return undefined;
  const ttl = cacheTtl(msg);
  if (ttl === undefined) return undefined;
  const bounded = Math.min(cache.maxTtl, Math.max(cache.minTtl, ttl));
  return bounded > 0 ? bounded : undefined;
}

/**
 * Profiles and split-DNS routes send the same name to different upstreams, whose answers differ
 * (e.g. domestic versus overseas CDN nodes), so the upstream set is part of the key
 */
function cacheKey(query: Message, upstreams: string[], subnet: ClientSubnet | undefined): string {
  const q = query.questions[0]!;
  const params = new URLSearchParams({
    do: dnssecOk(query) ? "1" : "0",
    cd: hasFlag(query.header, Flag.CD) ? "1" : "0",
    up: upstreams.join(" "),
  });
  // Answers differ per subnet, and must never leak to clients the upstream did not tailor them for
  if (subnet) params.set("ecs", subnetText(subnet));
  return `https://cf-dns.cache/v1/${q.class}/${q.type}/${encodeURIComponent(q.name.toLowerCase())}?${params}`;
}

async function readCache(key: string, query: Message, raw: Uint8Array): Promise<Resolution | undefined> {
  const hit = await caches.default.match(key);
  if (!hit) return undefined;

  // Entries are written only after the upstream answer parsed, so reading them back cannot fail
  const elapsed = Math.floor((Date.now() - Number(hit.headers.get(STORED_AT))) / 1000);
  const body = new Uint8Array(await hit.arrayBuffer());
  const cached = parseMessage(body);
  const ttl = cacheTtl(cached);
  if (ttl === undefined || ttl - elapsed <= 0) return undefined;

  const aged = decrementTtls(body, cached, elapsed);
  // Echo the client's own question bytes so its letter case (0x20 randomisation) round-trips
  if (cached.questionEnd === query.questionEnd) aged.set(raw.subarray(12, query.questionEnd), 12);
  return { response: withId(aged, query.header.id), source: "cache", ttl: ttl - elapsed };
}

async function writeCache(key: string, body: Uint8Array, ttl: number): Promise<void> {
  const res = new Response(body, {
    headers: {
      "content-type": DNS_MESSAGE,
      "cache-control": `max-age=${ttl}`,
      [STORED_AT]: String(Date.now()),
    },
  });
  await caches.default.put(key, res);
}
