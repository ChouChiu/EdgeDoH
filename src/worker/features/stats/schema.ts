/**
 * Analytics Engine column layout for one DNS query. The SQL in query.ts depends on these
 * positions, so append new fields instead of reordering
 *
 *   index1   device ID (sampling key)
 *   blob1    query name, lowercase
 *   blob2    query type, e.g. "A" or "TYPE65"
 *   blob3    filter action: pass | allow | block | rewrite
 *   blob4    answer source: upstream | cache | local | error | limited
 *   blob5    response rcode name
 *   blob6    matched rule text
 *   blob7    matched filter list ID
 *   blob8    upstream host
 *   blob9    Cloudflare colo
 *   blob10   device name at query time
 *   double1  handling time in ms (wall clock, so mostly upstream wait)
 *   double2  matched rule line number
 */
export const Column = {
  device: "index1",
  name: "blob1",
  type: "blob2",
  action: "blob3",
  source: "blob4",
  rcode: "blob5",
  rule: "blob6",
  list: "blob7",
  upstream: "blob8",
  colo: "blob9",
  deviceName: "blob10",
  latency: "double1",
  ruleLine: "double2",
} as const;

export const ACTIONS = ["pass", "allow", "block", "rewrite"] as const;
export type FilterAction = (typeof ACTIONS)[number];

/** `limited`: refused because the device exceeded its client limit */
export const SOURCES = ["upstream", "cache", "local", "error", "limited"] as const;
export type AnswerSource = (typeof SOURCES)[number];
