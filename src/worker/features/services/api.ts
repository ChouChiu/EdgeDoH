import { HttpError, router } from "../../shared/http.ts";

/** AdGuard's blocked-services registry, the same source AdGuard Home and AdGuard DNS use */
export const SERVICES_URL = "https://adguardteam.github.io/HostlistsRegistry/assets/services.json";

interface RegistryService {
  id: string;
  name: string;
  rules: string[];
  icon_svg?: string;
  group?: string;
}

export const servicesApi = router();

/**
 * Every service with its rules, which the browser compiles into the snapshot as one list each,
 * and its icon. Cached at the edge for an hour like the filter catalog
 */
servicesApi.get("/", async (c) => {
  const res = await fetch(SERVICES_URL, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!res.ok) throw new HttpError(502, `services fetch failed with HTTP ${res.status}`);
  const { blocked_services: services } = await res.json<{ blocked_services?: RegistryService[] }>();
  if (!Array.isArray(services)) throw new HttpError(502, "services registry has an unexpected shape");
  const body = services
    .filter((s) => typeof s.id === "string" && /^[a-z0-9_]{1,64}$/.test(s.id) && Array.isArray(s.rules))
    .map((s) => ({ id: s.id, name: s.name, group: s.group ?? "other", icon: s.icon_svg ?? "", rules: s.rules }));
  return c.json(body, 200, { "cache-control": "private, max-age=600" });
});
