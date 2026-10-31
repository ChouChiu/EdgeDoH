import { HttpError, router } from "../../shared/http.ts";

/**
 * ChouChiu/service-catalog rebuilds these once a day: AdGuard's blocked-services registry and the
 * per-app rule sets of blackmatrix7/ios_rule_script, converted to AdGuard syntax. They stay two
 * files because their licenses differ (GPL-3.0 and GPL-2.0)
 */
export const CATALOG_URL = "https://raw.githubusercontent.com/ChouChiu/service-catalog/main/output";
const CATALOG_SOURCES = ["adguard", "community"] as const;
const EDGE_TTL = 3600;

export const servicesApi = router();

/**
 * One catalog file, passed through unparsed: together they are close to 1 MB of JSON, which would
 * cost a good part of the free plan's CPU budget to parse here. The dashboard validates and merges.
 *
 * Kept in the Cache API for an hour. A request with `Cache-Control: no-cache` (the dashboard's
 * rebuild) skips every cache, GitHub's included, and replaces the cached copy, so a catalog update
 * shows up on the next rebuild instead of an hour later
 */
servicesApi.get("/:source", async (c) => {
  const source = c.req.param("source");
  if (!(CATALOG_SOURCES as readonly string[]).includes(source)) throw new HttpError(404, "unknown services source");
  const url = `${CATALOG_URL}/${source}.json`;
  const key = new Request(url);
  const fresh = /\bno-cache\b/.test(c.req.header("cache-control") ?? "");

  let body = fresh ? undefined : await (await caches.default.match(key))?.text();
  if (body === undefined) {
    let res: Response;
    try {
      // raw.githubusercontent.com caches for five minutes; a unique query string skips that copy
      res = await fetch(fresh ? `${url}?t=${Date.now()}` : url, { cache: "no-store" });
    } catch (err) {
      throw new HttpError(502, `services catalog unavailable: ${String(err)}`);
    }
    if (!res.ok) throw new HttpError(502, `services catalog unavailable: HTTP ${res.status}`);
    body = await res.text();
    const cached = new Response(body, { headers: { "content-type": "application/json", "cache-control": `public, max-age=${EDGE_TTL}` } });
    c.executionCtx.waitUntil(caches.default.put(key, cached));
  }
  return new Response(body, { headers: { "content-type": "application/json", "cache-control": "private, max-age=600" } });
});
