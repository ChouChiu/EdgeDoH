import { Rcode, RRType } from "#dns";
import { describe, expect, it } from "vitest";
import {
  compile,
  decodeListHead,
  parseListHeader,
  globMatch,
  indexLabel,
  regexPrefix,
  decodeMeta,
  decodeShard,
  hash64,
  inspect,
  loadSnapshot,
  match,
  missingShards,
  type MatchQuery,
  parseLine,
  parseRouteLine,
  type Rule,
  SHARD_COUNT,
  shardOf,
  SnapshotError,
  validateSnapshot,
  type Verdict,
} from "./index.ts";

function rulesOf(line: string): Rule[] {
  const r = parseLine(line, 1);
  if (r.type !== "rules") throw new Error(`expected rules for ${line}, got ${JSON.stringify(r)}`);
  return r.rules;
}

function engine(...lists: string[]) {
  const { snapshot, lists: reports } = compile(lists.map((text, i) => ({ id: `l${i}`, name: `List ${i}`, text })));
  const loaded = loadSnapshot(snapshot);
  validateSnapshot(loaded);
  const run = (name: string, type: number = RRType.A, client?: MatchQuery["client"]): Verdict =>
    match(loaded, { name, type, ...(client && { client }) });
  return { run, reports, loaded };
}

