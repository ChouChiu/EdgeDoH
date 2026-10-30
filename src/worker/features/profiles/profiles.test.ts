import { buildQuery, decodeAlpn, encodeBase64Url, parseMessage, parseSvcb, readName, RRType, SvcParam, splitHints, withClientSubnet } from "#dns";
import { compile } from "#filter";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, createDevice, json, postQuery, publish } from "../../test/helpers.ts";
import { resetEchMemo } from "../doh/https-inject.ts";
import { scheduleActive } from "./store.ts";

async function query(deviceId: string, name: string, type: number = RRType.A, init?: { ip?: string }) {
  const res = await postQuery(deviceId, buildQuery(name, type), init?.ip ? { "cf-connecting-ip": init.ip } : undefined);
  expect(res.status).toBe(200);
  const body = new Uint8Array(await res.arrayBuffer());
  return { body, msg: parseMessage(body) };
}

const firstAddress = async (deviceId: string, name: string, init?: { ip?: string }) => {
  const { msg } = await query(deviceId, name, RRType.A, init);
  return [...(msg.answers.find((r) => r.type === RRType.A)?.data ?? [])].join(".");
};

async function createProfile(body: Record<string, unknown>): Promise<{ id: string }> {
  const res = await api("/profiles", json({ name: "Kids", ...body }));
  expect(res.status).toBe(201);
  return res.json();
}

async function deviceWith(profileId: string | null, name = "dev") {
  const { id } = await createDevice(name);
  if (profileId) expect((await api(`/devices/${id}`, json({ profileId }, "PATCH"))).status).toBe(200);
  return id;
}

/** Ads list, a second list, the TikTok service and a split-DNS route list in one snapshot */
async function publishAll() {
  await publish(
    compile([
      { id: "ads", name: "Ads", text: "||ads.example^" },
      { id: "extra", name: "Extra", text: "||extra.example^" },
      { id: "service:tiktok", name: "TikTok", text: "||tiktok.test^", kind: "service" },
      { id: "route-cn", name: "CN", text: "server=/cn.test/114.114.114.114", kind: "route" },
    ]).snapshot,
  );
}

afterEach(async () => {
  vi.useRealTimers();
  await env.DB.exec("DELETE FROM filter_lists; UPDATE profiles SET config = '{}' WHERE id = 'default'");
  await api("/settings", json({ filteringEnabled: true, echForcedDomains: [] }, "PATCH"));
});

describe("profiles API", () => {
  it("lists the default profile, validates input and protects the default", async () => {
    const list = await (await api("/profiles")).json<{ id: string; filtering: boolean }[]>();
    expect(list.find((p) => p.id === "default")).toMatchObject({ filtering: true, lists: null, splitDns: true });

    for (const bad of [
      { name: "" },
      { name: "x", lists: "all" },
      { name: "x", upstreams: ["http://plain.test"] },
      { name: "x", schedule: { timezone: "Mars/Base", days: [1], start: 0, end: 60 } },
      { name: "x", schedule: { timezone: "UTC", days: [7], start: 0, end: 60 } },
      { name: "x", blockingMode: "custom_ip" },
      { name: "x", unknown: true },
    ]) {
      expect((await api("/profiles", json(bad))).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await api("/profiles/default", { method: "DELETE" })).status).toBe(400);
  });

  it("moves devices back to the default profile when theirs is deleted", async () => {
    const { id: profile } = await createProfile({ filtering: false });
    const device = await deviceWith(profile);
    expect((await api(`/profiles/${profile}`, { method: "DELETE" })).status).toBe(204);
    const devices = await (await api("/devices")).json<{ id: string; profileId: string | null }[]>();
    expect(devices.find((d) => d.id === device)?.profileId).toBeNull();
    expect((await api(`/devices/${device}`, json({ profileId: "nope" }, "PATCH"))).status).toBe(400);
  });
});

