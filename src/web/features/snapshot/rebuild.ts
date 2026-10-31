import { type FilterSource, type ListReport, publishSnapshot } from "#filter";
import { snapshotApi } from "./api";
import type { CompileRequest, CompileResponse } from "./compile.worker";

export type RebuildStage = "download" | "compile" | "upload";

export interface RebuildResult {
  entries: number;
  complex: number;
  bytes: number;
  lists: number;
  /** Snapshot files actually sent; unchanged shards are skipped */
  uploaded: number;
  /** Neither services catalog could be fetched, so this snapshot has no services */
  servicesSkipped: boolean;
}

/** What goes into a snapshot, gathered by the app from the features that own it */
export interface RebuildSources {
  sources: FilterSource[];
  /** Neither services catalog could be fetched */
  servicesSkipped: boolean;
  /** Stores the compile report of each source */
  report: (lists: ListReport[]) => Promise<void>;
}

export interface RebuildOptions {
  load: () => Promise<RebuildSources>;
  onStage?: (stage: RebuildStage) => void;
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Compiles the loaded sources in a Web Worker and activates the snapshot. Calls are serialised so
 * overlapping installs never upload an outdated snapshot last
 */
export function rebuildSnapshot(options: RebuildOptions): Promise<RebuildResult> {
  const run = queue.then(() => doRebuild(options));
  queue = run.catch(() => undefined);
  return run;
}

async function doRebuild({ load, onStage }: RebuildOptions): Promise<RebuildResult> {
  onStage?.("download");
  const { sources, servicesSkipped, report } = await load();

  if (sources.length === 0) {
    onStage?.("upload");
    await snapshotApi.clear();
    return { entries: 0, complex: 0, bytes: 0, lists: 0, uploaded: 0, servicesSkipped };
  }

  onStage?.("compile");
  const result = await compileInWorker({ sources });

  onStage?.("upload");
  const published = await publishSnapshot(result.snapshot, {
    existing: async () => new Set((await snapshotApi.manifest()).blobs),
    putBlob: (hash, bytes) => snapshotApi.putBlob(hash, bytes),
    commit: (manifest) => snapshotApi.commit(manifest),
  });
  await report(result.lists);
  return { entries: result.entries, complex: result.complex, bytes: result.bytes, lists: sources.length, uploaded: published.uploaded, servicesSkipped };
}

function compileInWorker(request: CompileRequest): Promise<Extract<CompileResponse, { ok: true }>> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./compile.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<CompileResponse>) => {
      worker.terminate();
      if (event.data.ok) resolve(event.data);
      else reject(new Error(event.data.error));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "compile worker crashed"));
    };
    worker.postMessage(request);
  });
}
