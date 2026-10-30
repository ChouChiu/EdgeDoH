import { buildQuery, RRType } from "#dns";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { alertSql, fillBuckets, parseFilter, statsConfig, summarySql, upstreamLatencySql } from "./query.ts";
import { toDataPoint } from "./record.ts";
import { HttpError } from "../../shared/http.ts";
import { api, createDevice, json, postQuery, publishRules } from "../../test/helpers.ts";

describe("parseFilter", () => {
  const parse = (qs: string) => parseFilter(new URLSearchParams(qs));

  it("defaults to the last 24 hours", () => {
    expect(parse("")).toEqual({ range: "24h" });
  });

  it("accepts whitelisted values only", () => {
    expect(parse("range=7d&device=abcdefghij&action=block&source=cache&search=Ads.Example")).toEqual({
      range: "7d",
      device: "abcdefghij",
      action: "block",
      source: "cache",
      search: "%ads.example%",
    });
    expect(parse("search=*.doubleclick.net").search).toBe("%.doubleclick.net");
    for (const qs of ["range=1y", "range=toString", "device=x'y", "action=drop", "source=x", "search=a'%20OR%201=1", "search=a%20b"]) {
      expect(() => parse(qs)).toThrow(HttpError);
    }
  });
});

describe("SQL builders", () => {
  it("weights counts by sample interval and applies filters", () => {
    const sql = summarySql("t", parseFilter(new URLSearchParams("range=1h&device=abcdefghij&search=ads")));
    expect(sql).toContain("SUM(_sample_interval) AS total");
    expect(sql).toContain("sumIf(_sample_interval, blob3 = 'block') AS blocked");
    expect(sql).toContain("WHERE timestamp > NOW() - INTERVAL '1' HOUR AND index1 = 'abcdefghij' AND blob1 LIKE '%ads%'");
  });

  it("counts a passed-on SERVFAIL as a failure, not as an answer", () => {
    expect(alertSql("t", 15)).toContain("sumIf(_sample_interval, blob4 = 'error' OR (blob4 = 'upstream' AND blob5 = 'SERVFAIL')) AS failed");
    expect(upstreamLatencySql("t", { range: "1h" })).toContain("blob5 != 'SERVFAIL'");
  });

  it("fills missing buckets", () => {
    const now = Date.parse("2026-10-24T12:34:00Z");
    const filled = fillBuckets([{ bucket: "2026-10-24T12:30:00Z", total: 3 }], { range: "1h" }, now, (bucket) => ({ bucket, total: 0 }));
    expect(filled).toHaveLength(13);
    expect(filled[0]).toEqual({ bucket: "2026-10-24T11:30:00Z", total: 0 });
    expect(filled.at(-1)).toEqual({ bucket: "2026-10-24T12:30:00Z", total: 3 });
  });

  it("refuses to run without credentials", () => {
    expect(() => statsConfig({ ...env, STATS_API_TOKEN: "" } as Env)).toThrow(/not configured/);
    expect(() => statsConfig({ ...env, STATS_DATASET: "x; DROP" } as unknown as Env)).toThrow(/valid table name/);
  });
});

