import { readHeader, typeName } from "#dns";
import type { MatchedRule } from "#filter";
import type { AnswerSource, FilterAction } from "./schema.ts";

export interface QueryEvent {
  deviceId: string;
  deviceName: string;
  name: string;
  type: number;
  action: FilterAction;
  source: AnswerSource;
  response: Uint8Array;
  rule?: MatchedRule;
  upstream?: string;
  colo?: string;
  client?: string;
  service?: string;
  network?: string;
  asn?: number;
  latencyMs: number;
}

const RCODE_NAMES = ["NOERROR", "FORMERR", "SERVFAIL", "NXDOMAIN", "NOTIMP", "REFUSED"];

/** Kept well under the 16 KB per-point blob budget */
const MAX_BLOB = 512;

export function toDataPoint(event: QueryEvent): AnalyticsEngineDataPoint {
  const rcode = readHeader(event.response).flags & 0x0f;
  return {
    indexes: [event.deviceId],
    blobs: [
      event.name,
      typeName(event.type),
      event.action,
      event.source,
      RCODE_NAMES[rcode] ?? `RCODE${rcode}`,
      event.rule?.text ?? "",
      event.rule?.listId ?? "",
      event.upstream ? new URL(event.upstream).host : "",
      event.colo ?? "",
      event.deviceName,
      event.client ?? "",
      event.service ?? "",
      event.network ?? "",
    ].map((b) => b.slice(0, MAX_BLOB)),
    doubles: [event.latencyMs, event.rule?.line ?? 0, event.asn ?? 0],
  };
}

/** Never lets analytics failures affect the DNS answer */
export function recordQuery(dataset: AnalyticsEngineDataset, event: QueryEvent): void {
  try {
    dataset.writeDataPoint(toDataPoint(event));
  } catch (err) {
    console.warn("failed to write analytics data point", String(err));
  }
}