describe("parseLine", () => {
  it("skips comments, headers and blanks", () => {
    for (const line of ["", "   ", "! comment", "# comment", "[Adblock Plus 2.0]"]) {
      expect(parseLine(line, 1).type).toBe("skip");
    }
  });

  it("parses adblock domain rules into hashable patterns", () => {
    expect(rulesOf("||Example.ORG^")[0]).toMatchObject({ action: "block", pattern: { kind: "suffix", domain: "example.org" } });
    expect(rulesOf("||example.org^|")[0]?.pattern).toEqual({ kind: "suffix", domain: "example.org" });
    expect(rulesOf("@@|example.org^")[0]).toMatchObject({ action: "allow", pattern: { kind: "exact", domain: "example.org" } });
    expect(rulesOf("||example.org^$important")[0]).toMatchObject({ important: true });
  });

  it("parses hosts and domain-only lines as exact rules", () => {
    const hosts = rulesOf("0.0.0.0 ads.example.com tracker.example.com # trailing comment");
    expect(hosts.map((r) => r.pattern)).toEqual([
      { kind: "exact", domain: "ads.example.com" },
      { kind: "exact", domain: "tracker.example.com" },
    ]);
    expect(hosts[0]?.mods).toBeUndefined();
    expect(rulesOf("1.2.3.4 home.lan")[0]?.mods?.rewrite).toEqual({ rcode: 0, type: RRType.A, value: "1.2.3.4" });
    expect(rulesOf("example.net # comment")[0]).toMatchObject({ syntax: "domain", pattern: { kind: "exact", domain: "example.net" } });
    expect(parseLine("127.0.0.1 localhost", 1).type).toBe("skip");
  });

  it("turns wildcards into globs and keeps /regex/ rules", () => {
    expect(rulesOf("||ads*.example.com^")[0]?.pattern).toEqual({ kind: "wildcard", glob: { anchor: "domain", end: true, parts: ["ads", ".example.com"] } });
    expect(rulesOf(".doublepimp.com^")[0]?.pattern).toEqual({ kind: "wildcard", glob: { anchor: "none", end: true, parts: [".doublepimp.com"] } });
    expect(rulesOf("||prefix.")[0]?.pattern).toEqual({ kind: "wildcard", glob: { anchor: "domain", end: false, parts: ["prefix."] } });
    expect(rulesOf("|ads*")[0]?.pattern).toEqual({ kind: "wildcard", glob: { anchor: "start", end: false, parts: ["ads", ""] } });
    expect(rulesOf("/^ad[0-9]+\\./")[0]?.pattern).toEqual({ kind: "regex", source: "^ad[0-9]+\\." });
    expect(rulesOf("/ads$/")[0]?.pattern).toEqual({ kind: "regex", source: "ads$" });
  });

  it("parses modifiers", () => {
    const [rule] = rulesOf("||example.org^$dnstype=AAAA|https,client=~'Mom\\'s phone'|Kids,denyallow=a.example.org");
    expect(rule?.mods).toMatchObject({
      dnstype: { include: [RRType.AAAA, RRType.HTTPS], exclude: [] },
      client: { include: ["kids"], exclude: ["mom's phone"] },
      denyallow: ["a.example.org"],
    });
    expect(rulesOf("$dnstype=AAAA")[0]?.pattern).toEqual({ kind: "wildcard", glob: { anchor: "none", end: false, parts: ["", ""] } });
  });

  it("parses $dnsrewrite forms", () => {
    const rewrite = (line: string) => rulesOf(line)[0]?.mods?.rewrite;
    expect(rewrite("||a.test^$dnsrewrite=1.2.3.4")).toEqual({ rcode: 0, type: RRType.A, value: "1.2.3.4" });
    expect(rewrite("||a.test^$dnsrewrite=abcd::1234")).toEqual({ rcode: 0, type: RRType.AAAA, value: "abcd::1234" });
    expect(rewrite("||a.test^$dnsrewrite=Example.NET")).toEqual({ rcode: 0, type: RRType.CNAME, value: "example.net" });
    expect(rewrite("||a.test^$dnsrewrite=REFUSED")).toEqual({ rcode: Rcode.REFUSED });
    expect(rewrite("||a.test^$dnsrewrite=NXDOMAIN;;")).toEqual({ rcode: Rcode.NXDOMAIN });
    expect(rewrite("||a.test^$dnsrewrite=NOERROR;A;10.0.0.1")).toEqual({ rcode: 0, type: RRType.A, value: "10.0.0.1" });
    // Keyword lookups must not resolve Object.prototype members
    expect(rewrite("||a.test^$dnsrewrite=constructor")).toEqual({ rcode: 0, type: RRType.CNAME, value: "constructor" });
    expect(parseLine("||a.test^$dnsrewrite=toString;A;1.2.3.4", 1)).toEqual({ type: "unsupported", reason: "unknown rcode in $dnsrewrite: toString" });
    expect(rulesOf("@@||a.test^$dnsrewrite")[0]?.mods?.rewriteException).toBe(true);
    expect(rulesOf("@@||a.test^$dnsrewrite=1.2.3.4")[0]?.mods?.rewriteException).toEqual({ rcode: 0, type: RRType.A, value: "1.2.3.4" });
  });

  it("reports unsupported rules with a reason", () => {
    const reason = (line: string) => {
      const r = parseLine(line, 1);
      return r.type === "unsupported" ? r.reason : r.type;
    };
    expect(reason("example.com##.banner")).toBe("cosmetic rule");
    expect(reason("||example.com^$third-party")).toBe("unsupported modifier $third-party");
    expect(reason("||example.com^$ctag=device_pc")).toBe("unsupported modifier $ctag");
    expect(reason("||example.com/ads.js")).toBe("URL patterns cannot match hostnames");
    expect(reason("/[/")).toBe("invalid regular expression");
    expect(reason("||ads^example.com")).toBe("separator inside pattern");
    expect(reason("||a.test^$dnstype=BOGUS")).toMatch(/unknown DNS type/);
    expect(reason("||a.test^$dnsrewrite=NOERROR;MX;10 mail.test")).toMatch(/unsupported \$dnsrewrite type/);
  });
});

