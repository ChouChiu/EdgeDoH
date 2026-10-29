import { HttpError, router } from "../../shared/http.ts";

/**
 * ChouChiu/service-catalog rebuilds these once a day: AdGuard's blocked-services registry and the
 * per-app rule sets of blackmatrix7/ios_rule_script, converted to AdGuard syntax. They stay two
 * files because their licenses differ (GPL-3.0 and GPL-2.0)
 */
export const CATALOG_URL = "https://raw.githubusercontent.com/ChouChiu/service-catalog/main/output";
export const CATALOG_SOURCES = ["adguard", "community"] as const;

export const servicesApi = router();

/**
 * One catalog file, passed through unparsed: together they are close to 1 MB of JSON, which would
 * cost a good part of the free plan's CPU budget to parse here. The dashboard validates and merges
 */
servicesApi.get("/:source", async (c) => {
  const source = c.req.param("source");
  if (!(CATALOG_SOURCES as readonly string[]).includes(source)) throw new HttpError(404, "unknown services source");
  let res: Response;
  try {
    res = await fetch(`${CATALOG_URL}/${source}.json`, { cf: { cacheTtlByStatus: { "200-299": 3600, "300-599": 0 }, cacheEverything: true } });
  } catch (err) {
    throw new HttpError(502, `services catalog unavailable: ${String(err)}`);
  }
  if (!res.ok) throw new HttpError(502, `services catalog unavailable: HTTP ${res.status}`);
  return new Response(res.body, { headers: { "content-type": "application/json", "cache-control": "private, max-age=600" } });
});
