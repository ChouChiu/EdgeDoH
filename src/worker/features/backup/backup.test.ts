import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { api, createDevice, json } from "../../test/helpers.ts";
import type { Backup, ImportResult } from "./store.ts";

async function exported(): Promise<Backup> {
  const res = await api("/backup");
  expect(res.status).toBe(200);
  expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="edgedoh-backup-\d{4}-\d{2}-\d{2}\.json"$/);
  return res.json();
}

const put = (body: unknown) => api("/backup", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("backup", () => {
  it("exports the configuration without device IDs and imports it with new ones", async () => {
    const profile = await (await api("/profiles", json({ name: "Kids", safeSearch: true }))).json<{ id: string }>();
    const phone = await createDevice("Phone");
    await api(`/devices/${phone.id}`, json({ profileId: profile.id }, "PATCH"));
    await api(`/devices/${phone.id}/rules`, json([{ name: "Ads.Example.", action: "allow" }], "PUT"));
    await createDevice("Laptop");
    await api("/lists", json({ url: "https://lists.test/mine.txt", name: "Mine" }));
    await api("/lists", json({ text: "||inline.test^\n", name: "Inline" }));
    await api("/custom-rules", { method: "PUT", headers: { "content-type": "text/plain" }, body: "||custom.test^\n" });
    await api("/local-records", json([{ name: "nas.lan", type: "A", value: "192.168.1.2" }], "PUT"));
    await api("/settings", json({ blockedTtl: 42 }, "PATCH"));

    const backup = await exported();
    expect(JSON.stringify(backup)).not.toContain(phone.id);
    expect(backup.devices).toEqual([
      { name: "Phone", profileId: profile.id, rules: [{ name: "ads.example", action: "allow" }] },
      { name: "Laptop", profileId: null, rules: [] },
    ]);
    expect(backup.settings).toMatchObject({ blockedTtl: 42 });
    expect(backup.profiles.find((p) => p.id === profile.id)).toEqual({ id: profile.id, name: "Kids", config: { safeSearch: true } });
    const inline = backup.lists.find((l) => l.source === "inline")!;
    expect(inline.text).toBe("||inline.test^\n");
    expect(backup.lists.find((l) => l.source === "url")).not.toHaveProperty("text");

    await createDevice("Extra");
    await api("/settings", json({ blockedTtl: 7 }, "PATCH"));
    const res = await put(backup);
    expect(res.status).toBe(200);
    const result = await res.json<ImportResult>();
    expect(result.devices).toBe(2);
    expect(result.pending).toEqual([backup.lists.find((l) => l.source === "url")!.id]);

    const devices = await (await api("/devices")).json<{ id: string; name: string; profileId: string | null }[]>();
    expect(devices.map((d) => [d.name, d.profileId])).toEqual([
      ["Phone", profile.id],
      ["Laptop", null],
    ]);
    expect(devices.map((d) => d.id)).not.toContain(phone.id);
    expect(await (await api(`/devices/${devices[0]!.id}/rules`)).json()).toEqual([{ name: "ads.example", action: "allow" }]);
    expect((await (await api("/settings")).json<{ blockedTtl: number }>()).blockedTtl).toBe(42);
    expect(await (await api(`/lists/${inline.id}/text`)).text()).toBe("||inline.test^\n");
    expect(await (await api("/custom-rules")).text()).toBe("||custom.test^\n");
    expect(await (await api("/local-records")).json()).toEqual([{ name: "nas.lan", type: "A", value: "192.168.1.2" }]);
    expect((await api(`/lists/${result.pending[0]}/refresh`, { method: "POST" })).status).toBe(200);
  });

  it("stores left-out texts empty, for the dashboard to upload afterwards", async () => {
    await api("/lists", json({ text: "||old.test^\n", name: "Inline" }));
    await api("/custom-rules", { method: "PUT", headers: { "content-type": "text/plain" }, body: "||old-custom.test^\n" });
    const backup = await exported();
    const inline = backup.lists.find((l) => l.source === "inline")!;
    const { customRules: _, ...rest } = backup;
    const res = await put({ ...rest, lists: backup.lists.map(({ text: _text, ...l }) => l) });
    expect(res.status).toBe(200);
    expect(await (await api(`/lists/${inline.id}/text`)).text()).toBe("");
    expect(await (await api("/custom-rules")).text()).toBe("");
  });

  it("rejects invalid backups without changing anything", async () => {
    await createDevice("Keep");
    const before = await exported();
    expect((await put({ format: "other" })).status).toBe(400);
    const bad = await put({ ...before, devices: [{ name: "Ghost", profileId: "missing" }], settings: { blockedTtl: -1 } });
    expect(bad.status).toBe(400);
    expect((await bad.json<{ error: string }>()).error).toMatch(/blockedTtl.*unknown profile|unknown profile.*blockedTtl/s);
    expect((await api("/backup", { method: "PUT", body: "{" })).status).toBe(400);
    const selfSwitch = { id: "loop", name: "Loop", config: { scheduledProfile: "loop" } };
    const dangling = { id: "lost", name: "Lost", config: { scheduledProfile: "gone" } };
    const refs = await put({ ...before, profiles: [...before.profiles, selfSwitch, dangling] });
    expect(refs.status).toBe(400);
    expect((await refs.json<{ error: string }>()).error).toMatch(/Loop: a profile cannot switch to itself.*Lost: scheduledProfile does not exist/s);
    const after = await exported();
    expect({ ...after, exportedAt: 0 }).toEqual({ ...before, exportedAt: 0 });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM devices WHERE name = 'Keep'").first<{ n: number }>())?.n).toBeGreaterThan(0);
  });
});
