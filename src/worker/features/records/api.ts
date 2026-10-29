import { readJson, router } from "../../shared/http.ts";
import { listRecords, replaceRecords } from "./store.ts";

export const recordsApi = router();

recordsApi.get("/", async (c) => c.json(await listRecords(c.env.DB)));

recordsApi.put("/", async (c) => c.json(await replaceRecords(c.env, await readJson(c))));
