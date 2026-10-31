/** Installed filter lists: metadata in D1, raw text in KV so the browser can recompile without refetching */
import { decodeListHead, HEADER_BYTES, type ListMeta, parseListHeader } from "#filter";
import { sha256, toHex } from "../../shared/crypto.ts";
import { HttpError } from "../../shared/http.ts";

export const CATALOG_URL = "https://adguardteam.github.io/HostlistsRegistry/assets/filters.json";
/** Leaves headroom under the 25 MiB KV value limit */
export const MAX_LIST_BYTES = 20 * 1024 * 1024;
export const MAX_CUSTOM_RULES_BYTES = 1024 * 1024;

export const LIST_KINDS = ["filter", "route"] as const;
export type ListKind = (typeof LIST_KINDS)[number];

export interface FilterList {
  id: string;
  name: string;
  /** Empty for inline lists, whose text is edited in the dashboard */
  url: string;
  source: "registry" | "url" | "inline";
  kind: ListKind;
  /** Route lists only: DoH URLs that resolve the names on the list */
  upstreams: string[] | null;
  registryId: number | null;
  enabled: boolean;
  rules: number | null;
  unsupported: number | null;
  reasons: Record<string, number> | null;
  /** Read from the list's comment header on every download */
  meta: ListMeta | null;
  fetchedAt: number | null;
  compiledAt: number | null;
  createdAt: number;
  /** A scheduled check found a newer copy at the source than the stored one */
  updateAvailable: boolean;
  checkedAt: number | null;
}

interface Row {
  id: string;
  name: string;
  url: string;
  source: "registry" | "url" | "inline";
  kind: ListKind;
  upstreams: string | null;
  registry_id: number | null;
  enabled: number;
  rules: number | null;
  unsupported: number | null;
  reasons: string | null;
  meta: string | null;
  fetched_at: number | null;
  compiled_at: number | null;
  created_at: number;
  etag: string | null;
  last_modified: string | null;
  checked_at: number | null;
  update_available: number;
}

export interface CompileReport {
  id: string;
  rules: number;
  unsupported: number;
  reasons: Record<string, number>;
}

export function textKey(id: string): string {
  return `list:${id}`;
}

export const MAX_INLINE_BYTES = 1024 * 1024;

export async function getLists(db: D1Database): Promise<FilterList[]> {
  const { results } = await db.prepare("SELECT * FROM filter_lists ORDER BY created_at").all<Row>();
  return results.map(fromRow);
}

export async function getList(db: D1Database, id: string): Promise<FilterList | null> {
  const row = await db.prepare("SELECT * FROM filter_lists WHERE id = ?").bind(id).first<Row>();
  return row ? fromRow(row) : null;
}

/** Without a `name`, the list's own title is used, then the URL's host name */
export async function addList(
  env: Env,
  list: Pick<FilterList, "id" | "url" | "source" | "registryId"> & { name?: string; kind?: ListKind; upstreams?: string[] | null },
): Promise<FilterList> {
  if (await getList(env.DB, list.id)) throw new HttpError(409, "list is already installed");
  const { meta, etag, lastModified } = await download(env, list.id, list.url);
  const name = list.name ?? meta.title ?? new URL(list.url).hostname;
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO filter_lists (id, name, url, source, kind, upstreams, registry_id, enabled, meta, fetched_at, created_at, etag, last_modified) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)",
  )
    .bind(list.id, name, list.url, list.source, list.kind ?? "filter", upstreamsJson(list.upstreams), list.registryId, JSON.stringify(meta), now, now, etag, lastModified)
    .run();
  return (await getList(env.DB, list.id))!;
}

/** A list typed into the dashboard rather than downloaded */
export async function addInlineList(env: Env, list: { name: string; kind: ListKind; upstreams: string[] | null; text: Uint8Array }): Promise<FilterList> {
  const id = `inline-${crypto.randomUUID().slice(0, 8)}`;
  await env.RULES.put(textKey(id), list.text);
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO filter_lists (id, name, url, source, kind, upstreams, registry_id, enabled, fetched_at, created_at) VALUES (?, ?, '', 'inline', ?, ?, NULL, 1, ?, ?)",
  )
    .bind(id, list.name, list.kind, upstreamsJson(list.upstreams), now, now)
    .run();
  return (await getList(env.DB, id))!;
}

