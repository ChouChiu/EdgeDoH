import type { Modifiers } from "./types.ts";

/**
 * A snapshot is one JSON meta file plus SHARD_COUNT binary shards. Entries are split by the top
 * bits of their hash, so a cold Workers isolate reads only the few shards a query touches
 * instead of the whole table. Shard layout, little-endian:
 *
 *   0  u32  magic "CFDS"
 *   4  u16  format version
 *   6  u16  shard index
 *   8  u32  entry count
 *  12  u32  reserved
 *  16       entries, 4 x u32 each: hash hi, hash lo, meta, ref (sorted by hi, lo)
 *
 * Entry meta: bit 0 allow, bit 1 important, bit 2 exact (else suffix), bits 3-4 syntax,
 * bits 8-31 modifier index + 1 (0 = none). Entry ref: list index << 22 | line
 */
export const SNAPSHOT_MAGIC = 0x53444643;
/** Shard binary layout version; unchanged shards keep their hashes across meta format bumps */
export const SNAPSHOT_FORMAT = 2;
export const META_FORMAT = 3;
export const SHARD_HEADER_BYTES = 16;
export const ENTRY_WORDS = 4;
export const SHARD_BITS = 5;
export const SHARD_COUNT = 1 << SHARD_BITS;

export const EntryFlag = {
  ALLOW: 1,
  IMPORTANT: 2,
  EXACT: 4,
} as const;

export const SYNTAX_CODES = ["adblock", "hosts", "domain"] as const;
export const MAX_LISTS = 1 << 10;
export const MAX_LINE = (1 << 22) - 1;

/**
 * filter: blocking and allowlist rules. service: one AdGuard blocked service, applied only when a
 * profile turns it on and otherwise used to name the service a query belongs to. route: domains
 * resolved through a dedicated upstream group, never applied as filters
 */
export const LIST_KINDS = ["filter", "service", "route"] as const;
export type ListKind = (typeof LIST_KINDS)[number];

export interface ListInfo {
  id: string;
  name: string;
  rules: number;
  /** Absent means `filter`, which keeps the meta small */
  kind?: ListKind;
}

/**
 * Wildcard and regex rules, kept as source text and parsed only when a query might match them.
 * Testing every one of a thousand rules on a cold isolate costs about 10 ms of CPU
 */
export interface ComplexRules {
  texts: string[];
  /** list index << 22 | line, per rule */
  refs: number[];
  /** Label a matching name must contain -> rule index or indexes */
  index: Record<string, number | number[]>;
  /** Rules without such a label, tested for every query */
  global: number[];
}

export interface SnapshotMeta {
  format: typeof META_FORMAT;
  createdAt: number;
  /** Total hash entries across all shards */
  entries: number;
  lists: ListInfo[];
  mods: Modifiers[];
  complex: ComplexRules;
}

export interface SnapshotFiles {
  meta: Uint8Array;
  /** Indexed by shard number, always SHARD_COUNT long */
  shards: Uint8Array[];
}

/** A complex rule after its first parse; null when the text no longer parses */
export interface CompiledComplex {
  action: "block" | "allow";
  important: boolean;
  mods: Modifiers | undefined;
  test: (name: string) => boolean;
}

export interface Snapshot {
  meta: SnapshotMeta;
  /** Lazily filled by the matcher, indexed like `meta.complex.texts` */
  compiled: (CompiledComplex | null | undefined)[];
  /** Decoded shard entry tables; undefined until loaded */
  shards: (Uint32Array | undefined)[];
}

export class SnapshotError extends Error {
  override name = "SnapshotError";
}

export function shardOf(hashHi: number): number {
  return hashHi >>> (32 - SHARD_BITS);
}

/** Splits a table sorted by (hi, lo) into shards; sorting by hi keeps every shard contiguous */
export function encodeSnapshot(entries: Uint32Array, meta: Omit<SnapshotMeta, "format" | "entries">): SnapshotFiles {
  if (entries.length % ENTRY_WORDS !== 0) throw new SnapshotError("entry array length is not a multiple of 4");
  const count = entries.length / ENTRY_WORDS;
  const shards: Uint8Array[] = [];
  let start = 0;
  for (let shard = 0; shard < SHARD_COUNT; shard++) {
    let end = start;
    while (end < count && shardOf(entries[end * ENTRY_WORDS]!) === shard) end++;
    const out = new Uint8Array(SHARD_HEADER_BYTES + (end - start) * ENTRY_WORDS * 4);
    const view = new DataView(out.buffer);
    view.setUint32(0, SNAPSHOT_MAGIC, true);
    view.setUint16(4, SNAPSHOT_FORMAT, true);
    view.setUint16(6, shard, true);
    view.setUint32(8, end - start, true);
    new Uint32Array(out.buffer, SHARD_HEADER_BYTES).set(entries.subarray(start * ENTRY_WORDS, end * ENTRY_WORDS));
    shards.push(out);
    start = end;
  }
  if (start !== count) throw new SnapshotError("entries are not sorted by hash");
  const full: SnapshotMeta = { format: META_FORMAT, entries: count, ...meta };
  return { meta: new TextEncoder().encode(JSON.stringify(full)), shards };
}

