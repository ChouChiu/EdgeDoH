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
 *   blob11   DoH client, from the User-Agent (browser or system resolver)
 *   blob12   AdGuard service the name belongs to, e.g. "tiktok"
 *   blob13   network the query came from: the client address's AS organisation
 *   blob14   comma-separated hosts of upstreams that failed, timed out or said SERVFAIL
 *   double1  handling time in ms (wall clock, so mostly upstream wait)
 *   double2  matched rule line number
 *   double3  AS number of the client address
 *   double4  round trip of the upstream that answered, ms; 0 when none did or for rows older than this field
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
  client: "blob11",
  service: "blob12",
  network: "blob13",
  failedUpstreams: "blob14",
  latency: "double1",
  ruleLine: "double2",
  asn: "double3",
  upstreamMs: "double4",
} as const;
