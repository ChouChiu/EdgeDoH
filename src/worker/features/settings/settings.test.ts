import { buildQuery, parseMessage, Rcode, rcodeOf, RRType } from "#dns";
import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { clientNetwork } from "../devices/client-guard.ts";
import { api, createDevice, json, ORIGIN, postQuery, publishRules } from "../../test/helpers.ts";

const DEFAULTS = {
  filteringEnabled: true,
  blockingMode: "null_ip",
  blockingIpv4: "",
  blockingIpv6: "",
  blockedTtl: 10,
  disableIpv6: false,
  upstreams: ["https://primary.test/dns-query", "https://backup.test/dns-query"],
  upstreamMode: "fallback",
  upstreamTimeoutMs: 3000,
  cacheEnabled: true,
  cacheMinTtl: 0,
  cacheMaxTtl: 86400,
  queryLogEnabled: true,
  maxDeviceClients: 0,
  deviceClientWindowMinutes: 60,
  echForcedDomains: [],
  alertWebhookUrl: "",
  alertFailurePercent: 5,
  alertBlockedPercent: 0,
  alertLimitedQueries: 1,
};

async function patch(settings: Record<string, unknown>) {
  const res = await api("/settings", json(settings, "PATCH"));
  expect(res.status).toBe(200);
  return res.json();
}

async function ask(deviceId: string, name: string, type: number = RRType.A) {
  const res = await postQuery(deviceId, buildQuery(name, type));
  return { res, msg: parseMessage(new Uint8Array(await res.arrayBuffer())) };
}

const address = (data: Uint8Array) => [...data].join(".");

afterEach(async () => {
  await patch(DEFAULTS);
});

describe("settings", () => {
  it("defaults to wrangler vars and validates changes", async () => {
    expect(await (await api("/settings")).json()).toEqual(DEFAULTS);
    for (const bad of [
      { blockingMode: "drop" },
      { blockedTtl: -1 },
      { upstreams: ["http://plain.test"] },
      { upstreams: [] },
      { upstreamMode: "random" },
      { upstreamTimeoutMs: 100 },
      { blockingIpv4: "1.2.3" },
      { blockingIpv6: "1.2.3.4" },
      { cacheMinTtl: 600, cacheMaxTtl: 60 },
      { blockingMode: "custom_ip" },
      { filteringEnabled: "yes" },
      { maxDeviceClients: -1 },
      { deviceClientWindowMinutes: 1 },
      { echForcedDomains: ["example.com", "example.com"] },
      { echForcedDomains: ["Example.com"] },
      { echForcedDomains: "example.com" },
      { nope: 1 },
      [],
    ]) {
      expect((await api("/settings", json(bad, "PATCH"))).status).toBe(400);
    }
  });

  it("applies the blocking mode and TTL to DNS answers", async () => {
    await publishRules("||mode.test^", "t", "t");
    expect(await patch({ blockingMode: "nxdomain", blockedTtl: 30 })).toMatchObject({ blockingMode: "nxdomain", blockedTtl: 30 });

    const { id } = await createDevice();
    const { res, msg } = await ask(id, "mode.test");
    expect(res.headers.get("cache-control")).toBe("private, max-age=30");
    expect(rcodeOf(msg.header)).toBe(Rcode.NXDOMAIN);
  });

  it("answers blocked names with custom addresses", async () => {
    await publishRules("||custom-ip.test^", "t", "t");
    await patch({ blockingMode: "custom_ip", blockingIpv4: "192.0.2.53" });
    const { id } = await createDevice();
    expect(address((await ask(id, "custom-ip.test")).msg.answers[0]!.data)).toBe("192.0.2.53");
    const v6 = await ask(id, "custom-ip.test", RRType.AAAA);
    expect(rcodeOf(v6.msg.header)).toBe(Rcode.NOERROR);
    expect(v6.msg.answers).toHaveLength(0);
  });

  it("can pause filtering and empty every AAAA answer", async () => {
    await publishRules("||paused.test^", "t", "t");
    const { id } = await createDevice();
    await patch({ filteringEnabled: false, disableIpv6: true });
    expect(address((await ask(id, "paused.test")).msg.answers[0]!.data)).toMatch(/^192\.0\.2\./);
    const v6 = await ask(id, "ipv6.test", RRType.AAAA);
    expect(v6.msg.answers).toHaveLength(0);
    expect(v6.res.headers.get("cache-control")).toBe("private, max-age=10");
  });

  it("bounds upstream TTLs and can turn the cache off", async () => {
    const { id } = await createDevice();
    await patch({ cacheMaxTtl: 60 });
    const capped = await ask(id, "capped.test");
    expect(capped.msg.answers[0]!.ttl).toBe(60);
    expect(capped.res.headers.get("cache-control")).toBe("private, max-age=60");

    await patch({ cacheEnabled: false });
    const first = address((await ask(id, "uncached.test")).msg.answers[0]!.data);
    const second = address((await ask(id, "uncached.test")).msg.answers[0]!.data);
    expect(second).not.toBe(first);
  });

  it("takes the fastest upstream in parallel mode", async () => {
    const { id } = await createDevice();
    await patch({ cacheEnabled: false });
    const lastOctet = async (name: string) => Number(address((await ask(id, name)).msg.answers[0]!.data).split(".")[3]);
    expect(await lastOctet("slow.fallback.test")).toBeLessThan(200);
    await patch({ upstreamMode: "parallel" });
    expect(await lastOctet("slow.parallel.test")).toBeGreaterThan(200);
  });

  it("refuses devices used from more networks than allowed, until reset", async () => {
    const { id } = await createDevice("Shared");
    const from = async (ip: string) => {
      const res = await exports.default.fetch(`${ORIGIN}/dns-query/${id}`, {
        method: "POST",
        headers: { "content-type": "application/dns-message", "cf-connecting-ip": ip },
        body: buildQuery("limit.example", RRType.A),
      });
      return rcodeOf(parseMessage(new Uint8Array(await res.arrayBuffer())).header);
    };

    expect(await from("198.51.100.1")).toBe(Rcode.NOERROR);
    await patch({ maxDeviceClients: 2 });
    expect(await from("198.51.100.1")).toBe(Rcode.NOERROR);
    // Privacy addresses inside one /64 are a single client
    expect(await from("2001:db8:1:2::a")).toBe(Rcode.NOERROR);
    expect(await from("2001:db8:1:2::b")).toBe(Rcode.NOERROR);
    expect(await from("203.0.113.9")).toBe(Rcode.REFUSED);

    const seen = await (await api(`/devices/${id}/clients`)).json<{ limit: number; clients: { client: string }[] }>();
    expect(seen.limit).toBe(2);
    expect(seen.clients.map((c) => c.client).sort()).toEqual(["198.51.100.1", "2001:db8:1:2::/64"]);

    expect((await api(`/devices/${id}/clients`, { method: "DELETE" })).status).toBe(204);
    expect(await from("203.0.113.9")).toBe(Rcode.NOERROR);

    // With the limit off the list is not read at all
    await patch({ maxDeviceClients: 0 });
    expect(await (await api(`/devices/${id}/clients`)).json()).toMatchObject({ limit: 0, clients: [] });
  });

  it("normalises client networks", () => {
    expect(clientNetwork("192.0.2.7")).toBe("192.0.2.7");
    expect(clientNetwork("2001:0db8:0000:0042:abcd::1")).toBe("2001:db8:0:42::/64");
    expect(clientNetwork("not-an-ip")).toBe("not-an-ip");
  });
});