describe("stats API", () => {
  it("returns the summary", async () => {
    expect(await (await api("/stats/summary")).json()).toEqual({
      range: "24h",
      total: 200,
      blocked: 50,
      rewritten: 2,
      allowlisted: 3,
      cached: 80,
      failed: 1,
      blockedRatio: 0.25,
      avgLatencyMs: 12.3,
    });
  });

  it("returns a gap-free time series", async () => {
    const { points } = await (await api("/stats/timeseries")).json<{ points: { bucket: string; total: number }[] }>();
    expect(points).toHaveLength(25);
    expect(points.at(-1)).toMatchObject({ total: 7, blocked: 2 });
    expect(points[0]).toMatchObject({ total: 0, blocked: 0 });
  });

  it("returns top lists", async () => {
    expect(await (await api("/stats/top/devices?limit=3")).json()).toEqual({
      range: "24h",
      kind: "devices",
      items: [{ key: "doubleclick.net", label: "Phone", count: 42 }],
    });
    expect((await api("/stats/top/nope")).status).toBe(400);
    expect((await api("/stats/top/constructor")).status).toBe(400);
  });

  it("returns the query log", async () => {
    const body = await (await api("/stats/logs?limit=1&action=block")).json<{ items: unknown[] }>();
    expect(body).toMatchObject({ limit: 1, offset: 0 });
    expect(body.items[0]).toEqual({
      time: "2026-10-24T15:30:00Z",
      device: "aaaaaaaaaa",
      deviceName: "Phone",
      name: "ads.example",
      type: "A",
      action: "block",
      source: "local",
      rcode: "NOERROR",
      rule: { text: "||ads.example^", listId: "test", line: 1 },
      latencyMs: 0,
      sampleInterval: 1,
    });
  });

  it("merges answers and failures per upstream host", async () => {
    const res = await api("/stats/upstreams?range=7d");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      range: "7d",
      items: [
        { host: "dns.google", answered: 90, failed: 10, avgMs: 23.5, p95Ms: 80, failureRate: 0.1 },
        { host: "down.test", answered: 0, failed: 7, avgMs: null, p95Ms: null, failureRate: 1 },
      ],
    });
  });

  it("maps bad input and upstream failures to HTTP errors", async () => {
    expect((await api("/stats/summary?range=forever")).status).toBe(400);
    const failed = await api("/stats/summary?search=fail_please");
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ error: "analytics engine query failed with HTTP 500" });
  });
});

describe("query recording", () => {
  afterEach(() => vi.restoreAllMocks());

  it("encodes events in the documented column order", () => {
    const response = new Uint8Array(12);
    response[3] = 3; // NXDOMAIN
    expect(
      toDataPoint({
        deviceId: "abcdefghij",
        deviceName: "Phone",
        name: "ads.example",
        type: RRType.HTTPS,
        action: "block",
        source: "local",
        response,
        rule: { text: "||ads.example^", listId: "adguard", line: 9 },
        upstream: "https://dns.google/dns-query",
        upstreamMs: 12,
        failed: ["https://down.test/dns-query", "https://other.test:8443/dns-query"],
        colo: "HKG",
        client: "Firefox",
        service: "tiktok",
        network: "Example ISP",
        asn: 64500,
        latencyMs: 3,
      }),
    ).toEqual({
      indexes: ["abcdefghij"],
      blobs: [
        "ads.example",
        "HTTPS",
        "block",
        "local",
        "NXDOMAIN",
        "||ads.example^",
        "adguard",
        "dns.google",
        "HKG",
        "Phone",
        "Firefox",
        "tiktok",
        "Example ISP",
        "down.test,other.test:8443",
      ],
      doubles: [3, 9, 64500, 12],
    });
  });

  it("writes one data point per answered query", async () => {
    const write = vi.spyOn(env.QUERY_LOG, "writeDataPoint");
    await publishRules("||stats-blocked.example^", "test", "Test");
    const { id } = await createDevice("Laptop");

    for (const name of ["stats-blocked.example", "stats-clean.example"]) {
      expect((await postQuery(id, buildQuery(name, RRType.A))).status).toBe(200);
    }

    expect(write).toHaveBeenCalledTimes(2);
    const [blocked, clean] = write.mock.calls.map(([point]) => point!);
    expect(blocked).toMatchObject({ indexes: [id], blobs: ["stats-blocked.example", "A", "block", "local", "NOERROR", "||stats-blocked.example^", "test", "", "", "Laptop", "", "", "", ""] });
    expect(clean?.blobs?.slice(0, 4)).toEqual(["stats-clean.example", "A", "pass", "upstream"]);
    expect(clean?.blobs?.[7]).toBe("primary.test");
    expect(clean?.doubles?.[3]).toBeGreaterThanOrEqual(0);
  });

  it("records the upstreams that failed before the answer", async () => {
    const write = vi.spyOn(env.QUERY_LOG, "writeDataPoint");
    const profile = await (await api("/profiles", json({ name: "Flaky", upstreams: ["https://down.test/dns-query", "https://backup.test/dns-query"] }))).json<{ id: string }>();
    const { id } = await createDevice("Flaky");
    await api(`/devices/${id}`, json({ profileId: profile.id }, "PATCH"));
    expect((await postQuery(id, buildQuery("stats-flaky.example", RRType.A))).status).toBe(200);
    const point = write.mock.calls.at(-1)![0]!;
    expect(point.blobs?.[7]).toBe("backup.test");
    expect(point.blobs?.[13]).toBe("down.test");
  });
});
