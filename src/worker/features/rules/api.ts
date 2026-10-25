import { RRType } from "#dns";
import { match } from "#filter";
import { HttpError, readBody, readJsonObject, router } from "../../shared/http.ts";
import { findDevice } from "../devices/store.ts";
import {
  clearSnapshot,
  commitManifest,
  ensureShards,
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

/** Explains how a name would be filtered, optionally as seen by one device */
rulesApi.post("/test", async (c) => {
  const body = await readJsonObject(c);
  if (typeof body.name !== "string" || body.name.trim() === "") throw new HttpError(400, "name is required");
  const typeName = typeof body.type === "string" ? body.type.toUpperCase() : "A";
  if (!Object.hasOwn(RRType, typeName)) throw new HttpError(400, `unknown type ${typeName}`);
  const type = RRType[typeName as keyof typeof RRType];

  const device = typeof body.deviceId === "string" ? await findDevice(c.env, body.deviceId) : null;
  const loaded = await getSnapshot(c.env.RULES);
  const name = body.name.trim().toLowerCase().replace(/\.$/, "");
  if (!loaded) return c.json({ name, type: typeName, verdict: { action: "pass" } });
  await ensureShards(c.env.RULES, loaded, name);
  const verdict = match(loaded.snapshot, { name, type, ...(device && { client: { id: device.id, name: device.name } }) });
  return c.json({ name, type: typeName, verdict });
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
