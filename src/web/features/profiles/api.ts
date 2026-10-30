import { useQuery } from "@tanstack/react-query";
import type { BlockingMode } from "#contract";
import type { Translate } from "@/shared/i18n";
import { jsonBody, request } from "@/shared/lib/http";

import { DEFAULT_PROFILE_ID } from "#contract";

export { DEFAULT_PROFILE_ID, MAX_PROFILE_NAME, SERVICE_LIST_PREFIX } from "#contract";

export interface Schedule {
  timezone: string;
  /** 0 = Sunday … 6 = Saturday */
  days: number[];
  /** Minutes since local midnight; end <= start runs past midnight */
  start: number;
  end: number;
}

export interface ProfileConfig {
  filtering: boolean;
  lists: string[] | null;
  services: string[];
  scheduledServices: string[];
  schedule: Schedule | null;
  safeSearch: boolean;
  youtubeRestricted: boolean;
  rebinding: boolean;
  blockingMode: BlockingMode | null;
  upstreams: string[] | null;
  splitDns: boolean;
  ecs: boolean;
  ech: boolean;
  h3: boolean;
}

export interface Profile extends ProfileConfig {
  id: string;
  name: string;
}

export interface Service {
  id: string;
  name: string;
  group: string;
  /** SVG markup from the registry, shown only as an image */
  icon: string;
  rules: string[];
}

export const PROFILES_KEY = ["profiles"];
export const SERVICES_KEY = ["services"];

export const profilesApi = {
  list: () => request<Profile[]>("/profiles"),
  create: (name: string) => request<Profile>("/profiles", jsonBody("POST", { name })),
  update: (id: string, patch: Partial<ProfileConfig> & { name?: string }) => request<Profile>(`/profiles/${id}`, jsonBody("PATCH", patch)),
  remove: (id: string) => request<void>(`/profiles/${id}`, { method: "DELETE" }),
};

/** AdGuard's registry first, so its names and icons win when both catalogs know a service */
const SERVICE_SOURCES = ["adguard", "community"] as const;
const SERVICE_ID = /^[a-z0-9_]{1,64}$/;

export const servicesApi = {
  /**
   * Both catalogs merged; one that cannot be fetched is left out, only both failing is an error.
   * `fresh` skips the browser's and the Worker's caches and refreshes both with the result
   */
  list: async ({ fresh = false } = {}): Promise<Service[]> => {
    const init: RequestInit = fresh ? { cache: "reload" } : {};
    const results = await Promise.allSettled(SERVICE_SOURCES.map((s) => request<unknown>(`/services/${s}`, init)));
    const loaded = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    if (loaded.length === 0) throw (results[0] as PromiseRejectedResult).reason;
    return mergeCatalogs(loaded);
  },
};

/** Services with the same ID are one service: the later catalog's rules are added to it */
export function mergeCatalogs(catalogs: unknown[]): Service[] {
  const byId = new Map<string, Service>();
  for (const catalog of catalogs) {
    const services = (catalog as { services?: unknown } | null)?.services;
    if (!Array.isArray(services)) continue;
    for (const s of services as Partial<Record<keyof Service, unknown>>[]) {
      if (typeof s.id !== "string" || !SERVICE_ID.test(s.id) || typeof s.name !== "string" || !Array.isArray(s.rules)) continue;
      const rules = s.rules.filter((r): r is string => typeof r === "string");
      const known = byId.get(s.id);
      if (known) known.rules = [...new Set([...known.rules, ...rules])];
      else byId.set(s.id, { id: s.id, name: s.name, group: typeof s.group === "string" ? s.group : "other", icon: typeof s.icon === "string" ? s.icon : "", rules });
    }
  }
  return [...byId.values()];
}

export function useProfiles() {
  return useQuery({ queryKey: PROFILES_KEY, queryFn: profilesApi.list });
}

export function useServices() {
  return useQuery({ queryKey: SERVICES_KEY, queryFn: () => servicesApi.list(), staleTime: 60 * 60_000 });
}

/** Display name of a profile; the built-in default one is translated */
export function profileName(profile: Pick<Profile, "id" | "name">, t: Translate): string {
  return profile.id === DEFAULT_PROFILE_ID ? t("profiles.default") : profile.name;
}
