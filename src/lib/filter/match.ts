import { encodeIPv4, encodeIPv6, Rcode, RRType } from "#dns";
import { globMatch, regexPrefix } from "./glob.ts";
import { hash64 } from "./hash.ts";
import { parseLine } from "./parse.ts";
import { type CompiledComplex, ENTRY_WORDS, EntryFlag, type Snapshot, SnapshotError, shardOf, SYNTAX_CODES } from "./snapshot.ts";
import type { ClientMatcher, Modifiers, Rewrite } from "./types.ts";

export interface MatchClient {
  id: string;
  name: string;
  ip?: string;
}

export interface MatchQuery {
  /** Lowercase, without trailing dot */
  name: string;
  type: number;
  client?: MatchClient;
  /**
   * Lists whose rules apply, indexed like the snapshot's lists (non-zero = on). Omitted means
   * every filter list and no service list
   */
  active?: Uint8Array;
}

export interface MatchedRule {
  text: string;
  listId: string;
  line: number;
}

export interface RewriteRecord {
  type: number;
  value: string;
}

export type Verdict =
  | { action: "pass" }
  | { action: "allow"; rule: MatchedRule }
  | { action: "block"; rule: MatchedRule }
  /** `records` may be empty: an empty NOERROR (NODATA) or a keyword rcode such as NXDOMAIN */
  | { action: "rewrite"; rule: MatchedRule; rcode: number; records: RewriteRecord[] };

/** A verdict plus what the name was recognised as, whether or not those lists were applied */
export interface Inspection {
  verdict: Verdict;
  /**
   * ID of the service list matching the name most specifically; when several match at the same
   * domain level, the one with fewer rules, which is the narrower service (AppleMusic over Apple)
   */
  service?: string;
  /** ID of the most specific route list covering the name */
  route?: string;
}

interface Candidate {
  /** Index into the snapshot's lists */
  list: number;
  /** Where the matched domain starts in the name: 0 is the name itself, complex rules sort last */
  pos: number;
  allow: boolean;
  important: boolean;
  mods: Modifiers | undefined;
  describe: () => MatchedRule;
}

/**
 * Evaluates a query against a snapshot with AdGuard priorities:
 * $dnsrewrite > @@…$important > …$important > @@… > blocking rules
 */
export function match(snapshot: Snapshot, query: MatchQuery): Verdict {
  return inspect(snapshot, query).verdict;
}

/**
 * One lookup that both filters and classifies: service and route lists are recognised even when
 * the query's `active` mask leaves them off. Candidates come most specific domain first
 */
export function inspect(snapshot: Snapshot, query: MatchQuery): Inspection {
  const lists = snapshot.meta.lists;
  const applied: Candidate[] = [];
  const out: Inspection = { verdict: { action: "pass" } };
  let service: { pos: number; rules: number } | undefined;
  for (const c of collect(snapshot, query)) {
    const kind = lists[c.list]?.kind ?? "filter";
    if (kind === "service" && !c.allow) {
      const { id, rules } = lists[c.list]!;
      if (!service || c.pos < service.pos || (c.pos === service.pos && rules < service.rules)) {
        service = { pos: c.pos, rules };
        out.service = id;
      }
    } else if (kind === "route" && !c.allow) out.route ??= lists[c.list]!.id;
    if (query.active ? query.active[c.list] : kind === "filter") applied.push(c);
  }
  out.verdict = decide(applied, query);
  return out;
}

function decide(candidates: Candidate[], query: MatchQuery): Verdict {
  if (candidates.length === 0) return { action: "pass" };

  const rewrites: Candidate[] = [];
  const rewriteExceptions: Rewrite[] = [];
  let cancelAllRewrites = false;
  let importantAllow: Candidate | undefined;
  let importantBlock: Candidate | undefined;
  let allow: Candidate | undefined;
  let block: Candidate | undefined;

  for (const c of candidates) {
    const m = c.mods;
    if (!c.allow && m?.rewrite) rewrites.push(c);
    else if (c.allow && m?.rewriteException) {
      if (m.rewriteException === true) cancelAllRewrites = true;
      else rewriteExceptions.push(m.rewriteException);
    } else if (c.allow) {
      if (c.important) importantAllow ??= c;
      else allow ??= c;
    } else if (c.important) importantBlock ??= c;
    else block ??= c;
  }

  if (!cancelAllRewrites) {
    const active = rewrites.filter((c) => !rewriteExceptions.some((e) => sameRewrite(e, c.mods!.rewrite!)));
    if (active.length > 0) return rewriteVerdict(active, query.type);
  }

  if (importantAllow) return { action: "allow", rule: importantAllow.describe() };
  if (importantBlock) return { action: "block", rule: importantBlock.describe() };
  if (allow) return { action: "allow", rule: allow.describe() };
  if (block) return { action: "block", rule: block.describe() };
  return { action: "pass" };
}