/** Builds a snapshot with no shards loaded yet */
export function decodeMeta(input: ArrayBuffer | Uint8Array | string): Snapshot {
  let meta: SnapshotMeta;
  try {
    meta = JSON.parse(typeof input === "string" ? input : new TextDecoder().decode(input));
  } catch {
    throw new SnapshotError("invalid snapshot metadata");
  }
  if (meta?.format !== META_FORMAT) throw new SnapshotError(`unsupported snapshot format ${String(meta?.format)}`);
  const c = meta.complex;
  if (
    !Array.isArray(meta.lists) ||
    !Array.isArray(meta.mods) ||
    !Array.isArray(c?.texts) ||
    !Array.isArray(c.refs) ||
    !Array.isArray(c.global) ||
    typeof c.index !== "object" ||
    c.refs.length !== c.texts.length
  ) {
    throw new SnapshotError("invalid snapshot metadata");
  }
  return {
    meta,
    compiled: new Array<CompiledComplex | null | undefined>(c.texts.length),
    shards: new Array<Uint32Array | undefined>(SHARD_COUNT).fill(undefined),
  };
}

/** Zero-copy when `input` is 4-byte aligned, which KV `arrayBuffer` reads are */
export function decodeShard(input: ArrayBuffer | Uint8Array, expected?: number): Uint32Array {
  let bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteOffset % 4 !== 0) bytes = bytes.slice();
  if (bytes.length < SHARD_HEADER_BYTES) throw new SnapshotError("shard shorter than header");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== SNAPSHOT_MAGIC) throw new SnapshotError("not an EdgeDoH shard");
  const format = view.getUint16(4, true);
  if (format !== SNAPSHOT_FORMAT) throw new SnapshotError(`unsupported shard format ${format}`);
  const index = view.getUint16(6, true);
  if (expected !== undefined && index !== expected) throw new SnapshotError(`expected shard ${expected}, got ${index}`);
  const count = view.getUint32(8, true);
  if (SHARD_HEADER_BYTES + count * ENTRY_WORDS * 4 !== bytes.length) throw new SnapshotError("shard length mismatch");
  return new Uint32Array(bytes.buffer, bytes.byteOffset + SHARD_HEADER_BYTES, count * ENTRY_WORDS);
}

/** Decodes meta and every shard at once, for tests, tooling and the browser */
export function loadSnapshot(files: SnapshotFiles): Snapshot {
  if (files.shards.length !== SHARD_COUNT) throw new SnapshotError(`expected ${SHARD_COUNT} shards`);
  const snapshot = decodeMeta(files.meta);
  files.shards.forEach((bytes, i) => {
    snapshot.shards[i] = decodeShard(bytes, i);
  });
  return snapshot;
}

/** Full structural check; too slow for the Workers request path, so tooling and tests call it */
export function validateSnapshot(snapshot: Snapshot): void {
  const { meta } = snapshot;
  let total = 0;
  snapshot.shards.forEach((entries, shard) => {
    if (!entries) throw new SnapshotError(`shard ${shard} is not loaded`);
    const count = entries.length / ENTRY_WORDS;
    total += count;
    for (let i = 0; i < count; i++) {
      const o = i * ENTRY_WORDS;
      if (shardOf(entries[o]!) !== shard) throw new SnapshotError(`entry in the wrong shard ${shard}`);
      if (i > 0) {
        const ph = entries[o - ENTRY_WORDS]!;
        const pl = entries[o - ENTRY_WORDS + 1]!;
        if (ph > entries[o]! || (ph === entries[o]! && pl > entries[o + 1]!)) throw new SnapshotError("entries are not sorted");
      }
      if (entries[o + 2]! >>> 8 > meta.mods.length) throw new SnapshotError("entry references a missing modifier");
      if (entries[o + 3]! >>> 22 >= meta.lists.length) throw new SnapshotError("entry references a missing list");
    }
  });
  if (total !== meta.entries) throw new SnapshotError("entry count does not match metadata");
  const { texts, refs, index, global } = meta.complex;
  for (const ref of refs) if (ref >>> 22 >= meta.lists.length) throw new SnapshotError("complex rule references a missing list");
  const indexed = [...global, ...Object.values(index).flat()];
  if (indexed.some((i) => !Number.isInteger(i) || i < 0 || i >= texts.length)) throw new SnapshotError("complex index references a missing rule");
  if (new Set(indexed).size !== texts.length) throw new SnapshotError("complex index does not cover every rule exactly once");
}
