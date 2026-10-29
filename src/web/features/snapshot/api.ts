import { jsonBody, request } from "@/shared/lib/http";

export type SnapshotInfo =
  | { active: false }
  | {
      active: true;
      version: string;
      uploadedAt: number;
      createdAt: number;
      bytes: number;
      entries: number;
      complex: number;
      lists: { id: string; name: string; rules: number; kind?: "filter" | "service" | "route" }[];
    };

export const SNAPSHOT_KEY = ["rules"];

export const snapshotApi = {
  info: () => request<SnapshotInfo>("/rules"),
  manifest: () => request<{ blobs: string[] }>("/rules/manifest"),
  putBlob: (hash: string, bytes: Uint8Array) =>
    request<void>(`/rules/blobs/${hash}`, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream" },
      body: bytes as Uint8Array<ArrayBuffer>,
    }),
  commit: (manifest: { meta: string; shards: string[] }) => request<SnapshotInfo>("/rules/commit", jsonBody("POST", manifest)),
  clear: () => request<void>("/rules/snapshot", { method: "DELETE" }),
};
