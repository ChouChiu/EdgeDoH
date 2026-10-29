import {
  type AnswerRecord,
  buildQuery,
  buildResponse,
  decodeAlpn,
  dnssecOk,
  encodeAlpn,
  encodeIPv4,
  encodeIPv6,
  encodeSvcb,
  type Message,
  parseMessage,
  parseSvcb,
  Rcode,
  rcodeOf,
  RRType,
  SvcParam,
  type Svcb,
  splitHints,
} from "#dns";
import { resolve, type UpstreamConfig } from "./upstream.ts";

/** Cloudflare's client-facing ECH server; its HTTPS record carries the ECH config every proxied zone shares */
const ECH_SOURCE = "cloudflare-ech.com";
/** Upper bound for synthesised records and the in-memory ECH config, so key rotations are picked up */
const MAX_TTL = 300;

/** https://www.cloudflare.com/ips/ */
const CLOUDFLARE_RANGES = [
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
].map((cidr) => {
  const [address, bits] = cidr.split("/") as [string, string];
  return { bytes: address.includes(":") ? encodeIPv6(address) : encodeIPv4(address), bits: Number(bits) };
});

export function isCloudflareAddress(address: Uint8Array): boolean {
  return CLOUDFLARE_RANGES.some(({ bytes, bits }) => {
    if (bytes.length !== address.length) return false;
    for (let i = 0; i * 8 < bits; i++) {
      const remaining = bits - i * 8;
      const mask = remaining >= 8 ? 0xff : (0xff << (8 - remaining)) & 0xff;
      if ((bytes[i]! & mask) !== (address[i]! & mask)) return false;
    }
    return true;
  });
}

export interface InjectOptions {
  ech: boolean;
  h3: boolean;
}

/**
 * For HTTPS queries about Cloudflare-proxied names: adds `h3` to the ALPN set and Cloudflare's
 * shared ECH config to the existing ServiceMode records, or synthesises one when the zone
 * publishes none, together with the TTL clients may keep it. Returns undefined when nothing applies,
 * leaving the upstream answer untouched.
 * DNSSEC-aware clients are skipped, since edited records would no longer validate
 */
export async function injectHttps(
  query: Message,
  raw: Uint8Array,
  response: Uint8Array,
  opts: InjectOptions,
  upstream: UpstreamConfig,
  ctx: Pick<ExecutionContext, "waitUntil">,
): Promise<{ response: Uint8Array; ttl: number } | undefined> {
  if (dnssecOk(query)) return undefined;
  const msg = parseMessage(response);
  if (rcodeOf(msg.header) !== Rcode.NOERROR || msg.answers.some((rr) => rr.type === RRType.CNAME)) return undefined;
  const name = query.questions[0]!.name;
  const lower = name.toLowerCase();

  const records: { ttl: number; svcb: Svcb }[] = [];
  try {
    for (const rr of msg.answers) {
      if (rr.type === RRType.HTTPS && rr.name.toLowerCase() === lower) records.push({ ttl: rr.ttl, svcb: parseSvcb(rr.data) });
    }
  } catch {
    return undefined;
  }

  const hints = records.flatMap(({ svcb }) => [
    ...splitHints(svcb.params.get(SvcParam.IPV4HINT) ?? new Uint8Array(0), 4),
    ...splitHints(svcb.params.get(SvcParam.IPV6HINT) ?? new Uint8Array(0), 16),
  ]);
  // Started alongside the address lookup: the two are independent, and the config is memoised anyway
  const echConfig = opts.ech ? cloudflareEch(upstream, ctx) : Promise.resolve(undefined);
  let ttl = Math.min(MAX_TTL, ...records.map((r) => r.ttl));
  let addresses = hints;
  if (addresses.length === 0) {
    const lookup = await lookupA(name, upstream, ctx);
    addresses = lookup.addresses;
    ttl = Math.min(ttl, lookup.ttl);
  }
  if (addresses.length === 0 || !addresses.every(isCloudflareAddress)) return undefined;

  const ech = await echConfig;
  const service = records.filter((r) => r.svcb.priority > 0);
  let changed = false;
  const answers: AnswerRecord[] = [];

  if (service.length > 0) {
    for (const { ttl: recordTtl, svcb } of records) {
      if (svcb.priority > 0) changed = augment(svcb, opts.h3, ech) || changed;
      answers.push({ type: RRType.HTTPS, ttl: recordTtl, data: encodeSvcb(svcb) });
    }
  } else if (records.length === 0) {
    const params = new Map<number, Uint8Array>([[SvcParam.ALPN, encodeAlpn(opts.h3 ? ["h3", "h2"] : ["h2"])]]);
    const v4 = addresses.filter((a) => a.length === 4);
    if (v4.length > 0) params.set(SvcParam.IPV4HINT, concat(v4));
    if (ech) params.set(SvcParam.ECH, ech);
    answers.push({ type: RRType.HTTPS, ttl, data: encodeSvcb({ priority: 1, target: "", params }) });
    changed = true;
  }
  if (!changed) return undefined;
  return { response: buildResponse(query, raw, { rcode: Rcode.NOERROR, answers }), ttl: Math.min(ttl, ...answers.map((a) => a.ttl)) };
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

async function cloudflareEch(upstream: UpstreamConfig, ctx: Pick<ExecutionContext, "waitUntil">): Promise<Uint8Array | undefined> {
  if (echMemo && echMemo.expires > Date.now()) return echMemo.config;
  const raw = buildQuery(ECH_SOURCE, RRType.HTTPS);
  // The ECH config is the same for everyone, so it is fetched without the client's subnet
  const { response } = await resolve(parseMessage(raw), raw, { ...upstream, subnet: undefined }, ctx);
  try {
    for (const rr of parseMessage(response).answers) {
      if (rr.type !== RRType.HTTPS) continue;
      const config = parseSvcb(rr.data).params.get(SvcParam.ECH);
      if (config) {
        echMemo = { config: config.slice(), expires: Date.now() + Math.min(MAX_TTL, rr.ttl) * 1000 };
        return echMemo.config;
      }
    }
  } catch (err) {
    console.warn("unreadable ECH source record", String(err));
  }
  return echMemo?.config;
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
