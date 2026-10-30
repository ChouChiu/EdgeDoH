import {
  type AnswerRecord,
  buildQuery,
  buildResponse,
  decodeAlpn,
  decodeBase64Url,
  dnssecOk,
  encodeAlpn,
  encodeBase64Url,
  encodeName,
  encodeSvcb,
  type Message,
  parseMessage,
  parseSvcb,
  Rcode,
  rcodeOf,
  readName,
  type ResourceRecord,
  RRType,
  SvcParam,
  type Svcb,
  splitHints,
} from "#dns";
import type { Settings } from "../settings/store.ts";
import { copyAnswers } from "./answers.ts";
import { inRanges, parseRanges } from "./ranges.ts";
import { resolve, type UpstreamConfig } from "./upstream.ts";

/** Cloudflare's client-facing ECH server; its HTTPS record carries the ECH config every proxied zone shares */
const ECH_SOURCE = "cloudflare-ech.com";
/** Upper bound for synthesised records and the in-memory ECH config, so key rotations are picked up */
const MAX_TTL = 300;
/** Last good ECH config, shared by isolates so a cold one can inject while the source lookup fails */
const ECH_KEY = "ech:config";
/** How long a config read back from KV, or kept after a failed refresh, is served before the next attempt */
const ECH_RETRY_MS = 60_000;
/** Bounds the CNAME chain walk, so a looping chain cannot spin */
const MAX_CHAIN = 8;

/** https://www.cloudflare.com/ips/ */
const CLOUDFLARE_RANGES = parseRanges([
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
]);

export function isCloudflareAddress(address: Uint8Array): boolean {
  return inRanges(address, CLOUDFLARE_RANGES);
}

const forcedSets = new WeakMap<Settings, Set<string>>();

/** Settings objects are rebuilt only when the runtime config changes, so the set is kept with them */
export function forcedDomains(settings: Settings): Set<string> {
  let forced = forcedSets.get(settings);
  if (!forced) {
    forced = new Set(settings.echForcedDomains);
    forcedSets.set(settings, forced);
  }
  return forced;
}

/** The name or one of its parent domains is in the forced list */
function isForced(forced: Set<string>, name: string): boolean {
  if (forced.size === 0) return false;
  for (let suffix = name; ; suffix = suffix.slice(suffix.indexOf(".") + 1)) {
    if (forced.has(suffix)) return true;
    if (!suffix.includes(".")) return false;
  }
}

export interface InjectOptions {
  ech: boolean;
  h3: boolean;
  /** Names handled as Cloudflare-proxied whatever the upstream answers */
  forced: Set<string>;
}

/**
 * For HTTPS queries about Cloudflare-proxied names (judged at the end of any CNAME chain, or
 * forced by name): adds `h3` to the ALPN set and Cloudflare's shared ECH config to the existing
 * ServiceMode records, or synthesises one when the zone publishes none, together with the TTL
 * clients may keep it. Returns undefined when nothing
 * applies, leaving the upstream answer untouched.
 * DNSSEC-aware clients are skipped, since edited records would no longer validate
 */
