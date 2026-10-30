import type { StatsRange } from "#contract";
import { sha256Hex } from "../../shared/crypto.ts";
import { HttpError } from "../../shared/http.ts";
import { isDeviceId } from "../devices/store.ts";
import { ACTIONS, type AnswerSource, Column as C, type FilterAction, SOURCES } from "./schema.ts";

export interface StatsConfig {
  accountId: string;
  token: string;
  dataset: string;
}

export function statsConfig(env: Env): StatsConfig {
  const accountId = env.CF_ACCOUNT_ID;
  const token = env.STATS_API_TOKEN;
  const dataset = env.STATS_DATASET;
  if (!accountId || !token) throw new HttpError(503, "stats are not configured: set CF_ACCOUNT_ID and STATS_API_TOKEN");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(dataset)) throw new HttpError(503, "STATS_DATASET is not a valid table name");
  return { accountId, token, dataset };
}

/** Results are cached per colo, so a dashboard refresh does not spend another SQL read */
const CACHE_SECONDS = 60;

export async function runSql<T>(config: StatsConfig, sql: string): Promise<T[]> {
  const cacheKey = `https://edgedoh.cache/stats/${await sha256Hex(`${config.accountId}\n${sql}`)}`;
  const cached = await caches.default.match(cacheKey);
  if (cached) return cached.json<T[]>();

  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${config.accountId}/analytics_engine/sql`, {
    method: "POST",
    headers: { authorization: `Bearer ${config.token}` },
    body: `${sql} FORMAT JSON`,
  });
  if (!res.ok) {
    console.error("analytics engine query failed", { status: res.status, body: (await res.text()).slice(0, 500) });
    throw new HttpError(502, `analytics engine query failed with HTTP ${res.status}`);
  }
  const { data } = await res.json<{ data: T[] }>();
  await caches.default.put(
    cacheKey,
    new Response(JSON.stringify(data), { headers: { "content-type": "application/json", "cache-control": `max-age=${CACHE_SECONDS}` } }),
  );
  return data;
}

export const RANGES = {
  "1h": { span: "'1' HOUR", bucket: "'5' MINUTE", bucketMs: 5 * 60_000, spanMs: 3_600_000 },
  "24h": { span: "'24' HOUR", bucket: "'1' HOUR", bucketMs: 3_600_000, spanMs: 86_400_000 },
  "7d": { span: "'7' DAY", bucket: "'6' HOUR", bucketMs: 6 * 3_600_000, spanMs: 7 * 86_400_000 },
  "30d": { span: "'30' DAY", bucket: "'1' DAY", bucketMs: 86_400_000, spanMs: 30 * 86_400_000 },
} as const satisfies Record<StatsRange, unknown>;
export type Range = StatsRange;

export interface StatsFilter {
  range: Range;
  device?: string;
  action?: FilterAction;
  source?: AnswerSource;
  /** LIKE pattern built from a whitelisted search term */
  search?: string;
}

/**
 * Parses query-string filters. Every value is validated against a whitelist because the
 * SQL API takes plain query text without bind parameters
 */
export function parseFilter(params: URLSearchParams): StatsFilter {
  const range = params.get("range") ?? "24h";
  if (!Object.hasOwn(RANGES, range)) throw new HttpError(400, `range must be one of ${Object.keys(RANGES).join(", ")}`);
  const filter: StatsFilter = { range: range as Range };

  const device = params.get("device");
  if (device) {
    if (!isDeviceId(device)) throw new HttpError(400, "invalid device");
    filter.device = device;
  }
  const action = params.get("action");
  if (action) {
    if (!(ACTIONS as readonly string[]).includes(action)) throw new HttpError(400, `action must be one of ${ACTIONS.join(", ")}`);
    filter.action = action as FilterAction;
  }
  const source = params.get("source");
  if (source) {
    if (!(SOURCES as readonly string[]).includes(source)) throw new HttpError(400, `source must be one of ${SOURCES.join(", ")}`);
    filter.source = source as AnswerSource;
  }
  const search = params.get("search")?.trim().toLowerCase();
  if (search) {
    if (!/^[a-z0-9.*_-]{1,253}$/.test(search)) throw new HttpError(400, "search may only contain letters, digits, '.', '-', '_' and '*'");
    filter.search = search.includes("*") ? search.replaceAll("*", "%") : `%${search}%`;
  }
  return filter;
}

function where(f: StatsFilter, extra: string[] = []): string {
  const conditions = [`timestamp > NOW() - INTERVAL ${RANGES[f.range].span}`, ...extra];
  if (f.device) conditions.push(`${C.device} = '${f.device}'`);
  if (f.action) conditions.push(`${C.action} = '${f.action}'`);
  if (f.source) conditions.push(`${C.source} = '${f.source}'`);
  if (f.search) conditions.push(`${C.name} LIKE '${f.search}'`);
  return `WHERE ${conditions.join(" AND ")}`;
}

const N = "_sample_interval";

export function summarySql(table: string, f: StatsFilter): string {
  return `SELECT
  SUM(${N}) AS total,
  sumIf(${N}, ${C.action} = 'block') AS blocked,
  sumIf(${N}, ${C.action} = 'rewrite') AS rewritten,
  sumIf(${N}, ${C.action} = 'allow') AS allowlisted,
  sumIf(${N}, ${C.source} = 'cache') AS cached,
  sumIf(${N}, ${C.source} = 'error') AS failed,
  SUM(${N} * ${C.latency}) / SUM(${N}) AS avg_latency_ms
FROM ${table} ${where(f)}`;
}

export function timeseriesSql(table: string, f: StatsFilter): string {
  return `SELECT
  toStartOfInterval(timestamp, INTERVAL ${RANGES[f.range].bucket}) AS bucket,
  SUM(${N}) AS total,
  sumIf(${N}, ${C.action} = 'block') AS blocked
FROM ${table} ${where(f)}
GROUP BY bucket
ORDER BY bucket ASC`;
}

export const TOP_KINDS = {
  domains: { key: C.name, extra: [] },
  blocked: { key: C.name, extra: [`${C.action} = 'block'`] },
  devices: { key: C.device, extra: [] },
  rules: { key: C.rule, extra: [`${C.rule} != ''`] },
  lists: { key: C.list, extra: [`${C.list} != ''`] },
  upstreams: { key: C.upstream, extra: [`${C.upstream} != ''`] },
  services: { key: C.service, extra: [`${C.service} != ''`] },
  clients: { key: C.client, extra: [`${C.client} != ''`] },
  networks: { key: C.network, extra: [`${C.network} != ''`] },
} as const;
export type TopKind = keyof typeof TOP_KINDS;

export function topSql(table: string, f: StatsFilter, kind: TopKind, limit: number): string {
  const { key, extra } = TOP_KINDS[kind];
  const label = kind === "devices" ? `, argMax(${C.deviceName}, timestamp) AS label` : "";
  return `SELECT ${key} AS key${label}, SUM(${N}) AS count
FROM ${table} ${where(f, [...extra])}
GROUP BY key
ORDER BY count DESC
LIMIT ${limit}`;
}

export function logsSql(table: string, f: StatsFilter, limit: number, offset: number): string {
  return `SELECT timestamp, ${C.device} AS device, ${C.deviceName} AS device_name, ${C.name} AS name, ${C.type} AS type,
  ${C.action} AS action, ${C.source} AS source, ${C.rcode} AS rcode, ${C.rule} AS rule, ${C.list} AS list,
  ${C.ruleLine} AS line, ${C.upstream} AS upstream, ${C.client} AS client, ${C.service} AS service, ${C.network} AS network,
  ${C.latency} AS latency_ms, ${N} AS sample_interval
FROM ${table} ${where(f)}
ORDER BY timestamp DESC
LIMIT ${limit} OFFSET ${offset}`;
}

/** Analytics Engine returns `YYYY-MM-DD hh:mm:ss` in UTC */
export function toIso(timestamp: string): string {
  return `${timestamp.replace(" ", "T")}Z`;
}

/** Fills empty buckets so charts get an evenly spaced series */
export function fillBuckets<T extends { bucket: string }>(rows: T[], f: StatsFilter, now: number, empty: (iso: string) => T): T[] {
  const { bucketMs, spanMs } = RANGES[f.range];
  const byTime = new Map(rows.map((r) => [Date.parse(r.bucket), r]));
  const out: T[] = [];
  const first = Math.floor((now - spanMs) / bucketMs) * bucketMs;
  for (let t = first; t <= now; t += bucketMs) {
    const iso = new Date(t).toISOString().replace(".000Z", "Z");
    out.push(byTime.get(t) ?? empty(iso));
  }
  return out;
}
