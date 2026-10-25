/** Installed filter lists: metadata in D1, raw text in KV so the browser can recompile without refetching */
import { decodeListHead, HEADER_BYTES, type ListMeta, parseListHeader } from "#filter";
import { sha256, toHex } from "../../shared/crypto.ts";
import { HttpError } from "../../shared/http.ts";

export const CATALOG_URL = "https://adguardteam.github.io/HostlistsRegistry/assets/filters.json";
export const CUSTOM_LIST_ID = "custom";
/** Leaves headroom under the 25 MiB KV value limit */
export const MAX_LIST_BYTES = 20 * 1024 * 1024;
export const MAX_CUSTOM_RULES_BYTES = 1024 * 1024;
export const MAX_LIST_NAME = 100;

export interface FilterList {
  id: string;
  name: string;
  url: string;
  source: "registry" | "url";
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
}

interface Row {
  id: string;
  name: string;
  url: string;
  source: "registry" | "url";
  registry_id: number | null;
  enabled: number;
  rules: number | null;
  unsupported: number | null;
  reasons: string | null;
  meta: string | null;
  fetched_at: number | null;
  compiled_at: number | null;
  created_at: number;
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
  list: Pick<FilterList, "id" | "url" | "source" | "registryId"> & { name?: string },
): Promise<FilterList> {
  if (await getList(env.DB, list.id)) throw new HttpError(409, "list is already installed");
  const meta = await download(env, list.id, list.url);
  const name = list.name ?? meta.title ?? new URL(list.url).hostname;
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO filter_lists (id, name, url, source, registry_id, enabled, meta, fetched_at, created_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)",
  )
    .bind(list.id, name, list.url, list.source, list.registryId, JSON.stringify(meta), now, now)
    .run();
  return (await getList(env.DB, list.id))!;
}

export async function refreshList(env: Env, id: string): Promise<FilterList> {
  const list = await getList(env.DB, id);
  if (!list) throw new HttpError(404, "list not found");
  const meta = await download(env, id, list.url);
  await env.DB.prepare("UPDATE filter_lists SET meta = ?, fetched_at = ? WHERE id = ?").bind(JSON.stringify(meta), Date.now(), id).run();
  return (await getList(env.DB, id))!;
}

export async function updateList(db: D1Database, id: string, patch: { enabled?: boolean; name?: string }): Promise<FilterList | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
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

/** Streams the list straight into KV; only the first bytes are kept, to read the header from */
async function download(env: Env, id: string, url: string): Promise<ListMeta> {
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
  return parseListHeader(decodeListHead(head.subarray(0, headSize), total === headSize));
}

function fromRow(row: Row): FilterList {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    source: row.source,
    registryId: row.registry_id,
    enabled: row.enabled === 1,
    rules: row.rules,
    unsupported: row.unsupported,
    reasons: row.reasons ? JSON.parse(row.reasons) : null,
    meta: row.meta ? JSON.parse(row.meta) : null,
    fetchedAt: row.fetched_at,
    compiledAt: row.compiled_at,
    createdAt: row.created_at,
  };
}