describe("per-profile filtering", () => {
  it("applies only the profile's lists and services", async () => {
    await publishAll();
    const { id: kids } = await createProfile({ lists: ["extra"], services: ["tiktok"] });
    const kidsDevice = await deviceWith(kids, "kid");
    const adult = await deviceWith(null, "adult");

    expect(await firstAddress(kidsDevice, "ads.example")).toMatch(/^192\.0\.2\./);
    expect(await firstAddress(kidsDevice, "extra.example")).toBe("0.0.0.0");
    expect(await firstAddress(kidsDevice, "www.tiktok.test")).toBe("0.0.0.0");

    expect(await firstAddress(adult, "ads.example")).toBe("0.0.0.0");
    expect(await firstAddress(adult, "www.tiktok.test")).toMatch(/^192\.0\.2\./);
  });

  it("uses the profile's blocking mode", async () => {
    await publishAll();
    const { id } = await createProfile({ blockingMode: "nxdomain" });
    const device = await deviceWith(id);
    const { msg } = await query(device, "ads.example");
    expect(msg.header.flags & 0x0f).toBe(3);
  });

  it("pauses and resumes filtering per device", async () => {
    await publishAll();
    const device = await deviceWith(null);
    const paused = await api(`/devices/${device}/pause`, json({ minutes: 30 }));
    expect((await paused.json<{ pausedUntil: number }>()).pausedUntil).toBeGreaterThan(Date.now());
    expect(await firstAddress(device, "ads.example")).toMatch(/^192\.0\.2\./);
    await api(`/devices/${device}/pause`, json({ minutes: 0 }));
    expect(await firstAddress(device, "ads.example")).toBe("0.0.0.0");
    expect((await api(`/devices/${device}/pause`, json({ minutes: -1 }))).status).toBe(400);
  });

  it("blocks scheduled services only inside the window", async () => {
    await publishAll();
    const schedule = { timezone: "UTC", days: [0, 1, 2, 3, 4, 5, 6], start: 0, end: 1440 };
    const { id } = await createProfile({ schedule, scheduledServices: ["tiktok"] });
    const device = await deviceWith(id);
    expect(await firstAddress(device, "tiktok.test")).toBe("0.0.0.0");
    await api(`/profiles/${id}`, json({ schedule: { ...schedule, days: [] } }, "PATCH"));
    expect(await firstAddress(device, "tiktok.test")).toMatch(/^192\.0\.2\./);
  });

  it("enforces safe search and YouTube restricted mode with CNAMEs", async () => {
    const { id } = await createProfile({ safeSearch: true, youtubeRestricted: true });
    const device = await deviceWith(id);
    for (const [name, target] of [
      ["www.google.com.hk", "forcesafesearch.google.com"],
      ["www.bing.com", "strict.bing.com"],
      ["m.youtube.com", "restrict.youtube.com"],
    ] as const) {
      const { body, msg } = await query(device, name);
      const cname = msg.answers.find((r) => r.type === RRType.CNAME)!;
      expect(readName(body, cname.data.byteOffset - body.byteOffset).name).toBe(target);
    }
  });

  it("keeps cache entries apart per upstream set", async () => {
    const { id } = await createProfile({ upstreams: ["https://route.test/dns-query"] });
    const routed = await deviceWith(id, "routed");
    const plain = await deviceWith(null, "plain");
    expect(await firstAddress(plain, "shared-cache.test")).toMatch(/^192\.0\.2\.\d$/);
    expect(await firstAddress(routed, "shared-cache.test")).toMatch(/^192\.0\.2\.1\d\d$/);
  });

  it("routes split-DNS names to the route list's upstreams", async () => {
    await publishAll();
    await env.DB.prepare(
      "INSERT INTO filter_lists (id, name, url, source, kind, upstreams, enabled, created_at) VALUES ('route-cn', 'CN', '', 'inline', 'route', ?, 1, 0)",
    )
      .bind(JSON.stringify(["https://route.test/dns-query"]))
      .run();
    await api("/profiles/default", json({ splitDns: true }, "PATCH"));
    const device = await deviceWith(null);
    expect(await firstAddress(device, "www.cn.test")).toMatch(/^192\.0\.2\.1\d\d$/);
    expect(await firstAddress(device, "elsewhere.test")).toMatch(/^192\.0\.2\.\d$/);

    await api("/profiles/default", json({ splitDns: false }, "PATCH"));
    expect(await firstAddress(device, "other.cn.test")).toMatch(/^192\.0\.2\.\d$/);
  });
});

