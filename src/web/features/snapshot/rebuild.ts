import { deviceRulesText, type FilterSource, publishSnapshot } from "#filter";
import { DEVICE_RULES_LIST_ID, devicesApi } from "@/features/devices/api";
import { listsApi } from "@/features/filters/api";
import { servicesApi, SERVICE_LIST_PREFIX } from "@/features/profiles/api";
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
  /** Neither services catalog could be fetched, so this snapshot has no services */
  servicesSkipped: boolean;
}

export interface RebuildOptions {
  /** Display name of the custom rules source inside the snapshot */
  customListName: string;
  /** Display name of the per-device overrides source */
  deviceRulesName: string;
  onStage?: (stage: RebuildStage) => void;
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Recompiles every enabled filter and route list, custom rules and the blocked-services catalog
 * in a Web Worker and activates the snapshot. Services are always compiled, unapplied, so profiles
 * can switch them on without a rebuild and logs can name the service behind each query.
 * Calls are serialised so overlapping installs never upload an outdated snapshot last
 */
export function rebuildSnapshot(options: RebuildOptions): Promise<RebuildResult> {
  const run = queue.then(() => doRebuild(options));
  queue = run.catch(() => undefined);
  return run;
}

async function doRebuild({ customListName, deviceRulesName, onStage }: RebuildOptions): Promise<RebuildResult> {
  onStage?.("download");
  // The catalog lives on GitHub Pages, which is not always reachable; filter lists must still compile without it
  const [lists, custom, deviceRules, services] = await Promise.all([
    listsApi.list(),
    rulesApi.get(),
    devicesApi.allRules(),
    servicesApi.list({ fresh: true }).catch(() => null),
  ]);
  const enabled = lists.filter((l) => l.enabled);
  const texts = await Promise.all(enabled.map((l) => listsApi.text(l.id)));
  const sources: FilterSource[] = enabled.map((l, i) => ({ id: l.id, name: l.name, text: texts[i]!, kind: l.kind }));
  if (custom.trim()) sources.push({ id: CUSTOM_LIST_ID, name: customListName, text: custom });
  if (deviceRules.length > 0) sources.push({ id: DEVICE_RULES_LIST_ID, name: deviceRulesName, text: deviceRulesText(deviceRules) });
  for (const s of services ?? []) sources.push({ id: SERVICE_LIST_PREFIX + s.id, name: s.name, text: s.rules.join("\n"), kind: "service" });

  if (sources.length === 0) {
    onStage?.("upload");
    await snapshotApi.clear();
    return { entries: 0, complex: 0, bytes: 0, lists: 0, uploaded: 0, servicesSkipped: services === null };
  }

  onStage?.("compile");
  const result = await compileInWorker({ sources });

  onStage?.("upload");
  const published = await publishSnapshot(result.snapshot, {
    existing: async () => new Set((await snapshotApi.manifest()).blobs),
    putBlob: (hash, bytes) => snapshotApi.putBlob(hash, bytes),
    commit: (manifest) => snapshotApi.commit(manifest),
  });
  const installed = new Set(lists.map((l) => l.id));
  await listsApi.reports(
    result.lists
      .filter((r) => installed.has(r.id))
      .map(({ id, rules, unsupported, reasons }) => ({ id, rules, unsupported, reasons })),
  );
  return { entries: result.entries, complex: result.complex, bytes: result.bytes, lists: sources.length, uploaded: published.uploaded, servicesSkipped: services === null };
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
