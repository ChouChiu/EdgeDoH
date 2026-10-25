import { decodeMeta, decodeShard, META_FORMAT, missingShards, SHARD_COUNT, type Snapshot } from "#filter";
import { sha256Hex } from "../../shared/crypto.ts";
import { HttpError } from "../../shared/http.ts";

/**
 * The active snapshot is a manifest pointing at content-addressed blobs: one meta file and
 * SHARD_COUNT shards. Isolates read the meta once and only the shards their queries touch
 */
// Versioned so a new meta format can be published before the Worker that reads it is deployed
const POINTER_KEY = `snapshot:manifest:v${META_FORMAT}`;
const BLOB_PREFIX = "blob:";
/** How often an isolate re-reads the small pointer key to notice a new snapshot */
const CHECK_INTERVAL_MS = 30_000;
/** A shard of a 1M-rule list set is about 500 KB; anything near this is not a snapshot blob */
export const MAX_BLOB_BYTES = 5 * 1024 * 1024;
const HASH = /^[0-9a-f]{64}$/;

export interface Manifest {
  meta: string;
  /** The meta blob's JSON inlined, saving cold isolates one KV read */
  metaText?: string;
  shards: string[];
  /** Sum of all blob sizes */
  bytes: number;
  uploadedAt: number;
  /** Blobs of the previous manifest, deleted at the next commit once no isolate needs them */
  previous?: string[];
}

export interface LoadedSnapshot {
  manifest: Manifest;
  snapshot: Snapshot;
}

interface State {
  loaded: LoadedSnapshot | undefined;
  checkedAt: number;
}

let state: State | undefined;
let inflight: Promise<LoadedSnapshot | undefined> | undefined;
/** Decoded shards by blob hash; unchanged shards survive snapshot switches */
const shardCache = new Map<string, Uint32Array>();

/**
 * Returns the active snapshot (meta only), refreshing at most every 30 s per isolate.
 * Never throws: on KV or decode errors the last good snapshot stays in use
 */
export function getSnapshot(kv: KVNamespace): Promise<LoadedSnapshot | undefined> {
  if (state && Date.now() - state.checkedAt < CHECK_INTERVAL_MS) return Promise.resolve(state.loaded);
  inflight ??= refresh(kv).finally(() => {
    inflight = undefined;
  });
  return inflight;
}

/** Loads the shards a lookup of `name` needs; a missing blob degrades to an empty shard */
export async function ensureShards(kv: KVNamespace, loaded: LoadedSnapshot, name: string): Promise<void> {
  const missing = missingShards(loaded.snapshot, name);
  if (missing.length === 0) return;
  await Promise.all(
    missing.map(async (index) => {
      const hash = loaded.manifest.shards[index]!;
      let entries = shardCache.get(hash);
      if (!entries) {
        const buf = await kv.get(blobKey(hash), { type: "arrayBuffer", cacheTtl: 86400 });
        try {
          entries = buf ? decodeShard(buf, index) : undefined;
        } catch (err) {
          console.error("invalid snapshot shard", { index, hash, error: String(err) });
        }
        if (!entries) {
          console.error("snapshot shard unavailable", { index, hash });
          entries = new Uint32Array(0);
        } else {
          if (shardCache.size >= SHARD_COUNT * 2) shardCache.clear();
          shardCache.set(hash, entries);
        }
      }
      loaded.snapshot.shards[index] = entries;
    }),
  );
}

async function refresh(kv: KVNamespace): Promise<LoadedSnapshot | undefined> {
  const checkedAt = Date.now();
  try {
    const manifest = await kv.get<Manifest>(POINTER_KEY, { type: "json", cacheTtl: 30 });
    if (!manifest) {
      state = { loaded: undefined, checkedAt };
      return undefined;
    }
    if (state?.loaded?.manifest.meta === manifest.meta && sameShards(state.loaded.manifest, manifest)) {
      state.checkedAt = checkedAt;
      return state.loaded;
    }
    let meta: string | ArrayBuffer | null = manifest.metaText ?? null;
    meta ??= await kv.get(blobKey(manifest.meta), { type: "arrayBuffer", cacheTtl: 86400 });
    if (!meta) throw new Error(`snapshot meta ${manifest.meta} is missing`);
    const snapshot = decodeMeta(meta);
    manifest.shards.forEach((hash, i) => {
      snapshot.shards[i] = shardCache.get(hash);
    });
    state = { loaded: { manifest, snapshot }, checkedAt };
    return state.loaded;
  } catch (err) {
    console.error("failed to refresh rule snapshot", String(err));
    if (state) state.checkedAt = checkedAt;
    return state?.loaded;
  }
}

