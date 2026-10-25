import type { SnapshotFiles } from "./snapshot.ts";

/** Transport for publishSnapshot, implemented over the Worker's /api/rules endpoints */
export interface PublishClient {
  /** Blob hashes the server already holds for the active snapshot */
  existing(): Promise<Set<string>>;
  putBlob(hash: string, bytes: Uint8Array): Promise<void>;
  commit(manifest: { meta: string; shards: string[] }): Promise<unknown>;
}

export interface PublishResult {
  uploaded: number;
  reused: number;
  bytes: number;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Uploads only the blobs the server does not have yet, then switches the active snapshot.
 * Blobs are content-addressed, so editing a few custom rules usually re-sends one or two shards
 */
export async function publishSnapshot(files: SnapshotFiles, client: PublishClient, concurrency = 6): Promise<PublishResult> {
  const all = [files.meta, ...files.shards];
  const hashes = await Promise.all(all.map(sha256Hex));
  const existing = await client.existing();

  // Identical shards (e.g. two empty ones) share a hash and go up once
  const pending = [...new Map(all.map((bytes, i) => [hashes[i]!, bytes])).entries()]
    .filter(([hash]) => !existing.has(hash))
    .map(([hash, bytes]) => ({ hash, bytes }));
  let next = 0;
  const worker = async () => {
    while (next < pending.length) {
      const blob = pending[next++]!;
      await client.putBlob(blob.hash, blob.bytes);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker));

  await client.commit({ meta: hashes[0]!, shards: hashes.slice(1) });
  return { uploaded: pending.length, reused: all.length - pending.length, bytes: all.reduce((n, b) => n + b.length, 0) };
}
