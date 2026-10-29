import { isIPv4, isIPv6, Rcode, RRType } from "#dns";
import { isDomain, type Verdict } from "#filter";
import { HttpError } from "../../shared/http.ts";
import { publishRuntimeConfig, type RuntimeConfig } from "../../shared/runtime-config.ts";

import { RECORD_TYPES, type RecordType } from "#contract";

export { RECORD_TYPES, type RecordType } from "#contract";
/** Kept small: every record travels in the runtime config each isolate loads */
export const MAX_RECORDS = 1000;
/** Shown as the matched list in logs and the rule tester */
export const LOCAL_LIST_ID = "local";

export interface LocalRecord {
  /** Lowercase; `*.example.lan` covers every subdomain of example.lan but not the name itself */
  name: string;
  type: RecordType;
  value: string;
}

export async function listRecords(db: D1Database): Promise<LocalRecord[]> {
  const { results } = await db.prepare("SELECT name, type, value FROM local_records ORDER BY name, type, value").all<LocalRecord>();
  return results;
}

/** Replaces the whole set: the dashboard edits records as one table */
export async function replaceRecords(env: Env, input: unknown): Promise<LocalRecord[]> {
  const records = validateRecords(input);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM local_records"),
    ...records.map((r) => env.DB.prepare("INSERT INTO local_records (name, type, value) VALUES (?, ?, ?)").bind(r.name, r.type, r.value)),
  ]);
  await publishRuntimeConfig(env);
  return listRecords(env.DB);
}

function validateRecords(input: unknown): LocalRecord[] {
  if (!Array.isArray(input) || input.length > MAX_RECORDS) throw new HttpError(400, `expected at most ${MAX_RECORDS} records`);
  const seen = new Set<string>();
  const out: LocalRecord[] = [];
  input.forEach((item: unknown, i) => {
    const r = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    const fail = (why: string): never => {
      throw new HttpError(400, `record ${i + 1}: ${why}`);
    };
    const name = typeof r.name === "string" ? r.name.trim().toLowerCase().replace(/\.$/, "") : "";
    const bare = name.startsWith("*.") ? name.slice(2) : name;
    if (!isDomain(bare)) fail("invalid name");
    if (typeof r.type !== "string" || !(RECORD_TYPES as readonly string[]).includes(r.type)) fail(`type must be one of ${RECORD_TYPES.join(", ")}`);
    const type = r.type as RecordType;
    let value = typeof r.value === "string" ? r.value.trim() : "";
    if (type === "A" && !isIPv4(value)) fail("A needs an IPv4 address");
    if (type === "AAAA" && !isIPv6(value)) fail("AAAA needs an IPv6 address");
    if (type === "CNAME") {
      value = value.toLowerCase().replace(/\.$/, "");
      if (!isDomain(value)) fail("CNAME needs a domain name");
    }
    const key = `${name} ${type} ${value}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name, type, value });
  });
  // A CNAME must be the only record of its name (RFC 1034 section 3.6.2)
  const types = new Map<string, Set<string>>();
  for (const r of out) types.set(r.name, (types.get(r.name) ?? new Set()).add(r.type));
  for (const [name, set] of types) {
    if (set.has("CNAME") && (set.size > 1 || out.filter((r) => r.name === name).length > 1)) {
      throw new HttpError(400, `${name}: a CNAME cannot coexist with other records`);
    }
  }
  return out;
}

const indexes = new WeakMap<RuntimeConfig["records"], Map<string, LocalRecord[]>>();

/**
 * Answer for a name covered by a local record, shaped like a `$dnsrewrite` verdict so the DoH
 * path builds it the same way. Exact names win over the closest `*.` wildcard
 */
export function localVerdict(records: RuntimeConfig["records"], name: string, qtype: number): Verdict | undefined {
  if (records.length === 0) return undefined;
  let index = indexes.get(records);
  if (!index) {
    index = new Map();
    for (const r of records) {
      const list = index.get(r.name) ?? [];
      list.push(r as LocalRecord);
      index.set(r.name, list);
    }
    indexes.set(records, index);
  }
  let hits = index.get(name);
  for (let dot = name.indexOf("."); !hits && dot >= 0; dot = name.indexOf(".", dot + 1)) {
    hits = index.get(`*${name.slice(dot)}`);
  }
  if (!hits) return undefined;
  const first = hits[0]!;
  const rule = { text: `${first.name} ${first.type} ${first.value}`, listId: LOCAL_LIST_ID, line: 0 };
  if (first.type === "CNAME") return { action: "rewrite", rule, rcode: Rcode.NOERROR, records: [{ type: RRType.CNAME, value: first.value }] };
  const answers = hits.filter((r) => RRType[r.type] === qtype).map((r) => ({ type: RRType[r.type], value: r.value }));
  return { action: "rewrite", rule, rcode: Rcode.NOERROR, records: answers };
}
