#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { compile, type FilterSource, publishSnapshot, SHARD_COUNT, type SnapshotFiles } from "#filter";

const USAGE = `Usage:
  cf-dns compile <file-or-url>... [-o snapshot/] [--max-complex N]
  cf-dns upload <snapshot/> --url https://dns.example.com

Sources may be prefixed with "id=" to set the list ID, e.g. adguard=https://.../filter_1.txt
upload reads CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET for a Cloudflare Access service token`;

const [command, ...rest] = process.argv.slice(2);

try {
  if (command === "compile") await compileCommand(rest);
  else if (command === "upload") await uploadCommand(rest);
  else {
    console.error(USAGE);
    process.exit(command === undefined || command === "--help" ? 0 : 1);
  }
} catch (err) {
  console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

async function compileCommand(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { output: { type: "string", short: "o", default: "snapshot" }, "max-complex": { type: "string" } },
  });
  if (positionals.length === 0) throw new Error("no sources given");

  const sources: FilterSource[] = [];
  for (const spec of positionals) {
    const eq = spec.indexOf("=");
    const location = eq > 0 && !spec.slice(0, eq).includes("/") ? spec.slice(eq + 1) : spec;
    const id = location === spec ? basename(location).replace(/\.[^.]+$/, "") : spec.slice(0, eq);
    sources.push({ id, name: id, text: await readSource(location) });
  }

  const started = performance.now();
  const maxComplex = values["max-complex"];
  const result = compile(sources, maxComplex ? { maxComplexRules: Number(maxComplex) } : {});
  await writeSnapshot(values.output, result.snapshot);

  for (const list of result.lists) {
    console.log(`${list.id}: ${list.rules} rules, ${list.unsupported} unsupported, ${list.duplicates} duplicates, ${list.badfiltered} badfiltered`);
    for (const [reason, count] of Object.entries(list.reasons)) console.log(`  ${count} × ${reason}`);
  }
  const ms = (performance.now() - started).toFixed(0);
  console.log(`wrote ${values.output}/: ${result.entries} entries, ${result.complex} complex, ${result.bytes} bytes in ${ms} ms`);
}

async function uploadCommand(args: string[]) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { url: { type: "string" } } });
  const dir = positionals[0];
  if (!dir || !values.url) throw new Error("upload needs a snapshot directory and --url");

  const headers: Record<string, string> = {};
  const id = process.env.CF_ACCESS_CLIENT_ID;
  const secret = process.env.CF_ACCESS_CLIENT_SECRET;
  if (id && secret) {
    headers["cf-access-client-id"] = id;
    headers["cf-access-client-secret"] = secret;
  }

  const call = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(new URL(`/api/rules/${path}`, values.url), { ...init, headers: { ...headers, ...init.headers }, redirect: "manual" });
    if (!res.ok) throw new Error(`${path} failed with HTTP ${res.status}: ${await res.text()}`);
    return res;
  };
  const result = await publishSnapshot(await readSnapshot(dir), {
    existing: async () => new Set(((await (await call("manifest")).json()) as { blobs: string[] }).blobs),
    putBlob: async (hash, bytes) => {
      await call(`blobs/${hash}`, { method: "PUT", headers: { "content-type": "application/octet-stream" }, body: bytes as Uint8Array<ArrayBuffer> });
    },
    commit: async (manifest) => (await call("commit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(manifest) })).json(),
  });
  console.log(`uploaded ${result.uploaded} blobs, reused ${result.reused}, ${result.bytes} bytes total`);
}

async function writeSnapshot(dir: string, files: SnapshotFiles): Promise<void> {
  await mkdir(dir, { recursive: true });
  await Bun.write(join(dir, "meta.json"), files.meta);
  await Promise.all(files.shards.map((s, i) => Bun.write(join(dir, shardName(i)), s)));
}

async function readSnapshot(dir: string): Promise<SnapshotFiles> {
  const read = async (name: string) => new Uint8Array(await Bun.file(join(dir, name)).arrayBuffer());
  return {
    meta: await read("meta.json"),
    shards: await Promise.all(Array.from({ length: SHARD_COUNT }, (_, i) => read(shardName(i)))),
  };
}

function shardName(i: number): string {
  return `shard-${String(i).padStart(2, "0")}.bin`;
}

async function readSource(location: string): Promise<string> {
  if (/^https?:\/\//.test(location)) {
    const res = await fetch(location);
    if (!res.ok) throw new Error(`fetching ${location} failed with HTTP ${res.status}`);
    return res.text();
  }
  return Bun.file(location).text();
}