describe("match", () => {
  it("blocks domains and subdomains, but exact rules only the name itself", () => {
    const { run } = engine("||ads.example^\n|exact.example^\n0.0.0.0 hosts.example\nplain.example");
    expect(run("ads.example").action).toBe("block");
    expect(run("deep.sub.ads.example").action).toBe("block");
    expect(run("notads.example").action).toBe("pass");
    expect(run("exact.example").action).toBe("block");
    expect(run("www.exact.example").action).toBe("pass");
    expect(run("hosts.example").action).toBe("block");
    expect(run("www.hosts.example").action).toBe("pass");
    expect(run("plain.example").action).toBe("block");
    expect(run("www.plain.example").action).toBe("pass");
  });

  it("follows AdGuard priority order", () => {
    const { run } = engine(
      [
        "||p1.test^",
        "@@||p1.test^",
        "||p2.test^$important",
        "@@||p2.test^",
        "||p3.test^$important",
        "@@||p3.test^$important",
        "||p4.test^",
        "@@||allowed.p4.test^",
      ].join("\n"),
    );
    expect(run("p1.test").action).toBe("allow");
    expect(run("p2.test").action).toBe("block");
    expect(run("p3.test").action).toBe("allow");
    expect(run("x.p4.test").action).toBe("block");
    expect(run("x.allowed.p4.test").action).toBe("allow");
  });

  it("reports which rule matched", () => {
    const { run } = engine("! header\n||ads.example^$important", "@@||ok.example^\n1.2.3.4 lan.example");
    expect(run("x.ads.example")).toEqual({ action: "block", rule: { text: "||ads.example^$important", listId: "l0", line: 2 } });
    expect(run("ok.example")).toMatchObject({ action: "allow", rule: { text: "@@||ok.example^", listId: "l1", line: 1 } });
    expect(run("lan.example")).toMatchObject({ rule: { text: "1.2.3.4 lan.example", listId: "l1", line: 2 } });
  });

  it("matches regex and wildcard rules", () => {
    const { run } = engine("/^ad[0-9]+\\./\n||cdn*.tracker.test^\n.doublepimp.com^");
    expect(run("ad42.example.com").action).toBe("block");
    expect(run("bad42.example.com").action).toBe("pass");
    expect(run("cdn7.tracker.test").action).toBe("block");
    expect(run("x.cdn.tracker.test").action).toBe("block");
    expect(run("www.doublepimp.com").action).toBe("block");
  });

  it("applies $dnstype, $client and $denyallow", () => {
    const { run } = engine(
      [
        "||v6.test^$dnstype=AAAA",
        "||kids.test^$client=Kids|192.168.1.0/24",
        "||notmom.test^$client=~Mom",
        "||wide.test^$denyallow=ok.wide.test",
      ].join("\n"),
    );
    expect(run("v6.test", RRType.A).action).toBe("pass");
    expect(run("v6.test", RRType.AAAA).action).toBe("block");

    const kids = { id: "aaaaaaaaaa", name: "Kids" };
    const mom = { id: "bbbbbbbbbb", name: "Mom" };
    expect(run("kids.test", RRType.A, kids).action).toBe("block");
    expect(run("kids.test", RRType.A, mom).action).toBe("pass");
    expect(run("kids.test", RRType.A, { ...mom, ip: "192.168.1.77" }).action).toBe("block");
    expect(run("kids.test", RRType.A).action).toBe("pass");
    expect(run("notmom.test", RRType.A, mom).action).toBe("pass");
    expect(run("notmom.test", RRType.A, kids).action).toBe("block");

    expect(run("wide.test").action).toBe("block");
    expect(run("ok.wide.test").action).toBe("pass");
    expect(run("x.ok.wide.test").action).toBe("pass");
  });

  it("applies rewrites above every other rule", () => {
    const { run } = engine(
      [
        "||rw.test^$dnsrewrite=10.0.0.1",
        "||rw.test^$dnsrewrite=10.0.0.2",
        "||rw.test^$dnsrewrite=fd00::1",
        "@@||rw.test^",
        "||cname.test^$dnsrewrite=target.test",
        "||nx.test^$dnsrewrite=NXDOMAIN",
        "||nx.test^$dnsrewrite=1.1.1.1",
        "||cancel.test^$dnsrewrite=1.1.1.1",
        "@@||cancel.test^$dnsrewrite",
        "||one.test^$dnsrewrite=1.1.1.1",
        "||one.test^$dnsrewrite=2.2.2.2",
        "@@||one.test^$dnsrewrite=1.1.1.1",
      ].join("\n"),
    );
    expect(run("rw.test", RRType.A)).toMatchObject({ action: "rewrite", rcode: 0, records: [{ type: RRType.A, value: "10.0.0.1" }, { type: RRType.A, value: "10.0.0.2" }] });
    expect(run("rw.test", RRType.AAAA)).toMatchObject({ records: [{ type: RRType.AAAA, value: "fd00::1" }] });
    expect(run("rw.test", RRType.TXT)).toMatchObject({ action: "rewrite", records: [] });
    expect(run("cname.test", RRType.AAAA)).toMatchObject({ records: [{ type: RRType.CNAME, value: "target.test" }] });
    expect(run("nx.test")).toMatchObject({ action: "rewrite", rcode: Rcode.NXDOMAIN, records: [] });
    expect(run("cancel.test").action).toBe("pass");
    expect(run("one.test")).toMatchObject({ records: [{ type: RRType.A, value: "2.2.2.2" }] });
  });

  it("treats non-null hosts addresses as rewrites", () => {
    const { run } = engine("192.168.1.10 nas.lan\n:: v6null.lan\nfd00::10 nas6.lan");
    expect(run("nas.lan", RRType.A)).toMatchObject({ action: "rewrite", records: [{ type: RRType.A, value: "192.168.1.10" }] });
    expect(run("nas.lan", RRType.AAAA)).toMatchObject({ action: "rewrite", records: [] });
    expect(run("nas6.lan", RRType.AAAA)).toMatchObject({ records: [{ type: RRType.AAAA, value: "fd00::10" }] });
    expect(run("v6null.lan").action).toBe("block");
  });
});

