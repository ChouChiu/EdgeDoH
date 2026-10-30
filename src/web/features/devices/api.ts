import { useQuery } from "@tanstack/react-query";
import type { DeviceRuleAction } from "#contract";
import type { DeviceRule } from "#filter";
import { jsonBody, request } from "@/shared/lib/http";

export interface Device {
  id: string;
  name: string;
  createdAt: number;
  /** null: the default profile */
  profileId: string | null;
  /** Filtering is paused until this time; null when not paused */
  pausedUntil: number | null;
  dohUrl: string;
}

export interface DeviceClients {
  /** 0 when the limit is off */
  limit: number;
  windowMinutes: number;
  clients: { client: string; lastSeen: number }[];
}

export { DEVICE_RULES_LIST_ID, MAX_DEVICE_NAME, MAX_DEVICE_RULES } from "#contract";

export interface DeviceOverride {
  name: string;
  action: DeviceRuleAction;
}

export const devicesApi = {
  list: () => request<Device[]>("/devices"),
  create: (name: string) => request<Device>("/devices", jsonBody("POST", { name })),
  rename: (id: string, name: string) => request<Device>(`/devices/${id}`, jsonBody("PATCH", { name })),
  setProfile: (id: string, profileId: string | null) => request<Device>(`/devices/${id}`, jsonBody("PATCH", { profileId })),
  pause: (id: string, minutes: number) => request<Device>(`/devices/${id}/pause`, jsonBody("POST", { minutes })),
  remove: (id: string) => request<void>(`/devices/${id}`, { method: "DELETE" }),
  clients: (id: string) => request<DeviceClients>(`/devices/${id}/clients`),
  resetClients: (id: string) => request<void>(`/devices/${id}/clients`, { method: "DELETE" }),
  mobileconfigUrl: (id: string) => `/api/devices/${id}/mobileconfig`,
  rules: (id: string) => request<DeviceOverride[]>(`/devices/${id}/rules`),
  setRules: (id: string, rules: DeviceOverride[]) => request<DeviceOverride[]>(`/devices/${id}/rules`, jsonBody("PUT", rules)),
  /** Every device's overrides, for the snapshot compiler */
  allRules: () => request<DeviceRule[]>("/devices/rules"),
};

export const deviceRulesKey = (id: string) => ["devices", id, "rules"];

export const DEVICES_KEY = ["devices"];

export function useDevices() {
  return useQuery({ queryKey: DEVICES_KEY, queryFn: devicesApi.list });
}
