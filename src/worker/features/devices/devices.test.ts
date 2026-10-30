import { DEVICE_RULES_LIST_ID } from "#contract";
import { buildQuery, parseMessage, RRType } from "#dns";
import { compile, deviceRulesText } from "#filter";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { api, createDevice, json, ORIGIN, postQuery, publish } from "../../test/helpers.ts";

describe("devices API", () => {
  it("creates, lists, renames and deletes devices", async () => {
    const created = await createDevice("laptop");
    expect(created.id).toMatch(/^[a-z0-9]{10}$/);
    expect(created.dohUrl).toBe(`${ORIGIN}/dns-query/${created.id}`);

    const list = await (await api("/devices")).json<{ id: string }[]>();
    expect(list.map((d) => d.id)).toContain(created.id);

    const renamed = await api(`/devices/${created.id}`, json({ name: "  work laptop " }, "PATCH"));
    expect(await renamed.json()).toMatchObject({ name: "work laptop" });

    expect((await api(`/devices/${created.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await api(`/devices/${created.id}`, { method: "DELETE" })).status).toBe(404);
    expect((await postQuery(created.id, buildQuery("gone.example", RRType.A))).status).toBe(404);
  });

  it("validates names", async () => {
    expect((await api("/devices", json({ name: "" }))).status).toBe(400);
    expect((await api("/devices", json({ name: "x".repeat(65) }))).status).toBe(400);
    expect((await api("/devices", { method: "POST", body: "not json" })).status).toBe(400);
    expect((await api("/devices/zzzzzzzzzz", json({ name: "x" }, "PATCH"))).status).toBe(404);
  });

  it("serves new devices to DoH right away and mirrors them into the KV runtime config", async () => {
    const { id } = await createDevice("Fresh");
    expect((await postQuery(id, buildQuery("fresh.test", RRType.A))).status).toBe(200);
    const stored = await env.RULES.get<{ devices: Record<string, { name: string }> }>("config:v2", "json");
    expect(stored?.devices[id]).toEqual({ name: "Fresh" });
  });
});

describe("mobileconfig", () => {
  it("builds a stable, escaped profile for a device", async () => {
    const { id } = await createDevice("Tom's <iPhone>");
    const res = await api(`/devices/${id}/mobileconfig`);
    expect(res.headers.get("content-type")).toBe("application/x-apple-aspen-config");
    const xml = new TextDecoder().decode(await res.arrayBuffer());
    expect(xml).toContain(`<string>http://localhost/dns-query/${id}</string>`);
    expect(xml).toContain("Tom&apos;s &lt;iPhone&gt;");
    expect(xml).toContain(`<string>localhost.${id}</string>`);
    expect(new TextDecoder().decode(await (await api(`/devices/${id}/mobileconfig`)).arrayBuffer())).toBe(xml);
    expect((await api("/devices/zzzzzzzzzz/mobileconfig")).status).toBe(404);
  });
});

describe("device rules", () => {
  const address = async (deviceId: string, name: string) => {
    const res = await postQuery(deviceId, buildQuery(name, RRType.A));
    return [...(parseMessage(new Uint8Array(await res.arrayBuffer())).answers[0]?.data ?? [])].join(".");
  };

  it("validates, normalises and replaces a device's rules", async () => {
    const { id } = await createDevice("tablet");
    const put = (body: unknown) => api(`/devices/${id}/rules`, json(body, "PUT"));
    expect((await put([{ name: "not a domain", action: "block" }])).status).toBe(400);
    expect((await put([{ name: "x.example", action: "maybe" }])).status).toBe(400);
    expect((await put({})).status).toBe(400);
    expect((await api("/devices/zzzzzzzzzz/rules", json([], "PUT"))).status).toBe(404);

    const saved = await put([
      { name: "B.example.", action: "block" },
      { name: "a.example", action: "allow" },
      { name: "b.example", action: "allow" },
    ]);
    expect(await saved.json()).toEqual([
      { name: "b.example", action: "allow" },
      { name: "a.example", action: "allow" },
    ]);
    expect(await (await api(`/devices/${id}/rules`)).json()).toEqual([
      { name: "a.example", action: "allow" },
      { name: "b.example", action: "allow" },
    ]);
    const all = await (await api("/devices/rules")).json<{ deviceId: string }[]>();
    expect(all.filter((r) => r.deviceId === id)).toHaveLength(2);

    await api(`/devices/${id}`, { method: "DELETE" });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM device_rules WHERE device_id = ?").bind(id).first<{ n: number }>())?.n).toBe(0);
  });

  it("apply to their device only, even when its profile picks other lists", async () => {
    const kid = await createDevice("kid");
    const parent = await createDevice("parent");
    const profile = await (await api("/profiles", json({ name: "Picky", lists: ["ads"] }))).json<{ id: string }>();
    await api(`/devices/${kid.id}`, json({ profileId: profile.id }, "PATCH"));
    const rules = [
      { deviceId: kid.id, name: "games.example", action: "block" as const },
      { deviceId: kid.id, name: "ads.example", action: "allow" as const },
    ];
    await publish(
      compile([
        { id: "ads", name: "Ads", text: "||ads.example^$important" },
        { id: DEVICE_RULES_LIST_ID, name: "Device rules", text: deviceRulesText(rules) },
      ]).snapshot,
    );
    expect(await address(kid.id, "games.example")).toBe("0.0.0.0");
    expect(await address(kid.id, "ads.example")).not.toBe("0.0.0.0");
    expect(await address(parent.id, "games.example")).not.toBe("0.0.0.0");
    expect(await address(parent.id, "ads.example")).toBe("0.0.0.0");
  });
});