/** Shards a lookup of `name` needs that are not loaded yet; load them before calling match */
export function missingShards(snapshot: Snapshot, name: string): number[] {
  const missing = new Set<number>();
  forEachSuffix(name, (pos) => {
    const shard = shardOf(hash64(name, pos)[0]);
    if (!snapshot.shards[shard]) missing.add(shard);
  });
  return [...missing];
}

function forEachSuffix(name: string, fn: (pos: number) => void): void {
  for (let pos = 0; pos < name.length; ) {
    fn(pos);
    const dot = name.indexOf(".", pos);
    if (dot < 0) break;
    pos = dot + 1;
  }
}

function collect(snapshot: Snapshot, query: MatchQuery): Candidate[] {
  const { meta } = snapshot;
  const name = query.name;
  const out: Candidate[] = [];

  // Hash lookups for the name itself and every parent domain
  forEachSuffix(name, (pos) => {
    const [hi, lo] = hash64(name, pos);
    const entries = snapshot.shards[shardOf(hi)];
    if (!entries) throw new SnapshotError(`shard ${shardOf(hi)} is not loaded`);
    const count = entries.length / ENTRY_WORDS;
    for (let i = lowerBound(entries, count, hi, lo); i < count; i++) {
      const o = i * ENTRY_WORDS;
      if (entries[o] !== hi || entries[o + 1] !== lo) break;
      const flags = entries[o + 2]!;
      if (flags & EntryFlag.EXACT && pos > 0) continue;
      const modRef = flags >>> 8;
      const mods = modRef === 0 ? undefined : meta.mods[modRef - 1];
      if (mods && !modifiersApply(mods, query)) continue;
      const ref = entries[o + 3]!;
      const domain = name.slice(pos);
      out.push({
        list: ref >>> 22,
        pos,
        allow: (flags & EntryFlag.ALLOW) !== 0,
        important: (flags & EntryFlag.IMPORTANT) !== 0,
        mods,
        describe: () => ({
          text: entryText(flags, domain, mods),
          listId: meta.lists[ref >>> 22]?.id ?? "",
          line: ref & 0x3fffff,
        }),
      });
    }
  });

  // Wildcard and regex rules: only those indexed under one of the name's labels, plus the few without a label
  const { complex } = meta;
  const candidates = new Set<number>(complex.global);
  for (const label of name.split(".")) {
    if (!Object.hasOwn(complex.index, label)) continue;
    const slot = complex.index[label]!;
    if (typeof slot === "number") candidates.add(slot);
    else for (const i of slot) candidates.add(i);
  }
  // Ascending order keeps the reported rule stable: the earliest list line wins within a priority
  for (const i of [...candidates].sort((x, y) => x - y)) {
    const rule = compiledComplex(snapshot, i);
    if (!rule || !rule.test(name)) continue;
    if (rule.mods && !modifiersApply(rule.mods, query)) continue;
    const ref = complex.refs[i]!;
    out.push({
      list: ref >>> 22,
      pos: name.length,
      allow: rule.action === "allow",
      important: rule.important,
      mods: rule.mods,
      describe: () => ({ text: complex.texts[i]!, listId: meta.lists[ref >>> 22]?.id ?? "", line: ref & 0x3fffff }),
    });
  }

  return out;
}

/** Parses a complex rule on first use; the snapshot stores only its text */
function compiledComplex(snapshot: Snapshot, i: number): CompiledComplex | null {
  const cached = snapshot.compiled[i];
  if (cached !== undefined) return cached;
  const parsed = parseLine(snapshot.meta.complex.texts[i]!, 0);
  const rule = parsed.type === "rules" ? parsed.rules[0] : undefined;
  let compiled: CompiledComplex | null = null;
  if (rule && (rule.pattern.kind === "wildcard" || rule.pattern.kind === "regex")) {
    let test: (name: string) => boolean;
    if (rule.pattern.kind === "wildcard") {
      const glob = rule.pattern.glob;
      test = (name) => globMatch(glob, name);
    } else {
      const source = rule.pattern.source;
      const prefix = regexPrefix(source);
      let re: RegExp | undefined;
      // The RegExp is built, and compiled by V8, only once a name passes the literal prefix
      test = (name) => name.startsWith(prefix) && (re ??= new RegExp(source, "i")).test(name);
    }
    compiled = { action: rule.action, important: rule.important, mods: rule.mods, test };
  }
  snapshot.compiled[i] = compiled;
  return compiled;
}