export async function injectHttps(
  query: Message,
  raw: Uint8Array,
  response: Uint8Array,
  opts: InjectOptions,
  upstream: UpstreamConfig,
  kv: KVNamespace,
  ctx: Pick<ExecutionContext, "waitUntil">,
): Promise<{ response: Uint8Array; ttl: number } | undefined> {
  if (dnssecOk(query)) return undefined;
  const msg = parseMessage(response);
  if (rcodeOf(msg.header) !== Rcode.NOERROR) return undefined;
  const name = query.questions[0]!.name;

  let owner: string;
  const records: { ttl: number; svcb: Svcb }[] = [];
  try {
    owner = chainEnd(response, msg.answers, name);
    for (const rr of msg.answers) {
      if (rr.type === RRType.HTTPS && rr.name.toLowerCase() === owner) records.push({ ttl: rr.ttl, svcb: parseSvcb(rr.data) });
    }
  } catch {
    return undefined;
  }
  const forced = isForced(opts.forced, name.toLowerCase()) || isForced(opts.forced, owner);

  const hints = records.flatMap(({ svcb }) => [
    ...splitHints(svcb.params.get(SvcParam.IPV4HINT) ?? new Uint8Array(0), 4),
    ...splitHints(svcb.params.get(SvcParam.IPV6HINT) ?? new Uint8Array(0), 16),
  ]);
  // Started alongside the address lookup: the two are independent, and the config is memoised anyway
  const echConfig = opts.ech ? cloudflareEch(kv, upstream, ctx) : Promise.resolve(undefined);
  let ttl = Math.min(MAX_TTL, ...records.map((r) => r.ttl));
  let addresses = hints;
  // A forced name needs no proof it is on Cloudflare, so the lookup is spared
  if (addresses.length === 0 && !forced) {
    const lookup = await lookupA(name, upstream, ctx);
    addresses = lookup.addresses;
    ttl = Math.min(ttl, lookup.ttl);
  }
  if (!forced && (addresses.length === 0 || !addresses.every(isCloudflareAddress))) return undefined;

  const ech = await echConfig;
  const ownerName = owner === name.toLowerCase() ? undefined : encodeName(owner);
  let changed = false;
  const answers: AnswerRecord[] = [];

  if (records.some((r) => r.svcb.priority > 0)) {
    for (const { ttl: recordTtl, svcb } of records) {
      if (svcb.priority > 0) changed = augment(svcb, opts.h3, ech) || changed;
      answers.push({ name: ownerName, type: RRType.HTTPS, ttl: recordTtl, data: encodeSvcb(svcb) });
    }
  } else if (records.length === 0) {
    const params = new Map<number, Uint8Array>([[SvcParam.ALPN, encodeAlpn(opts.h3 ? ["h3", "h2"] : ["h2"])]]);
    const v4 = addresses.filter((a) => a.length === 4);
    if (v4.length > 0) params.set(SvcParam.IPV4HINT, concat(v4));
    if (ech) params.set(SvcParam.ECH, ech);
    answers.push({ name: ownerName, type: RRType.HTTPS, ttl, data: encodeSvcb({ priority: 1, target: "", params }) });
    changed = true;
  }
  if (!changed) return undefined;
  if (ownerName) answers.unshift(...cnames(response, msg));
  return { response: buildResponse(query, raw, { rcode: Rcode.NOERROR, answers }), ttl: Math.min(ttl, ...answers.map((a) => a.ttl)) };
}

/** Owner name, lowercased, of the records at the end of the CNAME chain that starts at `name` */
function chainEnd(buf: Uint8Array, answers: ResourceRecord[], name: string): string {
  let owner = name.toLowerCase();
  for (let hops = 0; hops < MAX_CHAIN; hops++) {
    const cname = answers.find((rr) => rr.type === RRType.CNAME && rr.name.toLowerCase() === owner);
    if (!cname) break;
    owner = readName(buf, cname.data.byteOffset - buf.byteOffset).name.toLowerCase();
  }
  return owner;
}

function cnames(buf: Uint8Array, msg: Message): AnswerRecord[] {
  return copyAnswers(buf, msg).filter((a) => a.type === RRType.CNAME);
}

/** Adds what is missing; never removes anything the zone published */
function augment(svcb: Svcb, h3: boolean, ech: Uint8Array | undefined): boolean {
  let changed = false;
  if (h3) {
    const alpn = decodeAlpn(svcb.params.get(SvcParam.ALPN) ?? new Uint8Array(0));
    if (!alpn.includes("h3")) {
      svcb.params.set(SvcParam.ALPN, encodeAlpn(["h3", ...(alpn.length > 0 ? alpn : ["h2"])]));
      changed = true;
    }
  }
  if (ech && !svcb.params.has(SvcParam.ECH)) {
    svcb.params.set(SvcParam.ECH, ech);
    changed = true;
  }
  return changed;
}

