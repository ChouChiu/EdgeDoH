import { useQuery } from "@tanstack/react-query";
import { jsonBody, request } from "@/shared/lib/http";

export interface Device {
  id: string;
  name: string;
  createdAt: number;
  dohUrl: string;
}

export interface DeviceClients {
  /** 0 when the limit is off */
  limit: number;
  windowMinutes: number;
  clients: { client: string; lastSeen: number }[];
}

export const MAX_DEVICE_NAME = 64;

export const devicesApi = {
  list: () => request<Device[]>("/devices"),
  create: (name: string) => request<Device>("/devices", jsonBody("POST", { name })),
  rename: (id: string, name: string) => request<Device>(`/devices/${id}`, jsonBody("PATCH", { name })),
  remove: (id: string) => request<void>(`/devices/${id}`, { method: "DELETE" }),
  clients: (id: string) => request<DeviceClients>(`/devices/${id}/clients`),
  resetClients: (id: string) => request<void>(`/devices/${id}/clients`, { method: "DELETE" }),
  mobileconfigUrl: (id: string) => `/api/devices/${id}/mobileconfig`,
};

export const DEVICES_KEY = ["devices"];

export function useDevices() {
  return useQuery({ queryKey: DEVICES_KEY, queryFn: devicesApi.list });
}