describe("DNS rebinding protection", () => {
  const address = async (deviceId: string, name: string, type: number = RRType.A) => {
    const { msg } = await query(deviceId, name, type);
    const rr = msg.answers.find((r) => r.type === type);
    return rr ? [...rr.data].map((b) => (type === RRType.A ? String(b) : b.toString(16))).join(type === RRType.A ? "." : ":") : "";
  };

  it("blocks private answers only for profiles that turn it on, after the shared cache", async () => {
    const plain = await deviceWith(null);
    expect(await address(plain, "lan.rebind.test")).toBe("192.168.1.10");

    const { id } = await createProfile({ rebinding: true });
    const guarded = await deviceWith(id);
    expect(await address(guarded, "lan.rebind.test")).toBe("0.0.0.0");
    expect(await address(guarded, "v6.rebind.test", RRType.AAAA)).toBe("0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0");
    expect(await address(guarded, "cname.rebind.test")).toBe("0.0.0.0");
    expect(await address(guarded, "pub.rebind.test")).toBe("8.8.8.8");
    expect(await address(plain, "lan.rebind.test")).toBe("192.168.1.10");
  });

  it("uses the profile's blocking mode", async () => {
    const { id } = await createProfile({ rebinding: true, blockingMode: "nxdomain" });
    const { msg } = await query(await deviceWith(id), "lan.rebind.test");
    expect(msg.header.flags & 0x0f).toBe(3);
  });

  it("lets allowlisted names, split-DNS routes and unfiltered profiles through", async () => {
    await publish(
      compile([
        { id: "allow", name: "Allow", text: "@@||lan.rebind.test^" },
        { id: "route-lan", name: "LAN", text: "server=/cname.rebind.test/10.0.0.1", kind: "route" },
      ]).snapshot,
    );
    await env.DB.prepare(
      "INSERT INTO filter_lists (id, name, url, source, kind, upstreams, enabled, created_at) VALUES ('route-lan', 'LAN', '', 'inline', 'route', ?, 1, 0)",
    )
      .bind(JSON.stringify(["https://route.test/dns-query"]))
      .run();
    const { id } = await createProfile({ rebinding: true, splitDns: true });
    const device = await deviceWith(id);
    expect(await address(device, "lan.rebind.test")).toBe("192.168.1.10");
    expect(await address(device, "cname.rebind.test")).toBe("10.0.0.5");

    const off = await createProfile({ rebinding: true, filtering: false });
    expect(await address(await deviceWith(off.id), "v6.rebind.test", RRType.AAAA)).toBe("fd:0:0:0:0:0:0:0:0:0:0:0:0:0:0:1");
  });
});

