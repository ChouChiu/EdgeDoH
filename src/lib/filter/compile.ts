import { indexLabel } from "./glob.ts";
import { hash64 } from "./hash.ts";
import { badfilterKey, parseLine } from "./parse.ts";
import {
  type ComplexRules,
  encodeSnapshot,
  ENTRY_WORDS,
  EntryFlag,
  MAX_LINE,
  MAX_LISTS,
  type SnapshotFiles,
  SYNTAX_CODES,
} from "./snapshot.ts";
import type { Modifiers, Rule } from "./types.ts";

export interface FilterSource {
  id: string;
  name: string;
  text: string;
}

export interface CompileOptions {
  /** Wildcard and regex rules are tested one by one on every query, so their number is capped */
  maxComplexRules?: number;
  now?: number;
}

export interface ListReport {
  id: string;
  name: string;
  lines: number;
  /** Rules that made it into the snapshot */
  rules: number;
  unsupported: number;
  /** Unsupported rule counts keyed by reason */
  reasons: Record<string, number>;
  badfiltered: number;
  duplicates: number;
}

export interface CompileResult {
  snapshot: SnapshotFiles;
  /** Total bytes across meta and shards */
  bytes: number;
  lists: ListReport[];
  entries: number;
  complex: number;
}

export const DEFAULT_MAX_COMPLEX_RULES = 5000;

interface Parsed {
  rule: Rule;
  list: number;
}

/** Compiles filter lists into a snapshot. Pure and synchronous so it can run in a browser Web Worker */
export function compile(sources: FilterSource[], options: CompileOptions = {}): CompileResult {
  if (sources.length > MAX_LISTS) throw new Error(`at most ${MAX_LISTS} lists can be compiled together`);
  const maxComplex = options.maxComplexRules ?? DEFAULT_MAX_COMPLEX_RULES;

  const reports: ListReport[] = sources.map((s) => ({
    id: s.id,
    name: s.name,
    lines: 0,
    rules: 0,
    unsupported: 0,
    reasons: {},
    badfiltered: 0,
    duplicates: 0,
  }));
  const unsupported = (report: ListReport, reason: string) => {
    report.unsupported++;
    report.reasons[reason] = (report.reasons[reason] ?? 0) + 1;
  };

  // Pass 1: parse everything and collect $badfilter targets, which apply across lists
  const parsed: Parsed[] = [];
  const badfilters = new Set<string>();
  sources.forEach((source, list) => {
    const report = reports[list]!;
    const lines = source.text.split(/\r?\n/);
    report.lines = lines.length;
    if (lines.length > MAX_LINE) throw new Error(`list ${source.name} has more than ${MAX_LINE} lines`);
    lines.forEach((text, i) => {
      const result = parseLine(text, i + 1);
      if (result.type === "rules") for (const rule of result.rules) parsed.push({ rule, list });
      else if (result.type === "badfilter") badfilters.add(result.target);
      else if (result.type === "unsupported") unsupported(report, result.reason);
    });
  });

  // Pass 2: build the hash table and complex rule list
  const words: number[] = [];
  const seen = new Set<string>();
  const complex: ComplexRules = { texts: [], refs: [], index: {}, global: [] };
  // A Map avoids "__proto__"-style labels touching the prototype; it becomes a plain object below
  const complexIndex = new Map<string, number[]>();
  const complexSeen = new Set<string>();
  const mods: Modifiers[] = [];
  const modIndex = new Map<string, number>();

  const internMods = (m: Modifiers | undefined): number | undefined => {
    if (!m) return undefined;
    const key = JSON.stringify(m);
    let index = modIndex.get(key);
    if (index === undefined) {
      index = mods.length;
      mods.push(m);
      modIndex.set(key, index);
    }
    return index;
  };

  for (const { rule, list } of parsed) {
    const report = reports[list]!;
    if (rule.syntax === "adblock" && badfilters.has(badfilterKey(rule.text))) {
      report.badfiltered++;
      continue;
    }

    if (rule.pattern.kind === "wildcard" || rule.pattern.kind === "regex") {
      if (complexSeen.has(rule.text)) {
        report.duplicates++;
        continue;
      }
      if (complex.texts.length >= maxComplex) {
        unsupported(report, "complex rule limit reached");
        continue;
      }
      complexSeen.add(rule.text);
      const i = complex.texts.length;
      complex.texts.push(rule.text);
      complex.refs.push(((list << 22) | rule.line) >>> 0);
      const label = rule.pattern.kind === "wildcard" ? indexLabel(rule.pattern.glob) : undefined;
      if (label === undefined) {
        complex.global.push(i);
      } else {
        const slot = complexIndex.get(label);
        if (slot) slot.push(i);
        else complexIndex.set(label, [i]);
      }
      report.rules++;
      continue;
    }

    const m = internMods(rule.mods);
    const flags =
      (rule.action === "allow" ? EntryFlag.ALLOW : 0) |
      (rule.important ? EntryFlag.IMPORTANT : 0) |
      (rule.pattern.kind === "exact" ? EntryFlag.EXACT : 0) |
      (SYNTAX_CODES.indexOf(rule.syntax) << 3);
    const meta = (flags | ((m === undefined ? 0 : m + 1) << 8)) >>> 0;
    const [hi, lo] = hash64(rule.pattern.domain);

    const key = `${hi}:${lo}:${meta}`;
    if (seen.has(key)) {
      report.duplicates++;
      continue;
    }
    seen.add(key);
    words.push(hi, lo, meta, ((list << 22) | rule.line) >>> 0);
    report.rules++;
  }

  complex.index = Object.fromEntries([...complexIndex].map(([label, rules]) => [label, rules.length === 1 ? rules[0]! : rules]));
  const entries = sortEntries(words);
  const snapshot = encodeSnapshot(entries, {
    createdAt: options.now ?? Date.now(),
    lists: reports.map((r) => ({ id: r.id, name: r.name, rules: r.rules })),
    mods,
    complex,
  });
  const bytes = snapshot.meta.length + snapshot.shards.reduce((n, s) => n + s.length, 0);
  return { snapshot, bytes, lists: reports, entries: entries.length / ENTRY_WORDS, complex: complex.texts.length };
}

function sortEntries(words: number[]): Uint32Array {
  const count = words.length / ENTRY_WORDS;
  const order = new Uint32Array(count);
  for (let i = 0; i < count; i++) order[i] = i;
  order.sort((a, b) => words[a * 4]! - words[b * 4]! || words[a * 4 + 1]! - words[b * 4 + 1]!);

  const out = new Uint32Array(words.length);
  for (let i = 0; i < count; i++) {
    const from = order[i]! * ENTRY_WORDS;
    for (let w = 0; w < ENTRY_WORDS; w++) out[i * ENTRY_WORDS + w] = words[from + w]!;
  }
  return out;
}
