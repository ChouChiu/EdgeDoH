import { ApiError, queryString, request } from "@/shared/lib/http";

import { type AnswerSource, type FilterAction, type StatsRange as Range, STATS_RANGES as RANGES } from "#contract";

export { FILTER_ACTIONS as ACTIONS, ANSWER_SOURCES as SOURCES, STATS_RANGES as RANGES } from "#contract";
export type { AnswerSource, FilterAction, Range };
export type TopKind = "domains" | "blocked" | "devices" | "rules" | "lists" | "upstreams" | "services" | "clients" | "networks";

export interface StatsQuery {
  range: Range;
  device?: string;
  action?: FilterAction;
  source?: AnswerSource;
  search?: string;
}

export interface Summary {
  total: number;
  blocked: number;
  rewritten: number;
  allowlisted: number;
  cached: number;
  failed: number;
  blockedRatio: number;
  avgLatencyMs: number;
}

export interface TimeseriesPoint {
  bucket: string;
  total: number;
  blocked: number;
}

export interface TopItem {
  key: string;
  label?: string;
  count: number;
}

export interface LogEntry {
  time: string;
  device: string;
  deviceName: string;
  name: string;
  type: string;
  action: FilterAction;
  source: AnswerSource;
  rcode: string;
  rule?: { text: string; listId: string; line: number };
  upstream?: string;
  /** DoH client from the User-Agent, e.g. Chrome or Apple */
  client?: string;
  /** AdGuard service ID the name belongs to */
  service?: string;
  /** AS organisation of the client address */
  network?: string;
  latencyMs: number;
  sampleInterval: number;
}

export interface UpstreamHealth {
  host: string;
  answered: number;
  /** Errors, timeouts and SERVFAIL answers */
  failed: number;
  failureRate: number;
  /** null when no answer with a measured round trip was logged */
  avgMs: number | null;
  p95Ms: number | null;
}

export const statsApi = {
  upstreams: (q: StatsQuery) => request<{ items: UpstreamHealth[] }>(`/stats/upstreams${queryString({ ...q })}`),
  summary: (q: StatsQuery) => request<Summary & { range: Range }>(`/stats/summary${queryString({ ...q })}`),
  timeseries: (q: StatsQuery) => request<{ points: TimeseriesPoint[] }>(`/stats/timeseries${queryString({ ...q })}`),
  top: (kind: TopKind, q: StatsQuery, limit = 10) => request<{ items: TopItem[] }>(`/stats/top/${kind}${queryString({ ...q, limit })}`),
  logs: (q: StatsQuery, limit: number, offset: number) =>
    request<{ items: LogEntry[] }>(`/stats/logs${queryString({ ...q, limit, offset })}`),
};

/** The stats API answers 503 until an Analytics Engine token is configured */
export function isStatsNotConfigured(error: unknown): boolean {
  return error instanceof ApiError && error.status === 503;
}

export function parseRange(value: string | null): Range {
  return RANGES.find((r) => r === value) ?? "24h";
}