describe("compile", () => {
  it("drops rules disabled by $badfilter in any list", () => {
    const { run, reports } = engine("||bad.test^\n||keep.test^\n@@||ex.test^\n||ex.test^", "||bad.test^$badfilter\n@@||ex.test^$badfilter");
    expect(run("bad.test").action).toBe("pass");
    expect(run("keep.test").action).toBe("block");
    expect(run("ex.test").action).toBe("block");
    expect(reports[0]?.badfiltered).toBe(2);
  });

  it("deduplicates identical rules within a list and reports unsupported ones", () => {
    const { reports, loaded } = engine("||dup.test^\n||dup.test^\nexample.com##.ad\n||x.test^$third-party\n||x.test^$third-party", "||dup.test^");
    expect(loaded.meta.entries).toBe(2);
    expect(reports[0]).toMatchObject({ rules: 1, duplicates: 1, unsupported: 3, reasons: { "cosmetic rule": 1, "unsupported modifier $third-party": 2 } });
    expect(reports[1]).toMatchObject({ rules: 1, duplicates: 0 });
  });

  it("caps complex rules", () => {
    const { reports } = (() => {
      const result = compile([{ id: "x", name: "x", text: "/a/\n/b/\n/c/" }], { maxComplexRules: 2 });
      return { reports: result.lists };
    })();
    expect(reports[0]).toMatchObject({ rules: 2, reasons: { "complex rule limit reached": 1 } });
  });

  it("produces byte-identical snapshots for identical input", () => {
    const input = [{ id: "a", name: "A", text: "||a.test^\n||b.test^\n/c/" }];
    expect(compile(input, { now: 1 }).snapshot).toEqual(compile(input, { now: 1 }).snapshot);
  });
});

