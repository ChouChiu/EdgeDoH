import { createContext, useContext } from "react";
import { jsonBody, request } from "@/shared/lib/http";
import type { RebuildResult, RebuildStage } from "./rebuild";

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

export interface RebuildContextValue {
  stage: RebuildStage | null;
  /** Recompiles and activates the snapshot, reporting progress and errors as toasts */
  rebuild: (reason?: string) => Promise<RebuildResult | undefined>;
}

/** Provided once for the whole app by `RebuildProvider` */
export const RebuildContext = createContext<RebuildContextValue | null>(null);

export function useRebuild(): RebuildContextValue {
  const value = useContext(RebuildContext);
  if (!value) throw new Error("useRebuild must be used within RebuildProvider");
  return value;
}
