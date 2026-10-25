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
      latencyMs: num(r.latency_ms),
      sampleInterval: num(r.sample_interval),
    })),
  });
});

function clampInt(value: string | null, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (value === null || !Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