async function lookupA(name: string, upstream: UpstreamConfig, ctx: Pick<ExecutionContext, "waitUntil">) {
  const raw = buildQuery(name, RRType.A);
  const { response } = await resolve(parseMessage(raw), raw, upstream, ctx);
  const msg = parseMessage(response);
  const a = msg.answers.filter((rr) => rr.type === RRType.A);
  return { addresses: a.map((rr) => rr.data), ttl: Math.min(MAX_TTL, ...a.map((rr) => rr.ttl)) };
}

let echMemo: { config: Uint8Array; expires: number } | undefined;
let echRefresh: Promise<Uint8Array | undefined> | undefined;
/** Value this isolate last wrote to or read from KV, so an unchanged config is not written again */
let echStored: string | undefined;

/**
 * Cloudflare's ECH config: memoised, refreshed in the background once stale (clients holding an
 * outdated one get the current one through the ECH retry mechanism), and read back from KV when
 * the source cannot be resolved
 */
function cloudflareEch(kv: KVNamespace, upstream: UpstreamConfig, ctx: Pick<ExecutionContext, "waitUntil">): Promise<Uint8Array | undefined> {
  if (echMemo && echMemo.expires > Date.now()) return Promise.resolve(echMemo.config);
  echRefresh ??= refreshEch(kv, upstream, ctx).finally(() => {
    echRefresh = undefined;
  });
  if (!echMemo) return echRefresh;
  ctx.waitUntil(echRefresh);
  return Promise.resolve(echMemo.config);
}

async function refreshEch(kv: KVNamespace, upstream: UpstreamConfig, ctx: Pick<ExecutionContext, "waitUntil">): Promise<Uint8Array | undefined> {
  const fetched = await fetchEch(upstream, ctx).catch((err: unknown) => {
    console.warn("ECH source lookup failed", String(err));
    return undefined;
  });
  if (fetched) {
    echMemo = { config: fetched.config, expires: Date.now() + fetched.ttl * 1000 };
    const encoded = encodeBase64Url(fetched.config);
    if (encoded !== echStored) {
      echStored = encoded;
      ctx.waitUntil(persistEch(kv, encoded));
    }
    return fetched.config;
  }
  if (!echMemo) {
    const stored = await kv.get(ECH_KEY, { cacheTtl: MAX_TTL }).catch(() => null);
    if (stored) {
      echStored = stored;
      echMemo = { config: decodeBase64Url(stored), expires: 0 };
    }
  }
  if (echMemo) echMemo.expires = Date.now() + ECH_RETRY_MS;
  return echMemo?.config;
}

async function persistEch(kv: KVNamespace, encoded: string): Promise<void> {
  try {
    // Other isolates have usually stored the same config already, and reads cost far less than writes
    if ((await kv.get(ECH_KEY)) !== encoded) await kv.put(ECH_KEY, encoded);
  } catch (err) {
    console.warn("storing the ECH config failed", String(err));
  }
}

async function fetchEch(upstream: UpstreamConfig, ctx: Pick<ExecutionContext, "waitUntil">): Promise<{ config: Uint8Array; ttl: number } | undefined> {
  const raw = buildQuery(ECH_SOURCE, RRType.HTTPS);
  // The ECH config is the same for everyone, so it is fetched without the client's subnet
  const { response } = await resolve(parseMessage(raw), raw, { ...upstream, subnet: undefined }, ctx);
  for (const rr of parseMessage(response).answers) {
    if (rr.type !== RRType.HTTPS) continue;
    const config = parseSvcb(rr.data).params.get(SvcParam.ECH);
    if (config) return { config: config.slice(), ttl: Math.min(MAX_TTL, rr.ttl) };
  }
  return undefined;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Test hook: forgets the memoised ECH config */
export function resetEchMemo(): void {
  echMemo = undefined;
  echStored = undefined;
}