export async function setInlineText(env: Env, id: string, text: Uint8Array): Promise<FilterList> {
  const list = await getList(env.DB, id);
  if (!list) throw new HttpError(404, "list not found");
  if (list.source !== "inline") throw new HttpError(400, "only inline lists can be edited");
  await env.RULES.put(textKey(id), text);
  await env.DB.prepare("UPDATE filter_lists SET fetched_at = ? WHERE id = ?").bind(Date.now(), id).run();
  return (await getList(env.DB, id))!;
}

function upstreamsJson(upstreams: string[] | null | undefined): string | null {
  return upstreams ? JSON.stringify(upstreams) : null;
}

export async function refreshList(env: Env, id: string): Promise<FilterList> {
  const list = await getList(env.DB, id);
  if (!list) throw new HttpError(404, "list not found");
  if (list.source === "inline") return list;
  const { meta, etag, lastModified } = await download(env, id, list.url);
  await env.DB.prepare("UPDATE filter_lists SET meta = ?, fetched_at = ?, etag = ?, last_modified = ?, update_available = 0 WHERE id = ?")
    .bind(JSON.stringify(meta), Date.now(), etag, lastModified, id)
    .run();
  return (await getList(env.DB, id))!;
}

export async function updateList(
  db: D1Database,
  id: string,
  patch: { enabled?: boolean; name?: string; upstreams?: string[] },
): Promise<FilterList | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.upstreams !== undefined) {
    sets.push("upstreams = ?");
    values.push(upstreamsJson(patch.upstreams));
  }
  if (patch.enabled !== undefined) {
    sets.push("enabled = ?");
    values.push(patch.enabled ? 1 : 0);
  }
  if (patch.name !== undefined) {
    sets.push("name = ?");
    values.push(patch.name);
  }
  if (sets.length > 0) {
    await db.prepare(`UPDATE filter_lists SET ${sets.join(", ")} WHERE id = ?`).bind(...values, id).run();
  }
  return getList(db, id);
}

export async function removeList(env: Env, id: string): Promise<boolean> {
  const result = await env.DB.prepare("DELETE FROM filter_lists WHERE id = ?").bind(id).run();
  await env.RULES.delete(textKey(id));
  return result.meta.changes > 0;
}

export async function saveReports(db: D1Database, reports: CompileReport[]): Promise<void> {
  if (reports.length === 0) return;
  const now = Date.now();
  await db.batch(
    reports.map((r) =>
      db
        .prepare("UPDATE filter_lists SET rules = ?, unsupported = ?, reasons = ?, compiled_at = ? WHERE id = ?")
        .bind(r.rules, r.unsupported, JSON.stringify(r.reasons), now, r.id),
    ),
  );
}

/** URL lists get a stable ID derived from the URL so re-adding the same URL is detected */
export async function urlListId(url: string): Promise<string> {
  return `url-${toHex((await sha256(url)).subarray(0, 4))}`;
}

interface Downloaded {
  meta: ListMeta;
  etag: string | null;
  lastModified: string | null;
}