describe("snapshot", () => {
  const files = () => compile([{ id: "a", name: "A", text: "||a.test^\n||b.test^\n||c.test^\n/x+/" }]).snapshot;

  it("splits entries into shards by hash prefix", () => {
    const { shards, meta } = files();
    expect(shards).toHaveLength(SHARD_COUNT);
    const decoded = shards.map((s, i) => decodeShard(s, i));
    expect(decoded.reduce((n, e) => n + e.length / 4, 0)).toBe(3);
    const [hi] = hash64("a.test");
    expect(decoded[shardOf(hi)]!.includes(hi)).toBe(true);
    expect(JSON.parse(new TextDecoder().decode(meta))).toMatchObject({ format: 3, entries: 3, complex: { texts: ["/x+/"], global: [0], index: {} } });
  });

  it("loads shards on demand", () => {
    const { meta, shards } = files();
    const snapshot = decodeMeta(meta);
    const missing = missingShards(snapshot, "www.a.test");
    expect(missing.length).toBeGreaterThan(0);
    expect(() => match(snapshot, { name: "www.a.test", type: RRType.A })).toThrow(/not loaded/);
    for (const i of missing) snapshot.shards[i] = decodeShard(shards[i]!, i);
    expect(missingShards(snapshot, "www.a.test")).toEqual([]);
    expect(match(snapshot, { name: "www.a.test", type: RRType.A }).action).toBe("block");
  });

  it("rejects corrupt input", () => {
    const { meta, shards } = files();
    expect(() => decodeShard(shards[0]!.subarray(0, 10))).toThrow(SnapshotError);
    const bad = shards[0]!.slice();
    bad[0] = 0;
    expect(() => decodeShard(bad)).toThrow(/not a cf-dns shard/);
    expect(() => decodeShard(shards[1]!, 2)).toThrow(/expected shard 2/);
    expect(() => decodeMeta(meta.subarray(0, 5))).toThrow(/invalid snapshot metadata/);
    expect(() => decodeMeta(new TextEncoder().encode('{"format":1}'))).toThrow(/unsupported snapshot format/);
  });

  it("decodes unaligned shards", () => {
    const { shards } = files();
    const shard = shards.find((s) => s.length > 16)!;
    const padded = new Uint8Array(shard.length + 1);
    padded.set(shard, 1);
    expect(decodeShard(padded.subarray(1))).toEqual(decodeShard(shard));
  });

  it("detects entries in the wrong shard or out of order", () => {
    const { meta, shards } = compile([{ id: "a", name: "A", text: Array.from({ length: 200 }, (_, i) => `||d${i}.test^`).join("\n") }]).snapshot;
    const full = shards.findIndex((s) => s.length >= 16 + 32);
    const swapped = shards.map((s) => s.slice());
    const shard = swapped[full]!;
    const first = shard.slice(16, 32);
    shard.copyWithin(16, 32, 48);
    shard.set(first, 32);
    expect(() => validateSnapshot(loadSnapshot({ meta, shards: swapped }))).toThrow(/not sorted/);
    const moved = shards.map((s) => s.slice());
    [moved[0], moved[1]] = [moved[1]!, moved[0]!];
    expect(() => loadSnapshot({ meta, shards: moved })).toThrow(/expected shard/);
  });
});

describe("globMatch", () => {
  const glob = (pattern: string) => {
    const r = parseLine(pattern, 1);
    if (r.type !== "rules" || r.rules[0]?.pattern.kind !== "wildcard") throw new Error(`not a wildcard: ${pattern}`);
    const g = r.rules[0].pattern.glob;
    return (name: string) => globMatch(g, name);
  };

  it("honours the || anchor at label boundaries only", () => {
    const m = glob("||ads*.example.com^");
    expect(m("ads1.example.com")).toBe(true);
    expect(m("x.ads.cdn.example.com")).toBe(true);
    expect(m("badads1.example.com")).toBe(false);
    expect(m("ads1.example.com.evil")).toBe(false);
  });

  it("handles segments without wildcards and prefixes", () => {
    expect(glob("||prefix.")("prefix.net")).toBe(true);
    expect(glob("||prefix.")("a.prefix.io")).toBe(true);
    expect(glob("||prefix.")("notprefix.io")).toBe(false);
    expect(glob("||example.org")("example.organic.com")).toBe(true);
    expect(glob("||example.org")("testexample.org")).toBe(false);
    expect(glob(".doublepimp.com^")("www.doublepimp.com")).toBe(true);
    expect(glob(".doublepimp.com^")("doublepimp.com")).toBe(false);
  });

  it("matches start anchors, end anchors and multiple wildcards", () => {
    expect(glob("|ad*")("ad.example")).toBe(true);
    expect(glob("|ad*")("bad.example")).toBe(false);
    expect(glob("ample.org|")("example.org")).toBe(true);
    expect(glob("ample.org|")("example.org.com")).toBe(false);
    const multi = glob("||a*b*c^");
    expect(multi("axbxc")).toBe(true);
    expect(multi("x.abc")).toBe(true);
    expect(multi("abcx")).toBe(false);
    // Overlapping segments must not be counted twice
    expect(glob("||ab*ba^")("aba")).toBe(false);
    expect(glob("||ab*ba^")("abba")).toBe(true);
  });

  it("treats a bare wildcard as match-all", () => {
    expect(glob("||*^$client=kids")("anything.example")).toBe(true);
    expect(glob("*$dnstype=AAAA")("x")).toBe(true);
  });
});

