import { type FilterSource, publishSnapshot } from "#filter";
import { listsApi } from "@/features/filters/api";
import { CUSTOM_LIST_ID, rulesApi } from "@/features/rules/api";
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
}

export interface RebuildOptions {
  /** Display name of the custom rules source inside the snapshot */
  customListName: string;
  onStage?: (stage: RebuildStage) => void;
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Recompiles every enabled list plus custom rules in a Web Worker and activates the snapshot.
 * Calls are serialised so overlapping installs never upload an outdated snapshot last
 */
export function rebuildSnapshot(options: RebuildOptions): Promise<RebuildResult> {
  const run = queue.then(() => doRebuild(options));
  queue = run.catch(() => undefined);
  return run;
}

async function doRebuild({ customListName, onStage }: RebuildOptions): Promise<RebuildResult> {
  onStage?.("download");
  const [lists, custom] = await Promise.all([listsApi.list(), rulesApi.get()]);
  const enabled = lists.filter((l) => l.enabled);
  const texts = await Promise.all(enabled.map((l) => listsApi.text(l.id)));
  const sources: FilterSource[] = enabled.map((l, i) => ({ id: l.id, name: l.name, text: texts[i]! }));
  if (custom.trim()) sources.push({ id: CUSTOM_LIST_ID, name: customListName, text: custom });

  if (sources.length === 0) {
    onStage?.("upload");
    await snapshotApi.clear();
    return { entries: 0, complex: 0, bytes: 0, lists: 0, uploaded: 0 };
  }

  onStage?.("compile");
  const result = await compileInWorker({ sources });

  onStage?.("upload");
  const published = await publishSnapshot(result.snapshot, {
    existing: async () => new Set((await snapshotApi.manifest()).blobs),
    putBlob: (hash, bytes) => snapshotApi.putBlob(hash, bytes),
    commit: (manifest) => snapshotApi.commit(manifest),
  });
  await listsApi.reports(
    result.lists
      .filter((r) => r.id !== CUSTOM_LIST_ID)
      .map(({ id, rules, unsupported, reasons }) => ({ id, rules, unsupported, reasons })),
  );
  return { entries: result.entries, complex: result.complex, bytes: result.bytes, lists: sources.length, uploaded: published.uploaded };
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