/** Streams the list straight into KV; only the first bytes are kept, to read the header from */
async function download(env: Env, id: string, url: string): Promise<Downloaded> {
  let res: Response;
  try {
    // Asking for an uncompressed body keeps the runtime from inflating several MB inside this request's CPU budget
    res = await fetch(url, { headers: { accept: "text/plain, */*", "accept-encoding": "identity" }, signal: AbortSignal.timeout(20_000) });
  } catch (err) {
    throw new HttpError(502, `download failed: ${String(err)}`);
  }
  if (!res.ok || !res.body) throw new HttpError(502, `download failed with HTTP ${res.status}`);
  if (Number(res.headers.get("content-length")) > MAX_LIST_BYTES) throw new HttpError(413, "list exceeds 20 MiB");
  const head = new Uint8Array(HEADER_BYTES);
  let headSize = 0;
  let total = 0;
  const tap = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (headSize < HEADER_BYTES) {
        const part = chunk.subarray(0, HEADER_BYTES - headSize);
        head.set(part, headSize);
        headSize += part.length;
      }
      total += chunk.length;
      controller.enqueue(chunk);
    },
  });
  try {
    await env.RULES.put(textKey(id), res.body.pipeThrough(tap));
  } catch (err) {
    // Without a content-length the size is only known once KV rejects the stream
    throw new HttpError(502, `storing the list failed: ${String(err)}`);
  }
  return {
    meta: parseListHeader(decodeListHead(head.subarray(0, headSize), total === headSize)),
    etag: res.headers.get("etag"),
    lastModified: res.headers.get("last-modified"),
  };
}

function fromRow(row: Row): FilterList {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    source: row.source,
    kind: row.kind,
    upstreams: row.upstreams ? JSON.parse(row.upstreams) : null,
    registryId: row.registry_id,
    enabled: row.enabled === 1,
    rules: row.rules,
    unsupported: row.unsupported,
    reasons: row.reasons ? JSON.parse(row.reasons) : null,
    meta: row.meta ? JSON.parse(row.meta) : null,
    fetchedAt: row.fetched_at,
    compiledAt: row.compiled_at,
    createdAt: row.created_at,
    updateAvailable: row.update_available === 1,
    checkedAt: row.checked_at,
  };
}

/** Stays under the free plan's 50 subrequests per invocation, with room for the two D1 calls */
const MAX_CHECKS = 40;
const CHECK_TIMEOUT_MS = 10_000;

interface CheckRow {
  id: string;
  url: string;
  etag: string | null;
  last_modified: string | null;
}

/**
 * Asks the sources of downloaded lists whether they changed, with conditional requests, and flags
 * the ones that did. Nothing is downloaded or compiled: a body is cancelled as soon as headers
 * arrive, so this fits a scheduled run's CPU budget. Lists checked longest ago go first; sources
 * that send neither ETag nor Last-Modified cannot be checked and are only marked as visited
 */
export async function checkListUpdates(env: Env, now = Date.now()): Promise<{ checked: number; updates: number; uncheckable: number }> {
  const { results } = await env.DB.prepare(
    `SELECT id, url, etag, last_modified FROM filter_lists
     WHERE source != 'inline' AND enabled = 1 AND update_available = 0
     ORDER BY checked_at IS NOT NULL, checked_at LIMIT ?`,
  )
    .bind(MAX_CHECKS)
    .all<CheckRow>();
  const outcomes = await Promise.all(
    results.map(async (row) => ({ id: row.id, uncheckable: !row.etag && !row.last_modified, changed: await sourceChanged(row) })),
  );
  if (outcomes.length > 0) {
    await env.DB.batch(
      outcomes.map((o) => env.DB.prepare("UPDATE filter_lists SET checked_at = ?, update_available = ? WHERE id = ?").bind(now, o.changed ? 1 : 0, o.id)),
    );
  }
  return { checked: outcomes.length, updates: outcomes.filter((o) => o.changed).length, uncheckable: outcomes.filter((o) => o.uncheckable).length };
}

async function sourceChanged({ url, etag, last_modified: lastModified }: CheckRow): Promise<boolean> {
  if (!etag && !lastModified) return false;
  const headers: Record<string, string> = { accept: "text/plain, */*", "accept-encoding": "identity" };
  if (etag) headers["if-none-match"] = etag;
  if (lastModified) headers["if-modified-since"] = lastModified;
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
    await res.body?.cancel();
    if (res.status === 304 || !res.ok) return false;
    // Some servers ignore conditional headers and always answer 200; the validators still tell
    const nextEtag = res.headers.get("etag");
    if (etag && nextEtag) return nextEtag !== etag;
    const nextModified = res.headers.get("last-modified");
    return Boolean(lastModified && nextModified && nextModified !== lastModified);
  } catch (err) {
    console.warn("list update check failed", { url, error: String(err) });
    return false;
  }
}
