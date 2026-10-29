import {
  buildResponse,
  clientSubnet,
  decodeBase64Url,
  DnsParseError,
  HEADER_SIZE,
  isResponse,
  MAX_MESSAGE_SIZE,
  type Message,
  OPCODE_QUERY,
  opcodeOf,
  parseMessage,
  Rcode,
  RRType,
} from "#dns";
import type { Inspection, Verdict } from "#filter";
import { HttpError, readBody } from "../../shared/http.ts";
import { getRuntimeConfig, type RuntimeConfig } from "../../shared/runtime-config.ts";
import { admitClient } from "../devices/client-guard.ts";
import { type Device, findDevice } from "../devices/store.ts";
import { getProfile, type Profile, SERVICE_LIST_PREFIX } from "../profiles/store.ts";
import { getSettings, type Settings } from "../settings/store.ts";
import { clientLabel } from "../stats/client.ts";
import { recordQuery } from "../stats/record.ts";
import type { AnswerSource } from "../stats/schema.ts";
import { type AnswerConfig, blockedResponse, rewriteResponse } from "./answers.ts";
import { decide } from "./decide.ts";
import { forcedDomains, injectHttps } from "./https-inject.ts";
import { DNS_MESSAGE, resolve } from "./upstream.ts";

type WaitUntil = Pick<ExecutionContext, "waitUntil">;

/** RFC 8484 endpoint: GET with `?dns=` or POST with an `application/dns-message` body */
export async function handleDoh(request: Request, env: Env, ctx: WaitUntil, deviceId: string): Promise<Response> {
  const started = Date.now();
  const device = await findDevice(env, deviceId);
  if (!device) return new Response("unknown device", { status: 404 });

  const raw = await readQuery(request);
  if (raw instanceof Response) return raw;

  let query: Message;
  try {
    query = parseMessage(raw);
  } catch (err) {
    if (err instanceof DnsParseError) return new Response(`malformed DNS message: ${err.message}`, { status: 400 });
    throw err;
  }

  if (isResponse(query.header) || opcodeOf(query.header) !== OPCODE_QUERY) {
    return dnsResponse(buildResponse(query, raw, { rcode: Rcode.NOTIMP }));
  }
  if (query.questions.length !== 1) {
    return dnsResponse(buildResponse(query, raw, { rcode: Rcode.FORMERR }));
  }

  const [settings, profile, runtime] = await Promise.all([getSettings(env), getProfile(env, device.profileId), getRuntimeConfig(env)]);
  const question = query.questions[0]!;
  const name = question.name.toLowerCase();
  const ip = request.headers.get("cf-connecting-ip");
  const result = await answer({ env, ctx, query, raw, device, settings, profile, runtime, name, type: question.type, ip, now: started });

  if (settings.queryLogEnabled) logQuery(env, request, { device, name, type: question.type, started }, result);
  return dnsResponse(result.response, result.ttl);
}

interface Answer {
  response: Uint8Array;
  source: AnswerSource;
  ttl?: number | undefined;
  upstream?: string | undefined;
}

interface Answered extends Answer {
  verdict: Verdict;
  inspection?: Inspection | undefined;
}

interface QueryContext {
  env: Env;
  ctx: WaitUntil;
  query: Message;
  raw: Uint8Array;
  device: Device;
  settings: Settings;
  profile: Profile;
  runtime: RuntimeConfig;
  name: string;
  type: number;
  ip: string | null;
  now: number;
}

/** Client limit, then the verdict, then the answer it calls for, with HTTPS records edited last */
async function answer(q: QueryContext): Promise<Answered> {
  const { env, ctx, query, raw, device, settings, profile, runtime, ip } = q;
  const limit = { maxClients: settings.maxDeviceClients, windowMs: settings.deviceClientWindowMinutes * 60_000 };
  if (!(await admitClient(env, device.id, ip, limit))) {
    return { response: buildResponse(query, raw, { rcode: Rcode.REFUSED }), source: "limited", verdict: { action: "pass" } };
  }

  const { verdict, inspection, ipv6Off } = await decide(env, { device, profile, settings, records: runtime.records, name: q.name, type: q.type, ip, now: q.now });
  if (ipv6Off) {
    // Clients fall back to IPv4 on an empty answer, without the delay an error would cause
    return { response: buildResponse(query, raw, { rcode: Rcode.NOERROR }), source: "local", ttl: settings.blockedTtl, verdict, inspection };
  }

  const routed = profile.splitDns && inspection?.route ? runtime.routes[inspection.route] : undefined;
  const config = answerConfig(settings, profile, routed, ip);
  let result = await answerQuery(query, raw, verdict, config, ctx);
  if (q.type === RRType.HTTPS && (profile.ech || profile.h3) && verdict.action === "pass" && result.source !== "error") {
    const opts = { ech: profile.ech, h3: profile.h3, forced: forcedDomains(settings) };
    const injected = await injectHttps(query, raw, result.response, opts, config.upstream, env.RULES, ctx).catch((err: unknown) => {
      console.warn("HTTPS record injection failed", String(err));
      return undefined;
    });
    // The edited records may live shorter than the upstream answer, e.g. a long negative TTL
    if (injected) result = { ...result, response: injected.response, ttl: Math.min(result.ttl ?? injected.ttl, injected.ttl) };
  }
  return { ...result, verdict, inspection };
}

