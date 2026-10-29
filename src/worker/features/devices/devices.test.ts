import { buildQuery, RRType } from "#dns";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { api, createDevice, json, ORIGIN, postQuery } from "../../test/helpers.ts";

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
