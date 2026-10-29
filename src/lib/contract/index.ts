/**
 * Values the Worker API enforces and the dashboard mirrors in its forms. Both sides import them from here,
 * so a limit or enum changes in one place
 */

export const MAX_UPSTREAMS = 5;
export const MAX_DEVICE_NAME = 64;
export const MAX_PROFILE_NAME = 64;
export const MAX_LIST_NAME = 100;
/** Addresses swapped into answers for Cloudflare-proxied names when ECH is on */
export const MAX_ECH_PREFERRED_IPS = 16;
/** Names treated as Cloudflare-proxied whatever their upstream answer */
export const MAX_ECH_FORCED_DOMAINS = 500;

export const DEFAULT_PROFILE_ID = "default";
/** Custom rules are stored and compiled as a list with this ID */
export const CUSTOM_LIST_ID = "custom";
/** Snapshot list ID prefix of a compiled blocked service */
export const SERVICE_LIST_PREFIX = "service:";

export const BLOCKING_MODES = ["null_ip", "custom_ip", "nxdomain", "refused", "nodata"] as const;
export type BlockingMode = (typeof BLOCKING_MODES)[number];

export const UPSTREAM_MODES = ["fallback", "parallel"] as const;
export type UpstreamMode = (typeof UPSTREAM_MODES)[number];

export const RECORD_TYPES = ["A", "AAAA", "CNAME"] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

export const STATS_RANGES = ["1h", "24h", "7d", "30d"] as const;
export type StatsRange = (typeof STATS_RANGES)[number];

export const FILTER_ACTIONS = ["pass", "allow", "block", "rewrite"] as const;
export type FilterAction = (typeof FILTER_ACTIONS)[number];

/** `limited`: refused because the device exceeded its client limit */
export const ANSWER_SOURCES = ["upstream", "cache", "local", "error", "limited"] as const;
export type AnswerSource = (typeof ANSWER_SOURCES)[number];

export function isHttpUrl(value: string, protocols: readonly string[] = ["https:", "http:"]): boolean {
  try {
    return protocols.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

/** 1 to MAX_UPSTREAMS https:// URLs; used by settings, profiles and route lists */
export function isUpstreamList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= MAX_UPSTREAMS &&
    value.every((u) => typeof u === "string" && isHttpUrl(u, ["https:"]))
  );
}
