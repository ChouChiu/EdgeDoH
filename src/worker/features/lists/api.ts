import { HttpError, isHttpUrl, readBody, readJson, readJsonObject, router } from "../../shared/http.ts";
import {
  addList,
  CATALOG_URL,
  type CompileReport,
  CUSTOM_LIST_ID,
  getList,
  getLists,
  MAX_CUSTOM_RULES_BYTES,
  MAX_LIST_NAME,
  refreshList,
  removeList,
  saveReports,
  textKey,
  updateList,
  urlListId,
} from "./store.ts";

export const listsApi = router();
export const catalogApi = router();
export const customRulesApi = router();

interface CatalogEntry {
  filterId: number;
  filterKey: string;
  name: string;
  downloadUrl: string;
  deprecated?: boolean;
}

/** HostlistsRegistry index, passed through untouched and cached at the edge for an hour */
catalogApi.get("/", async () => {
  const res = await fetchCatalog();
  return new Response(res.body, { headers: { "content-type": "application/json", "cache-control": "private, max-age=600" } });
});

listsApi.get("/", async (c) => c.json(await getLists(c.env.DB)));

/** Install a HostlistsRegistry list by `registryId`, or any list by `url` */
listsApi.post("/", async (c) => {
  const body = await readJsonObject(c);

  if (typeof body.registryId === "number") {
    const { filters } = await (await fetchCatalog()).json<{ filters: CatalogEntry[] }>();
    const entry = filters.find((f) => f.filterId === body.registryId && !f.deprecated);
    if (!entry) throw new HttpError(404, "unknown HostlistsRegistry list");
    const list = await addList(c.env, {
      id: entry.filterKey,
      name: entry.name,
      url: entry.downloadUrl,
      source: "registry",
      registryId: entry.filterId,
    });
    return c.json(list, 201);
  }

  if (typeof body.url === "string") {
    if (!isHttpUrl(body.url.trim())) throw new HttpError(400, "URL must be http or https");
    const url = new URL(body.url.trim());
    const name = listName(body.name);
    const list = await addList(c.env, { id: await urlListId(url.href), name, url: url.href, source: "url", registryId: null });
    return c.json(list, 201);
  }

  throw new HttpError(400, "registryId or url is required");
});

/** Compile results reported by the browser after uploading a snapshot */
listsApi.post("/reports", async (c) => {
  const body = await readJson(c);
  if (!Array.isArray(body) || !body.every(isReport)) throw new HttpError(400, "expected an array of reports");
  await saveReports(
    c.env.DB,
    body.map(({ id, rules, unsupported, reasons }) => ({ id, rules, unsupported, reasons })),
  );
  return c.body(null, 204);
});

listsApi.patch("/:id", async (c) => {
  const body = await readJsonObject(c);
  const name = listName(body.name);
  const list = await updateList(c.env.DB, c.req.param("id"), {
    ...(typeof body.enabled === "boolean" && { enabled: body.enabled }),
    ...(name && { name }),
  });
  if (!list) throw new HttpError(404, "list not found");
  return c.json(list);
});

listsApi.delete("/:id", async (c) => {
  if (!(await removeList(c.env, c.req.param("id")))) throw new HttpError(404, "list not found");
  return c.body(null, 204);
});

listsApi.post("/:id/refresh", async (c) => c.json(await refreshList(c.env, c.req.param("id"))));

/** Raw list text for the browser-side compiler, streamed from KV */
listsApi.get("/:id/text", async (c) => {
  const id = c.req.param("id");
  if (id !== CUSTOM_LIST_ID && !(await getList(c.env.DB, id))) throw new HttpError(404, "list not found");
  const text = await c.env.RULES.get(textKey(id), "stream");
  return new Response(text ?? "", { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
});

customRulesApi.get("/", async (c) => c.text((await c.env.RULES.get(textKey(CUSTOM_LIST_ID))) ?? ""));

customRulesApi.put("/", async (c) => {
  await c.env.RULES.put(textKey(CUSTOM_LIST_ID), await readBody(c.req.raw, MAX_CUSTOM_RULES_BYTES));
  return c.body(null, 204);
});

function fetchCatalog(): Promise<Response> {
  return fetch(CATALOG_URL, { cf: { cacheTtl: 3600, cacheEverything: true } }).then((res) => {
    if (!res.ok) throw new HttpError(502, `catalog fetch failed with HTTP ${res.status}`);
    return res;
  });
}

function listName(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, MAX_LIST_NAME) : undefined;
}

function isReport(value: unknown): value is CompileReport {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    Number.isInteger(r.rules) &&
    Number.isInteger(r.unsupported) &&
    typeof r.reasons === "object" &&
    r.reasons !== null &&
    !Array.isArray(r.reasons) &&
    Object.values(r.reasons).every(Number.isInteger)
  );
}