export async function getManifest(kv: KVNamespace): Promise<Manifest | null> {
  return kv.get<Manifest>(POINTER_KEY, "json");
}

/** Stores one content-addressed blob after checking its hash */
export async function putBlob(kv: KVNamespace, hash: string, bytes: Uint8Array): Promise<void> {
  if (!HASH.test(hash)) throw new HttpError(400, "blob name must be a SHA-256 hex digest");
  if ((await sha256Hex(bytes)) !== hash) throw new HttpError(400, "blob content does not match its hash");
  await kv.put(blobKey(hash), bytes, { metadata: { bytes: bytes.length } });
}

/**
 * Activates a manifest whose blobs were uploaded beforehand. Only the meta is decoded;
 * shards are checked for presence through one KV list instead of being read
 */
export async function commitManifest(kv: KVNamespace, input: { meta: unknown; shards: unknown }): Promise<LoadedSnapshot> {
  const isHash = (v: unknown): v is string => typeof v === "string" && HASH.test(v);
  if (!isHash(input.meta) || !Array.isArray(input.shards) || input.shards.length !== SHARD_COUNT || !input.shards.every(isHash)) {
    throw new HttpError(400, `manifest needs a meta hash and ${SHARD_COUNT} shard hashes`);
  }
  const wanted = [input.meta, ...(input.shards as string[])];
  const sizes = await blobSizes(kv);
  const absent = wanted.filter((h) => !sizes.has(h));
  if (absent.length > 0) throw new HttpError(409, `missing blobs: ${absent.join(", ")}`);

  const metaText = await kv.get(blobKey(input.meta), "text");
  // KV listings are eventually consistent, so a blob can be listed yet not readable here
  if (metaText === null) throw new HttpError(409, `missing blobs: ${input.meta}`);
  const snapshot = decodeMeta(metaText);

  const old = await getManifest(kv);
  const manifest: Manifest = {
    meta: input.meta,
    metaText,
    shards: input.shards as string[],
    bytes: [...new Set(wanted)].reduce((n, h) => n + sizes.get(h)!, 0),
    uploadedAt: Date.now(),
    ...(old && { previous: [old.meta, ...old.shards] }),
  };
  await kv.put(POINTER_KEY, JSON.stringify(manifest));

  // The blobs from two snapshots ago are no longer referenced by anyone
  const keep = new Set([...wanted, ...(manifest.previous ?? [])]);
  await Promise.all([...new Set(old?.previous ?? [])].filter((h) => !keep.has(h)).map((h) => kv.delete(blobKey(h))));

  manifest.shards.forEach((hash, i) => {
    snapshot.shards[i] = shardCache.get(hash);
  });
  const loaded = { manifest, snapshot };
  state = { loaded, checkedAt: Date.now() };
  return loaded;
}

export async function clearSnapshot(kv: KVNamespace): Promise<void> {
  const old = await getManifest(kv);
  await kv.delete(POINTER_KEY);
  if (old) {
    const hashes = new Set([old.meta, ...old.shards, ...(old.previous ?? [])]);
    await Promise.all([...hashes].map((h) => kv.delete(blobKey(h))));
  }
  state = { loaded: undefined, checkedAt: Date.now() };
}

async function blobSizes(kv: KVNamespace): Promise<Map<string, number>> {
  const sizes = new Map<string, number>();
  let cursor: string | undefined;
  do {
    const page = await kv.list<{ bytes?: number }>({ prefix: BLOB_PREFIX, ...(cursor && { cursor }) });
    for (const key of page.keys) sizes.set(key.name.slice(BLOB_PREFIX.length), key.metadata?.bytes ?? 0);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return sizes;
}

function sameShards(a: Manifest, b: Manifest): boolean {
  return a.shards.length === b.shards.length && a.shards.every((h, i) => h === b.shards[i]);
}

function blobKey(hash: string): string {
  return `${BLOB_PREFIX}${hash}`;
}
