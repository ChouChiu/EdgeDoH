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

export interface ImportResult {
  devices: number;
  /** Downloaded lists to fetch again before the rebuild */
  pending: string[];
}

export const backupApi = {
  /** The backup file exactly as the Worker serves it, ready to save */
  export: async () => {
    const res = await fetch("/api/backup", { redirect: "manual" });
    if (!res.ok) await request("/backup");
    return res.blob();
  },
  import: (text: string) => request<ImportResult>("/backup", { method: "PUT", headers: { "content-type": "application/json" }, body: text }),
};