describe("ECS and HTTPS injection", () => {
  it("forwards the client subnet only when the profile asks for it", async () => {
    const device = await deviceWith(null);
    expect(await firstAddress(device, "ecs.test", { ip: "203.0.113.77" })).toBe("0.0.0.0");
    await api("/profiles/default", json({ ecs: true }, "PATCH"));
    expect(await firstAddress(device, "ecs.test", { ip: "203.0.113.77" })).toBe("203.0.113.0");
    expect(await firstAddress(device, "ecs.test", { ip: "198.51.100.9" })).toBe("198.51.100.0");

    // A client-sent source prefix of 0 asks resolvers to keep its subnet private
    const plain = buildQuery("ecs.test", RRType.A);
    const optOut = withClientSubnet(plain, parseMessage(plain), { family: 1, prefix: 0, address: new Uint8Array(0) });
    const res = await postQuery(device, optOut, { "cf-connecting-ip": "203.0.113.77" });
    expect([...parseMessage(new Uint8Array(await res.arrayBuffer())).answers[0]!.data].join(".")).toBe("0.0.0.0");
  });

  it("adds h3 and Cloudflare's ECH config to Cloudflare-proxied names", async () => {
    const device = await deviceWith(null);
    expect((await query(device, "proxied.test", RRType.HTTPS)).msg.answers).toHaveLength(0);

    await api("/profiles/default", json({ ech: true, h3: true }, "PATCH"));
    const synthesised = parseSvcb((await query(device, "proxied.test", RRType.HTTPS)).msg.answers[0]!.data);
    expect(decodeAlpn(synthesised.params.get(SvcParam.ALPN)!)).toEqual(["h3", "h2"]);
    expect([...synthesised.params.get(SvcParam.ECH)!]).toEqual([0xec, 0x40]);
    expect(splitHints(synthesised.params.get(SvcParam.IPV4HINT)!, 4).map((a) => a.join("."))).toEqual(["104.16.1.2"]);
    const raw = await postQuery(device, buildQuery("proxied.test", RRType.HTTPS));
    expect(raw.headers.get("cache-control")).toBe("private, max-age=300");

    const augmented = parseSvcb((await query(device, "proxied-https.test", RRType.HTTPS)).msg.answers[0]!.data);
    expect(decodeAlpn(augmented.params.get(SvcParam.ALPN)!)).toEqual(["h3", "h2"]);
    expect(augmented.params.has(SvcParam.ECH)).toBe(true);

    // Not on Cloudflare: left alone
    expect((await query(device, "plain.test", RRType.HTTPS)).msg.answers).toHaveLength(0);
  });

  it("follows CNAME chains to Cloudflare", async () => {
    const device = await deviceWith(null);
    await api("/profiles/default", json({ ech: true }, "PATCH"));
    const { body, msg } = await query(device, "cname-proxied.test", RRType.HTTPS);
    const [cname, https] = msg.answers;
    expect(cname!.type).toBe(RRType.CNAME);
    expect(readName(body, cname!.data.byteOffset - body.byteOffset).name).toBe("cname-proxied.test.cdn.cloudflare.net");
    expect(https!.name).toBe("cname-proxied.test.cdn.cloudflare.net");
    expect([...parseSvcb(https!.data).params.get(SvcParam.ECH)!]).toEqual([0xec, 0x40]);
  });

  it("handles forced names as Cloudflare-proxied", async () => {
    const device = await deviceWith(null);
    await api("/profiles/default", json({ ech: true }, "PATCH"));
    expect((await query(device, "www.plain.test", RRType.HTTPS)).msg.answers).toHaveLength(0);

    expect((await api("/settings", json({ echForcedDomains: ["plain.test"] }, "PATCH"))).status).toBe(200);
    // Not on Cloudflare according to the upstream, handled as if it were, subdomains included
    const forced = parseSvcb((await query(device, "www.plain.test", RRType.HTTPS)).msg.answers[0]!.data);
    expect([...forced.params.get(SvcParam.ECH)!]).toEqual([0xec, 0x40]);
    // Address answers are never touched
    expect(await firstAddress(device, "plain.test")).toMatch(/^192\.0\.2\./);
  });

  it("falls back to the stored ECH config when the source cannot be resolved", async () => {
    const device = await deviceWith(null);
    await env.RULES.put("ech:config", encodeBase64Url(Uint8Array.of(0xec, 0x41)));
    resetEchMemo();
    await api("/profiles/default", json({ ech: true, upstreams: ["https://noech.test/dns-query"] }, "PATCH"));
    const synthesised = parseSvcb((await query(device, "proxied.test", RRType.HTTPS)).msg.answers[0]!.data);
    expect([...synthesised.params.get(SvcParam.ECH)!]).toEqual([0xec, 0x41]);
    resetEchMemo();
  });
});

describe("scheduleActive", () => {
  // 2026-10-29 is a Thursday (4)
  const at = (iso: string) => Date.parse(iso);
  it("handles same-day and overnight windows in the schedule's time zone", () => {
    const day = { timezone: "Asia/Shanghai", days: [4], start: 9 * 60, end: 17 * 60 };
    expect(scheduleActive(day, at("2026-10-29T02:00:00Z"))).toBe(true); // 10:00 Shanghai
    expect(scheduleActive(day, at("2026-10-29T10:00:00Z"))).toBe(false); // 18:00
    const night = { timezone: "UTC", days: [4], start: 22 * 60, end: 7 * 60 };
    expect(scheduleActive(night, at("2026-10-29T23:00:00Z"))).toBe(true);
    expect(scheduleActive(night, at("2026-10-30T06:00:00Z"))).toBe(true); // Friday morning, started Thursday
    expect(scheduleActive(night, at("2026-10-30T08:00:00Z"))).toBe(false);
    expect(scheduleActive(night, at("2026-10-29T06:00:00Z"))).toBe(false); // Thursday morning belongs to Wednesday
  });
});
