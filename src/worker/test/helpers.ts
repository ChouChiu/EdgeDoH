import { compile, type PublishResult, publishSnapshot, type SnapshotFiles } from "#filter";
import { exports } from "cloudflare:workers";
import { expect } from "vitest";

/** Requests to localhost skip Access through ACCESS_DEV_BYPASS */
export const ORIGIN = "http://localhost";

export function api(path: string, init?: RequestInit): Promise<Response> {
  return exports.default.fetch(`${ORIGIN}/api${path}`, init);
}

export function json(body: unknown, method = "POST"): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

export async function createDevice(name = "phone"): Promise<{ id: string; dohUrl: string }> {
  const res = await api("/devices", json({ name }));
  expect(res.status).toBe(201);
  return res.json();
}

export function postQuery(deviceId: string, query: BodyInit, headers?: Record<string, string>): Promise<Response> {
  return exports.default.fetch(`${ORIGIN}/dns-query/${deviceId}`, {
    method: "POST",
    headers: { "content-type": "application/dns-message", ...headers },
    body: query,
  });
}

async function ok(res: Response): Promise<Response> {
  if (!res.ok) throw new Error(`${res.url} -> ${res.status} ${await res.text()}`);
  return res;
}

/** Publishes through the same blob + commit protocol the dashboard uses */
export function publish(files: SnapshotFiles): Promise<PublishResult> {
  return publishSnapshot(files, {
    existing: async () => new Set((await (await ok(await api("/rules/manifest"))).json<{ blobs: string[] }>()).blobs),
    putBlob: async (hash, bytes) => {
      await ok(await api(`/rules/blobs/${hash}`, { method: "PUT", body: bytes as Uint8Array<ArrayBuffer> }));
    },
    commit: async (manifest) => (await ok(await api("/rules/commit", json(manifest)))).json(),
  });
}

export function publishRules(text: string, id = "test", name = "Test list"): Promise<PublishResult> {
  return publish(compile([{ id, name, text }]).snapshot);
}