describe("complex rule index", () => {
  const label = (pattern: string) => {
    const r = parseLine(pattern, 1);
    if (r.type !== "rules" || r.rules[0]?.pattern.kind !== "wildcard") throw new Error(pattern);
    return indexLabel(r.rules[0].pattern.glob);
  };

  it("picks the longest label the name must contain whole", () => {
    expect(label("||ads*.example.com^")).toBe("example");
    expect(label("||st-n.ads*-adnow.com^")).toBe("st-n");
    expect(label("||fxhpaoxqyajvmdg.")).toBe("fxhpaoxqyajvmdg");
    expect(label(".3.n.2.1.l50.js")).toBe("l50");
    expect(label("||direct-specific.com")).toBe("direct-specific");
    expect(label("ads*.com^")).toBe("com");
    expect(label("*ads*")).toBeUndefined();
    expect(label("||*^$client=kids")).toBeUndefined();
  });

  it("extracts literal regex prefixes conservatively", () => {
    expect(regexPrefix("^139\\.45\\.197\\.2(4[0-9]|5[0-4]):")).toBe("139.45.197.2");
    expect(regexPrefix("^ad[0-9]+\\.")).toBe("ad");
    expect(regexPrefix("^ads?\\.")).toBe("ad");
    expect(regexPrefix("^ab|cd")).toBe("");
    expect(regexPrefix("ads$")).toBe("");
  });

  it("finds indexed rules, global rules and labels named like Object members", () => {
    const { run } = engine("||ads*.example.com^\n*tracker*\n||constructor.*^\n/^ad[0-9]+\\./");
    expect(run("ads1.example.com").action).toBe("block");
    expect(run("x.ads.cdn.example.com").action).toBe("block");
    expect(run("ads1.other.com").action).toBe("pass");
    expect(run("mytracker.net").action).toBe("block");
    expect(run("constructor.io").action).toBe("block");
    expect(run("toString.io").action).toBe("pass");
    expect(run("ad7.example.org").action).toBe("block");
  });
});

describe("list header", () => {
  it("reads AdGuard and hosts headers up to the first rule", () => {
    const adguard = [
      "[Adblock Plus 2.0]",
      "! Title: AdGuard DNS filter",
      "! Description: Filter composed of several other filters",
      "! Homepage: https://github.com/AdguardTeam/AdGuardSDNSFilter",
      "! License: https://github.com/AdguardTeam/AdGuardSDNSFilter/blob/master/LICENSE",
      "! Version: 2.0.1",
      "! Last modified: 2026-10-25T00:00:00.000Z",
      "! Title: Section title",
      "||ads.example^",
      "! Title: After the rules",
    ].join("\n");
    expect(parseListHeader(adguard)).toEqual({
      title: "AdGuard DNS filter",
      description: "Filter composed of several other filters",
      homepage: "https://github.com/AdguardTeam/AdGuardSDNSFilter",
      license: "https://github.com/AdguardTeam/AdGuardSDNSFilter/blob/master/LICENSE",
      version: "2.0.1",
      lastModified: "2026-10-25T00:00:00.000Z",
    });

    const hosts = "# Title: StevenBlack/hosts\n#\n# Date: 25 October 2026\n\n0.0.0.0 ads.example\n";
    expect(parseListHeader(hosts)).toEqual({ title: "StevenBlack/hosts", lastModified: "25 October 2026" });
    expect(parseListHeader("##.banner\n#@#.ad\n! Title: late")).toEqual({});
    expect(parseListHeader("! Title: " + "x".repeat(300)).title).toHaveLength(100);
    expect(parseListHeader("! constructor: x\n! toString: y")).toEqual({});
  });

  it("drops a line cut by the byte limit", () => {
    const head = new TextEncoder().encode("! Title: Full\n! Description: cut he");
    expect(decodeListHead(head, false)).toBe("! Title: Full\n");
    expect(decodeListHead(head, true)).toContain("cut he");
  });
});

