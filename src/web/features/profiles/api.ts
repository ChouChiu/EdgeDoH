import { useQuery } from "@tanstack/react-query";
import type { BlockingMode } from "@/features/settings/api";
import type { Translate } from "@/shared/i18n";
import { jsonBody, request } from "@/shared/lib/http";

export const DEFAULT_PROFILE_ID = "default";
/** Snapshot list ID prefix of a compiled blocked service */
export const SERVICE_LIST_PREFIX = "service:";
export const MAX_PROFILE_NAME = 64;

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

export const servicesApi = {
  list: () => request<Service[]>("/services"),
};

export function useProfiles() {
  return useQuery({ queryKey: PROFILES_KEY, queryFn: profilesApi.list });
}

export function useServices() {
  return useQuery({ queryKey: SERVICES_KEY, queryFn: servicesApi.list, staleTime: 60 * 60_000 });
}

/** Display name of a profile; the built-in default one is translated */
export function profileName(profile: Pick<Profile, "id" | "name">, t: Translate): string {
  return profile.id === DEFAULT_PROFILE_ID ? t("profiles.default") : profile.name;
}
