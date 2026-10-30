import { HttpError, readBody, router } from "../../shared/http.ts";
import { exportBackup, importBackup, MAX_BACKUP_BYTES } from "./store.ts";

export const backupApi = router();

backupApi.get("/", async (c) => {
  const date = new Date().toISOString().slice(0, 10);
  return c.json(await exportBackup(c.env), 200, { "content-disposition": `attachment; filename="edgedoh-backup-${date}.json"`, "cache-control": "no-store" });
});

/** Replaces the whole configuration; the dashboard then downloads the `pending` lists and rebuilds */
backupApi.put("/", async (c) => {
  const body = new TextDecoder().decode(await readBody(c.req.raw, MAX_BACKUP_BYTES));
  let input: unknown;
  try {
    input = JSON.parse(body);
  } catch {
    throw new HttpError(400, "invalid JSON body");
  }
  return c.json(await importBackup(c.env, input));
});
