import { useQuery } from "@tanstack/react-query";
import { jsonBody, request } from "@/shared/lib/http";

export const BLOCKING_MODES = ["null_ip", "custom_ip", "nxdomain", "refused", "nodata"] as const;
export type BlockingMode = (typeof BLOCKING_MODES)[number];

export const UPSTREAM_MODES = ["fallback", "parallel"] as const;
export type UpstreamMode = (typeof UPSTREAM_MODES)[number];

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
}

export const SETTINGS_KEY = ["settings"];

export const settingsApi = {
  get: () => request<Settings>("/settings"),
  patch: (patch: Partial<Settings>) => request<Settings>("/settings", jsonBody("PATCH", patch)),
};

export function useSettings() {
  return useQuery({ queryKey: SETTINGS_KEY, queryFn: settingsApi.get });
}
