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
  alertWebhookUrl: string;
  alertFailurePercent: number;
  alertBlockedPercent: number;
  alertLimitedQueries: number;
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

export const alertsApi = {
  test: () => request<{ status: number }>("/alerts/test", { method: "POST" }),
};

export const backupApi = {
  /** The backup file exactly as the Worker serves it, ready to save */
  export: async () => {
    const res = await fetch("/api/backup", { redirect: "manual" });
    if (!res.ok) await request("/backup");
    return res.blob();
  },
  import: (text: string) => request<ImportResult>("/backup", { method: "PUT", headers: { "content-type": "application/json" }, body: text }),
};

export interface SplitBackup {
  /** The backup without inline list texts and custom rules, which the Worker then stores empty */
  body: string;
  texts: { id: string; text: string }[];
  customRules: string;
}

/**
 * Takes the large texts out of a backup file so the import request stays small enough to parse
 * within the Worker's CPU budget; each text is uploaded afterwards in a request of its own.
 * A file that is not a backup object goes through unchanged, for the Worker to reject
 */
export function splitBackup(file: string): SplitBackup {
  const unchanged = { body: file, texts: [], customRules: "" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(file);
  } catch {
    return unchanged;
  }
  if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as { lists?: unknown }).lists)) return unchanged;
  const backup = { ...(parsed as { customRules?: unknown; lists: unknown[] }) };
  const texts: SplitBackup["texts"] = [];
  // Values of the wrong type stay in place so the Worker's validation reports them
  backup.lists = backup.lists.map((l) => {
    const { text, ...list } = (typeof l === "object" && l !== null ? l : {}) as { id?: unknown; text?: unknown };
    if (typeof text !== "string" || typeof list.id !== "string") return l;
    if (text !== "") texts.push({ id: list.id, text });
    return list;
  });
  const customRules = typeof backup.customRules === "string" ? backup.customRules : "";
  if (typeof backup.customRules === "string") delete backup.customRules;
  return { body: JSON.stringify(backup), texts, customRules };
}