function lowerBound(entries: Uint32Array, count: number, hi: number, lo: number): number {
  let l = 0;
  let r = count;
  while (l < r) {
    const m = (l + r) >>> 1;
    const h = entries[m * ENTRY_WORDS]!;
    if (h < hi || (h === hi && entries[m * ENTRY_WORDS + 1]! < lo)) l = m + 1;
    else r = m;
  }
  return l;
}

function modifiersApply(m: Modifiers, q: MatchQuery): boolean {
  if (m.dnstype) {
    if (m.dnstype.include.length > 0 && !m.dnstype.include.includes(q.type)) return false;
    if (m.dnstype.exclude.includes(q.type)) return false;
  }
  if (m.client && !clientApplies(m.client, q.client)) return false;
  if (m.denyallow?.some((d) => q.name === d || q.name.endsWith("." + d))) return false;
  return true;
}

function clientApplies(matcher: ClientMatcher, client: MatchClient | undefined): boolean {
  const hits = (value: string) =>
    client !== undefined &&
    (value === client.name.toLowerCase() || value === client.id || (client.ip !== undefined && ipMatches(value, client.ip)));
  if (matcher.exclude.some(hits)) return false;
  return matcher.include.length === 0 || matcher.include.some(hits);
}

/** Exact address or CIDR match; non-address values never match */
function ipMatches(value: string, ip: string): boolean {
  const slash = value.indexOf("/");
  const addr = parseIP(slash < 0 ? value : value.slice(0, slash));
  const target = parseIP(ip);
  if (!addr || !target || addr.length !== target.length) return false;
  const bits = slash < 0 ? addr.length * 8 : Number(value.slice(slash + 1));
  if (!Number.isInteger(bits) || bits < 0 || bits > addr.length * 8) return false;
  for (let i = 0; i < addr.length; i++) {
    const remaining = bits - i * 8;
    if (remaining <= 0) break;
    const mask = remaining >= 8 ? 0xff : (0xff << (8 - remaining)) & 0xff;
    if ((addr[i]! & mask) !== (target[i]! & mask)) return false;
  }
  return true;
}

function parseIP(s: string): Uint8Array | undefined {
  try {
    return s.includes(":") ? encodeIPv6(s) : encodeIPv4(s);
  } catch {
    return undefined;
  }
}

function sameRewrite(a: Rewrite, b: Rewrite): boolean {
  return a.rcode === b.rcode && a.type === b.type && a.value === b.value;
}

function rewriteVerdict(active: Candidate[], qtype: number): Verdict {
  // Keyword rewrites (NXDOMAIN, REFUSED, …) win and produce an empty answer
  const keyword = active.find((c) => c.mods!.rewrite!.rcode !== Rcode.NOERROR);
  if (keyword) return { action: "rewrite", rule: keyword.describe(), rcode: keyword.mods!.rewrite!.rcode, records: [] };

  const cname = active.find((c) => c.mods!.rewrite!.type === RRType.CNAME);
  if (cname) {
    return { action: "rewrite", rule: cname.describe(), rcode: Rcode.NOERROR, records: [{ type: RRType.CNAME, value: cname.mods!.rewrite!.value! }] };
  }

  const records: RewriteRecord[] = [];
  for (const c of active) {
    const r = c.mods!.rewrite!;
    if (r.type === qtype && r.value !== undefined) records.push({ type: r.type, value: r.value });
  }
  return { action: "rewrite", rule: active[0]!.describe(), rcode: Rcode.NOERROR, records };
}

function entryText(flags: number, domain: string, mods: Modifiers | undefined): string {
  const syntax = SYNTAX_CODES[(flags >>> 3) & 0x3];
  if (syntax === "domain") return domain;
  if (syntax === "hosts") return `${mods?.rewrite?.value ?? "0.0.0.0"} ${domain}`;
  const prefix = flags & EntryFlag.ALLOW ? "@@" : "";
  const anchor = flags & EntryFlag.EXACT ? "|" : "||";
  const suffix = mods ? `$${mods.raw}` : flags & EntryFlag.IMPORTANT ? "$important" : "";
  return `${prefix}${anchor}${domain}^${suffix}`;
}
