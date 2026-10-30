import { HttpError, router } from "../../shared/http.ts";
import {
  fillBuckets,
  logsSql,
  parseFilter,
  runSql,
  statsConfig,
  summarySql,
  timeseriesSql,
  toIso,
  TOP_KINDS,
  type TopKind,
  topSql,
  upstreamFailuresSql,
  upstreamLatencySql,
} from "./query.ts";

export const statsApi = router();

type Numeric = number | string;
/** Analytics Engine sends 64-bit sums as strings */
const num = (v: Numeric | null | undefined) => Number(v ?? 0) || 0;

statsApi.get("/summary", async (c) => {
  const config = statsConfig(c.env);
  const filter = parseFilter(new URL(c.req.url).searchParams);
  const [row] = await runSql<Record<string, Numeric>>(config, summarySql(config.dataset, filter));
  const total = num(row?.total);
  const blocked = num(row?.blocked);
  return c.json({
    range: filter.range,
    total,
    blocked,
    rewritten: num(row?.rewritten),
    allowlisted: num(row?.allowlisted),
    cached: num(row?.cached),
    failed: num(row?.failed),
    blockedRatio: total > 0 ? blocked / total : 0,
    avgLatencyMs: total > 0 ? Math.round(num(row?.avg_latency_ms) * 10) / 10 : 0,
  });
});

statsApi.get("/timeseries", async (c) => {
  const config = statsConfig(c.env);
  const filter = parseFilter(new URL(c.req.url).searchParams);
  const rows = await runSql<{ bucket: string; total: Numeric; blocked: Numeric }>(config, timeseriesSql(config.dataset, filter));
  const points = rows.map((r) => ({ bucket: toIso(r.bucket), total: num(r.total), blocked: num(r.blocked) }));
  return c.json({
    range: filter.range,
    points: fillBuckets(points, filter, Date.now(), (bucket) => ({ bucket, total: 0, blocked: 0 })),
  });
});

statsApi.get("/top/:kind", async (c) => {
  const kind = c.req.param("kind");
  if (!Object.hasOwn(TOP_KINDS, kind)) throw new HttpError(400, `kind must be one of ${Object.keys(TOP_KINDS).join(", ")}`);
  const config = statsConfig(c.env);
  const params = new URL(c.req.url).searchParams;
  const filter = parseFilter(params);
  const limit = clampInt(params.get("limit"), 10, 1, 100);
  const rows = await runSql<{ key: string; label?: string; count: Numeric }>(config, topSql(config.dataset, filter, kind as TopKind, limit));
  return c.json({
    range: filter.range,
    kind,
    items: rows.map((r) => ({ key: r.key, ...(r.label !== undefined && { label: r.label }), count: num(r.count) })),
  });
});

/** Per upstream host: answers, failures (errors, timeouts and SERVFAIL) and answer round trip */
statsApi.get("/upstreams", async (c) => {
  const config = statsConfig(c.env);
  const filter = parseFilter(new URL(c.req.url).searchParams);
  const [latency, failures] = await Promise.all([
    runSql<{ host: string; answered: Numeric; avg_ms: Numeric; p95_ms: Numeric }>(config, upstreamLatencySql(config.dataset, filter)),
    runSql<{ failed: string; count: Numeric }>(config, upstreamFailuresSql(config.dataset, filter)),
  ]);
  const hosts = new Map<string, { host: string; answered: number; failed: number; avgMs: number | null; p95Ms: number | null }>();
  const entry = (host: string) => {
    let e = hosts.get(host);
    if (!e) hosts.set(host, (e = { host, answered: 0, failed: 0, avgMs: null, p95Ms: null }));
    return e;
  };
  for (const r of latency) Object.assign(entry(r.host), { answered: num(r.answered), avgMs: round(num(r.avg_ms)), p95Ms: round(num(r.p95_ms)) });
  for (const r of failures) for (const host of new Set(r.failed.split(",").filter(Boolean))) entry(host).failed += num(r.count);
  const items = [...hosts.values()]
    .map((e) => ({ ...e, failureRate: e.answered + e.failed > 0 ? e.failed / (e.answered + e.failed) : 0 }))
    .sort((a, b) => b.answered + b.failed - (a.answered + a.failed));
  return c.json({ range: filter.range, items });
});

statsApi.get("/logs", async (c) => {
  const config = statsConfig(c.env);
  const params = new URL(c.req.url).searchParams;
  const filter = parseFilter(params);
  const limit = clampInt(params.get("limit"), 50, 1, 500);
  const offset = clampInt(params.get("offset"), 0, 0, 100_000);
  const rows = await runSql<Record<string, Numeric>>(config, logsSql(config.dataset, filter, limit, offset));
  return c.json({
    range: filter.range,
    limit,
    offset,
    items: rows.map((r) => ({
      time: toIso(String(r.timestamp)),
      device: String(r.device),
      deviceName: String(r.device_name),
      name: String(r.name),
      type: String(r.type),
      action: String(r.action),
      source: String(r.source),
      rcode: String(r.rcode),
      ...(r.rule && { rule: { text: String(r.rule), listId: String(r.list), line: num(r.line) } }),
      ...(r.upstream && { upstream: String(r.upstream) }),
      ...(r.client && { client: String(r.client) }),
      ...(r.service && { service: String(r.service) }),
      ...(r.network && { network: String(r.network) }),
      latencyMs: num(r.latency_ms),
      sampleInterval: num(r.sample_interval),
    })),
  });
});

const round = (v: number) => Math.round(v * 10) / 10;

function clampInt(value: string | null, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (value === null || !Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
