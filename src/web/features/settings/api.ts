import { useQuery } from "@tanstack/react-query";
import { jsonBody, request } from "@/shared/lib/http";

import type { BlockingMode, UpstreamMode } from "#contract";

export { BLOCKING_MODES, type BlockingMode, UPSTREAM_MODES, type UpstreamMode } from "#contract";

export interface Settings {
  filteringEnabled: boolean;
  blockingMode: BlockingMode;
  blockingIpv4: string;
  blockingIpv6: string;
  blockedTtl: number;
  disableIpv6: boolean;
  upstreams: string[];
  upstreamMode: UpstreamMode;
  upstreamTimeoutMs: number;
  cacheEnabled: boolean;
  cacheMinTtl: number;
  cacheMaxTtl: number;
  queryLogEnabled: boolean;
  maxDeviceClients: number;
  deviceClientWindowMinutes: number;
  echForcedDomains: string[];
}

export const SETTINGS_KEY = ["settings"];

export const settingsApi = {
  get: () => request<Settings>("/settings"),
  patch: (patch: Partial<Settings>) => request<Settings>("/settings", jsonBody("PATCH", patch)),
};

export function useSettings() {
  return useQuery({ queryKey: SETTINGS_KEY, queryFn: settingsApi.get });
}
