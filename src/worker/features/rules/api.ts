import { readBody, readJsonObject, router } from "../../shared/http.ts";
import {
  clearSnapshot,
  commitManifest,
  getManifest,
  getSnapshot,
  type LoadedSnapshot,
  MAX_BLOB_BYTES,
  putBlob,
} from "./store.ts";

export const rulesApi = router();

rulesApi.get("/", async (c) => c.json(summary(await getSnapshot(c.env.RULES))));

/** Blob hashes of the active snapshot, so uploaders can skip what the server already has */
rulesApi.get("/manifest", async (c) => {
  const manifest = await getManifest(c.env.RULES);
  return c.json({ blobs: manifest ? [manifest.meta, ...manifest.shards] : [] });
});

/** One content-addressed snapshot file (meta or shard), named by its SHA-256 */
rulesApi.put("/blobs/:hash", async (c) => {
  await putBlob(c.env.RULES, c.req.param("hash"), await readBody(c.req.raw, MAX_BLOB_BYTES));
  return c.body(null, 204);
});

/** Switches to a snapshot whose blobs are all uploaded: `{ meta, shards }` */
rulesApi.post("/commit", async (c) => {
  const { meta, shards } = await readJsonObject(c);
  return c.json(summary(await commitManifest(c.env.RULES, { meta, shards })), 201);
});

rulesApi.delete("/snapshot", async (c) => {
  await clearSnapshot(c.env.RULES);
  return c.body(null, 204);
});

function summary(loaded: LoadedSnapshot | undefined) {
  if (!loaded) return { active: false };
  const { manifest, snapshot } = loaded;
  return {
    active: true,
    version: manifest.meta.slice(0, 16),
    uploadedAt: manifest.uploadedAt,
    createdAt: snapshot.meta.createdAt,
    bytes: manifest.bytes,
    entries: snapshot.meta.entries,
    complex: snapshot.meta.complex.texts.length,
    lists: snapshot.meta.lists,
  };
}
