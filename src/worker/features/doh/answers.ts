import {
  type AnswerRecord,
  buildQuery,
  buildResponse,
  encodeIPv4,
  encodeIPv6,
  encodeName,
  hasFlag,
  Flag,
  type Message,
  parseMessage,
  Rcode,
  rcodeOf,
  readName,
  RRType,
} from "#dns";
import type { Verdict } from "#filter";
import type { BlockingMode } from "../settings/store.ts";
import { resolve, type UpstreamConfig } from "./upstream.ts";

export interface AnswerConfig {
  blockingMode: BlockingMode;
  /** Used by `custom_ip`; empty answers that family with no records */
  blockingIpv4: string;
  blockingIpv6: string;
  /** TTL of locally generated answers */
  ttl: number;
  upstream: UpstreamConfig;
}

/** Answer for a blocked name, shaped by the configured blocking mode */
export function blockedResponse(query: Message, raw: Uint8Array, config: AnswerConfig): Uint8Array {
  const type = query.questions[0]!.type;
  switch (config.blockingMode) {
    case "nxdomain":
      return buildResponse(query, raw, { rcode: Rcode.NXDOMAIN });
    case "refused":
      return buildResponse(query, raw, { rcode: Rcode.REFUSED });
    case "nodata":
      return buildResponse(query, raw, { rcode: Rcode.NOERROR });
    case "null_ip":
    case "custom_ip": {
      const [v4, v6] = config.blockingMode === "null_ip" ? ["0.0.0.0", "::"] : [config.blockingIpv4, config.blockingIpv6];
      const data = type === RRType.A && v4 ? encodeIPv4(v4) : type === RRType.AAAA && v6 ? encodeIPv6(v6) : undefined;
      return buildResponse(query, raw, { rcode: Rcode.NOERROR, answers: data ? [{ type, ttl: config.ttl, data }] : [] });
    }
  }
}

/**
 * Answer for a `$dnsrewrite` or hosts rewrite. A CNAME rewrite is followed upstream, like
 * AdGuard Home does, so stub resolvers that do not chase CNAMEs still get addresses
 */
export async function rewriteResponse(
  query: Message,
  raw: Uint8Array,
  verdict: Extract<Verdict, { action: "rewrite" }>,
  config: AnswerConfig,
  ctx: Pick<ExecutionContext, "waitUntil">,
): Promise<Uint8Array> {
  if (verdict.rcode !== Rcode.NOERROR) return buildResponse(query, raw, { rcode: verdict.rcode });

  const cname = verdict.records.find((r) => r.type === RRType.CNAME);
  if (!cname) {
    const answers = verdict.records.map((r) => ({
      type: r.type,
      ttl: config.ttl,
      data: r.type === RRType.A ? encodeIPv4(r.value) : encodeIPv6(r.value),
    }));
    return buildResponse(query, raw, { rcode: Rcode.NOERROR, answers });
  }

  const answers: AnswerRecord[] = [{ type: RRType.CNAME, ttl: config.ttl, data: encodeName(cname.value) }];
  const qtype = query.questions[0]!.type;
  let rcode: number = Rcode.NOERROR;
  if (qtype !== RRType.CNAME) {
    const targetRaw = buildQuery(cname.value, qtype, { recursionDesired: hasFlag(query.header, Flag.RD) });
    const target = await resolve(parseMessage(targetRaw), targetRaw, config.upstream, ctx);
    const parsed = parseMessage(target.response);
    if (rcodeOf(parsed.header) === Rcode.NXDOMAIN) rcode = Rcode.NXDOMAIN;
    answers.push(...copyAnswers(target.response, parsed));
  }
  return buildResponse(query, raw, { rcode, answers });
}

/**
 * Re-encodes upstream answers with explicit owner names. Only types whose RDATA never holds
 * compressed names are copied verbatim; CNAME targets are decompressed
 */
export function copyAnswers(buf: Uint8Array, msg: Message): AnswerRecord[] {
  const out: AnswerRecord[] = [];
  for (const rr of msg.answers) {
    try {
      const name = encodeName(rr.name);
      if (rr.type === RRType.CNAME) {
        const target = readName(buf, rr.data.byteOffset - buf.byteOffset).name;
        out.push({ name, type: rr.type, ttl: rr.ttl, data: encodeName(target) });
      } else if (VERBATIM_TYPES.has(rr.type)) {
        out.push({ name, type: rr.type, ttl: rr.ttl, data: rr.data });
      }
    } catch {
      // Names with escaped bytes cannot be re-encoded; drop the record rather than fail the answer
    }
  }
  return out;
}

const VERBATIM_TYPES = new Set<number>([RRType.A, RRType.AAAA, RRType.TXT, RRType.HTTPS, RRType.SVCB]);
