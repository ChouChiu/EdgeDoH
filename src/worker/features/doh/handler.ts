import {
  buildResponse,
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
import { match, type Verdict } from "#filter";
import { HttpError, readBody } from "../../shared/http.ts";
import { admitClient } from "../devices/client-guard.ts";
import { type Device, findDevice } from "../devices/store.ts";
import { ensureShards, getSnapshot } from "../rules/store.ts";
import { getSettings, type Settings } from "../settings/store.ts";
import { recordQuery } from "../stats/record.ts";
import type { AnswerSource } from "../stats/schema.ts";
import { type AnswerConfig, blockedResponse, rewriteResponse } from "./answers.ts";
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

  const settings = await getSettings(env);
  const question = query.questions[0]!;
  const config = answerConfig(settings);
  const ip = request.headers.get("cf-connecting-ip");
  let verdict: Verdict;
  let answer: Answer;
  const limit = { maxClients: settings.maxDeviceClients, windowMs: settings.deviceClientWindowMinutes * 60_000 };
  if (!(await admitClient(env, device.id, ip, limit))) {
    verdict = { action: "pass" };
    answer = { response: buildResponse(query, raw, { rcode: Rcode.REFUSED }), source: "limited" };
  } else if (settings.disableIpv6 && question.type === RRType.AAAA) {
    // Clients fall back to IPv4 on an empty answer, without the delay an error would cause
    verdict = { action: "pass" };
    answer = { response: buildResponse(query, raw, { rcode: Rcode.NOERROR }), source: "local", ttl: config.ttl };
  } else {
    verdict = settings.filteringEnabled ? await evaluate(env, query, device, ip) : { action: "pass" };
    answer = await answerQuery(query, raw, verdict, config, ctx);
  }

  if (!settings.queryLogEnabled) return dnsResponse(answer.response, answer.ttl);
  const colo = (request.cf as { colo?: string } | undefined)?.colo;
  recordQuery(env.QUERY_LOG, {
    deviceId: device.id,
    deviceName: device.name,
    name: question.name.toLowerCase(),
    type: question.type,
    action: verdict.action,
    source: answer.source,
    response: answer.response,
    ...("rule" in verdict && { rule: verdict.rule }),
    ...(answer.upstream && { upstream: answer.upstream }),
    ...(colo && { colo }),
    latencyMs: Date.now() - started,
  });
  return dnsResponse(answer.response, answer.ttl);
}

interface Answer {
  response: Uint8Array;
  source: AnswerSource;
  ttl?: number | undefined;
  upstream?: string | undefined;
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

async function evaluate(env: Env, query: Message, device: Device, ip: string | null): Promise<Verdict> {
  const loaded = await getSnapshot(env.RULES);
  if (!loaded) return { action: "pass" };
  const question = query.questions[0]!;
  const name = question.name.toLowerCase();
  await ensureShards(env.RULES, loaded, name);
  return match(loaded.snapshot, {
    name,
    type: question.type,
    client: { id: device.id, name: device.name, ...(ip && { ip }) },
  });
}

function answerConfig(settings: Settings): AnswerConfig {
  return {
    blockingMode: settings.blockingMode,
    blockingIpv4: settings.blockingIpv4,
    blockingIpv6: settings.blockingIpv6,
    ttl: settings.blockedTtl,
    upstream: {
      upstreams: settings.upstreams,
      mode: settings.upstreamMode,
      timeoutMs: settings.upstreamTimeoutMs,
      cache: { enabled: settings.cacheEnabled, minTtl: settings.cacheMinTtl, maxTtl: settings.cacheMaxTtl },
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