describe("list kinds", () => {
  const snapshot = () =>
    loadSnapshot(
      compile([
        { id: "ads", name: "Ads", text: "||ads.example^" },
        { id: "service:tiktok", name: "TikTok", text: "||tiktok.example^", kind: "service" },
        { id: "route", name: "Route", text: "server=/cn.example/sub.example/114.114.114.114\nplain.example\n@@||skip.example^", kind: "route" },
      ]).snapshot,
    );

  it("filters with filter lists by default and reports services and routes either way", () => {
    const s = snapshot();
    expect(inspect(s, { name: "x.tiktok.example", type: RRType.A })).toEqual({ verdict: { action: "pass" }, service: "service:tiktok" });
    expect(inspect(s, { name: "a.cn.example", type: RRType.A })).toEqual({ verdict: { action: "pass" }, route: "route" });
    expect(match(s, { name: "ads.example", type: RRType.A }).action).toBe("block");
  });

  it("names the most specific service, the narrower one on a tie", () => {
    const s = loadSnapshot(
      compile([
        { id: "service:apple", name: "Apple", text: "||apple.example^\n||music.apple.example^\n||icloud.example^", kind: "service" },
        { id: "service:apple_music", name: "AppleMusic", text: "||music.apple.example^", kind: "service" },
        { id: "service:cdn", name: "CDN", text: "||img.icloud.example^\n@@||music.apple.example^", kind: "service" },
      ]).snapshot,
    );
    expect(inspect(s, { name: "x.music.apple.example", type: RRType.A }).service).toBe("service:apple_music");
    expect(inspect(s, { name: "www.apple.example", type: RRType.A }).service).toBe("service:apple");
    expect(inspect(s, { name: "img.icloud.example", type: RRType.A }).service).toBe("service:cdn");
  });

  it("keeps a rule shared with other lists under every service", () => {
    const s = loadSnapshot(
      compile([
        { id: "ads", name: "Ads", text: "||music.apple.example^" },
        { id: "service:apple", name: "Apple", text: "||music.apple.example^", kind: "service" },
        { id: "service:apple_music", name: "AppleMusic", text: "||music.apple.example^", kind: "service" },
      ]).snapshot,
    );
    const name = "music.apple.example";
    expect(inspect(s, { name, type: RRType.A }).service).toBe("service:apple");
    expect(match(s, { name, type: RRType.A, active: Uint8Array.of(0, 0, 1) }).action).toBe("block");
  });

  it("keeps a rule shared by two filter lists under both", () => {
    const s = loadSnapshot(
      compile([
        { id: "a", name: "A", text: "||x.example^\n||x.example^" },
        { id: "b", name: "B", text: "||x.example^" },
      ]).snapshot,
    );
    expect(match(s, { name: "x.example", type: RRType.A, active: Uint8Array.of(0, 1) })).toMatchObject({ action: "block", rule: { listId: "b" } });
    expect(match(s, { name: "x.example", type: RRType.A })).toMatchObject({ action: "block", rule: { listId: "a" } });
  });

  it("applies exactly the lists in the active mask", () => {
    const s = snapshot();
    const active = Uint8Array.of(0, 1, 0);
    expect(match(s, { name: "ads.example", type: RRType.A, active }).action).toBe("pass");
    expect(match(s, { name: "x.tiktok.example", type: RRType.A, active }).action).toBe("block");
  });

  it("reads route lists as suffix domains, dnsmasq lines included", () => {
    expect(parseRouteLine("server=/a.example/b.example/1.1.1.1", 1)).toMatchObject({
      type: "rules",
      rules: [{ pattern: { kind: "suffix", domain: "a.example" } }, { pattern: { kind: "suffix", domain: "b.example" } }],
    });
    expect(parseRouteLine("plain.example", 2)).toMatchObject({ rules: [{ pattern: { kind: "suffix", domain: "plain.example" } }] });
    expect(parseRouteLine("@@||skip.example^", 3).type).toBe("unsupported");
    const s = snapshot();
    expect(inspect(s, { name: "deep.plain.example", type: RRType.A }).route).toBe("route");
    expect(inspect(s, { name: "skip.example", type: RRType.A }).route).toBeUndefined();
  });
});
