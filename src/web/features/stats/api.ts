import { ApiError, queryString, request } from "@/shared/lib/http";

export const RANGES = ["1h", "24h", "7d", "30d"] as const;
export type Range = (typeof RANGES)[number];
export const ACTIONS = ["pass", "allow", "block", "rewrite"] as const;
export type FilterAction = (typeof ACTIONS)[number];
export const SOURCES = ["upstream", "cache", "local", "error", "limited"] as const;
export type AnswerSource = (typeof SOURCES)[number];
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

export const statsApi = {
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