function logQuery(env: Env, request: Request, q: { device: Device; name: string; type: number; started: number }, result: Answered): void {
  const { verdict, inspection } = result;
  const cf = request.cf as { colo?: string; asn?: number; asOrganization?: string } | undefined;
  const service = inspection?.service?.slice(SERVICE_LIST_PREFIX.length);
  recordQuery(env.QUERY_LOG, {
    deviceId: q.device.id,
    deviceName: q.device.name,
    name: q.name,
    type: q.type,
    action: verdict.action,
    source: result.source,
    response: result.response,
    ...("rule" in verdict && { rule: verdict.rule }),
    ...(result.upstream && { upstream: result.upstream }),
    ...(cf?.colo && { colo: cf.colo }),
    client: clientLabel(request.headers.get("user-agent")),
    ...(service && { service }),
    ...(cf?.asOrganization && { network: cf.asOrganization }),
    ...(cf?.asn && { asn: cf.asn }),
    latencyMs: Date.now() - q.started,
  });
}

async function answerQuery(query: Message, raw: Uint8Array, verdict: Verdict, config: AnswerConfig, ctx: WaitUntil): Promise<Answer> {
  switch (verdict.action) {
    case "block":
      return { response: blockedResponse(query, raw, config), source: "local", ttl: config.ttl };
    case "rewrite":
      return { response: await rewriteResponse(query, raw, verdict, config, ctx), source: "local", ttl: config.ttl };
    default:
      return resolve(query, raw, config.upstream, ctx);
  }
}

function answerConfig(settings: Settings, profile: Profile, routed: string[] | undefined, ip: string | null): AnswerConfig {
  const upstreams = routed && routed.length > 0 ? routed : (profile.upstreams ?? settings.upstreams);
  return {
    blockingMode: profile.blockingMode ?? settings.blockingMode,
    blockingIpv4: settings.blockingIpv4,
    blockingIpv6: settings.blockingIpv6,
    ttl: settings.blockedTtl,
    upstream: {
      upstreams,
      mode: settings.upstreamMode,
      timeoutMs: settings.upstreamTimeoutMs,
      cache: { enabled: settings.cacheEnabled, minTtl: settings.cacheMinTtl, maxTtl: settings.cacheMaxTtl },
      subnet: profile.ecs && ip ? clientSubnet(ip) : undefined,
    },
  };
}

async function readQuery(request: Request): Promise<Uint8Array | Response> {
  let raw: Uint8Array;
  if (request.method === "GET") {
    const param = new URL(request.url).searchParams.get("dns");
    if (!param) return new Response("missing dns parameter", { status: 400 });
    try {
      raw = decodeBase64Url(param);
    } catch {
      return new Response("invalid dns parameter", { status: 400 });
    }
  } else if (request.method === "POST") {
    if (!request.headers.get("content-type")?.startsWith(DNS_MESSAGE)) {
      return new Response(`expected ${DNS_MESSAGE}`, { status: 415 });
    }
    try {
      // DoH is reachable without Access, so a chunked body must not be buffered past the DNS limit
      raw = await readBody(request, MAX_MESSAGE_SIZE);
    } catch (err) {
      if (err instanceof HttpError) return new Response("message too large", { status: 413 });
      throw err;
    }
  } else {
    return new Response("method not allowed", { status: 405, headers: { allow: "GET, POST" } });
  }

  if (raw.length < HEADER_SIZE) return new Response("message too short", { status: 400 });
  if (raw.length > MAX_MESSAGE_SIZE) return new Response("message too large", { status: 413 });
  return raw;
}

function dnsResponse(body: Uint8Array, ttl?: number): Response {
  return new Response(body, {
    headers: {
      "content-type": DNS_MESSAGE,
      // Per-device endpoints must not be shared by intermediaries
      "cache-control": ttl !== undefined ? `private, max-age=${ttl}` : "no-store",
    },
  });
}
