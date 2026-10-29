import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { api, json } from "../../test/helpers.ts";

describe("catalog", () => {
  it("proxies HostlistsRegistry", async () => {
    const res = await api("/catalog");
    expect(res.status).toBe(200);
    const body = await res.json<{ filters: { filterKey: string }[] }>();
    expect(body.filters.map((f) => f.filterKey)).toEqual(["test_registry_list"]);
  });
});

describe("filter lists", () => {
  it("installs registry lists and serves their text", async () => {
    const res = await api("/lists", json({ registryId: 99 }));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      id: "test_registry_list",
      name: "Test registry list",
      source: "registry",
      registryId: 99,
      enabled: true,
      rules: null,
    });
    expect(await (await api("/lists/test_registry_list/text")).text()).toContain("||from-registry.test^");
    expect((await api("/lists", json({ registryId: 99 }))).status).toBe(409);
    expect((await api("/lists", json({ registryId: 12345 }))).status).toBe(404);
  });

  it("installs URL lists with a stable ID", async () => {
    const res = await api("/lists", json({ url: "https://lists.test/mine.txt", name: "Mine" }));
    const list = await res.json<{ id: string; source: string }>();
    expect(list).toMatchObject({ name: "Mine", source: "url" });
    expect(list.id).toMatch(/^url-[0-9a-f]{8}$/);
    expect((await api("/lists", json({ url: "https://lists.test/mine.txt" }))).status).toBe(409);
    expect((await api("/lists", json({ url: "ftp://lists.test/x" }))).status).toBe(400);
    expect((await api("/lists", json({ url: "https://lists.test/missing.txt" }))).status).toBe(502);
    expect((await api("/lists", json({}))).status).toBe(400);
  });

  it("reads names and metadata from the list header", async () => {
    const titled = await (await api("/lists", json({ url: "https://lists.test/titled.txt" }))).json();
    expect(titled).toMatchObject({
      name: "Titled list",
      meta: { title: "Titled list", description: "Blocks things", homepage: "https://lists.test/", license: "MIT", version: "1.2.3" },
    });

    const named = await (await api("/lists", json({ url: "https://lists.test/titled.txt?v=2", name: "Mine" }))).json();
    expect(named).toMatchObject({ name: "Mine", meta: { title: "Titled list" } });

    const bare = await (await api("/lists", json({ url: "https://lists.test/bare.txt" }))).json();
    expect(bare).toMatchObject({ name: "lists.test", meta: {} });

    const long = await (await api("/lists", json({ url: "https://lists.test/long.txt" }))).json<{ id: string }>();
    expect(long).toMatchObject({ name: "Long list" });
    expect(await (await api(`/lists/${long.id}/text`)).text()).toContain("||from-long.test^");
  });

  it("updates, reports, refreshes and removes lists", async () => {
    await api("/lists", json({ registryId: 99 }));
    const patched = await api("/lists/test_registry_list", json({ enabled: false, name: "Renamed" }, "PATCH"));
    expect(await patched.json()).toMatchObject({ enabled: false, name: "Renamed" });

    const reported = await api("/lists/reports", json([{ id: "test_registry_list", rules: 1, unsupported: 2, reasons: { "cosmetic rule": 2 } }]));
    expect(reported.status).toBe(204);
    const [list] = await (await api("/lists")).json<Record<string, unknown>[]>();
    expect(list).toMatchObject({ rules: 1, unsupported: 2, reasons: { "cosmetic rule": 2 } });
    expect(list?.compiledAt).toEqual(expect.any(Number));

    expect((await api("/lists/test_registry_list/refresh", { method: "POST" })).status).toBe(200);
    expect((await api("/lists/test_registry_list", { method: "DELETE" })).status).toBe(204);
    expect((await api("/lists/test_registry_list/text")).status).toBe(404);
    expect((await api("/lists/test_registry_list", { method: "DELETE" })).status).toBe(404);
    for (const bad of [[{ id: 1 }], [{ id: "x", rules: 1, unsupported: 0, reasons: null }], { id: "x" }]) {
      expect((await api("/lists/reports", json(bad))).status).toBe(400);
    }
  });
});

describe("custom rules", () => {
  it("stores text and exposes it to the compiler", async () => {
    expect(await (await api("/custom-rules")).text()).toBe("");
    expect((await api("/custom-rules", { method: "PUT", body: "||mine.test^\n" })).status).toBe(204);
    expect(await (await api("/custom-rules")).text()).toBe("||mine.test^\n");
    expect(await (await api("/lists/custom/text")).text()).toBe("||mine.test^\n");
    expect((await api("/custom-rules", { method: "PUT", body: "x".repeat(1024 * 1024 + 1) })).status).toBe(413);
  });
});

describe("route list API", () => {
  it("only accepts upstreams on route lists", async () => {
    const route = await api("/lists", json({ kind: "route", name: "Corp", text: "corp.test", upstreams: ["https://route.test/dns-query"] }));
    expect(route.status).toBe(201);
    const { id } = await route.json<{ id: string }>();
    expect((await api(`/lists/${id}`, json({ upstreams: ["https://backup.test/dns-query"] }, "PATCH"))).status).toBe(200);
    await env.DB.prepare("INSERT INTO filter_lists (id, name, url, source, enabled, created_at) VALUES ('plain', 'Plain', '', 'url', 1, 0)").run();
    expect((await api("/lists/plain", json({ upstreams: ["https://backup.test/dns-query"] }, "PATCH"))).status).toBe(400);
    expect((await api("/lists/missing", json({ upstreams: ["https://backup.test/dns-query"] }, "PATCH"))).status).toBe(404);
  });
});
