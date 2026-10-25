import { buildQuery, parseMessage, Rcode, rcodeOf, readName, RRType } from "#dns";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, createDevice, json, postQuery, publishRules } from "../../test/helpers.ts";

const RULES = [
  "||ads.example^",
  "@@||ok.ads.example^",
  "||kids-only.example^$client=Kids",
  "||rewrite.example^$dnsrewrite=10.1.2.3",
  "||alias.example^$dnsrewrite=target.example",
  "||nx.example^$dnsrewrite=NXDOMAIN",
  "192.168.1.20 nas.lan",
].join("\n");

const upload = (text = RULES) => publishRules(text);
const device = async (name: string) => (await createDevice(name)).id;

async function query(deviceId: string, name: string, type: number = RRType.A) {
  const res = await postQuery(deviceId, buildQuery(name, type, { id: 77 }));
  expect(res.status).toBe(200);
  const body = new Uint8Array(await res.arrayBuffer());
  return { res, body, msg: parseMessage(body) };
}

const addressOf = (data: Uint8Array) => (data.length === 4 ? [...data].join(".") : [...data].join(","));

describe("filtering", () => {
  let phone: string;

  beforeEach(async () => {
    await upload();
    phone = await device("Phone");
  });

  it("answers blocked names locally according to the query type", async () => {
    const a = await query(phone, "tracker.ads.example", RRType.A);
    expect(a.msg.header.id).toBe(77);
    expect(a.msg.answers.map((r) => [r.name, r.type, r.ttl, addressOf(r.data)])).toEqual([["tracker.ads.example", RRType.A, 10, "0.0.0.0"]]);
    expect(a.res.headers.get("cache-control")).toBe("private, max-age=10");

    const aaaa = await query(phone, "ads.example", RRType.AAAA);
    expect(aaaa.msg.answers[0]?.data).toEqual(new Uint8Array(16));

    const https = await query(phone, "ads.example", RRType.HTTPS);
    expect(rcodeOf(https.msg.header)).toBe(Rcode.NOERROR);
    expect(https.msg.answers).toHaveLength(0);
  });

  it("lets exceptions and unlisted names through to the upstream", async () => {
    for (const name of ["ok.ads.example", "clean.example"]) {
      const { msg } = await query(phone, name);
      expect(addressOf(msg.answers[0]!.data)).toMatch(/^192\.0\.2\./);
    }
  });

  it("applies $client rules to named devices only", async () => {
    const kids = await device("Kids");
    expect(addressOf((await query(kids, "kids-only.example")).msg.answers[0]!.data)).toBe("0.0.0.0");
    expect(addressOf((await query(phone, "kids-only.example")).msg.answers[0]!.data)).toMatch(/^192\.0\.2\./);
  });

  it("rewrites addresses and keyword rcodes", async () => {
    const a = await query(phone, "rewrite.example");
    expect(addressOf(a.msg.answers[0]!.data)).toBe("10.1.2.3");
    const aaaa = await query(phone, "rewrite.example", RRType.AAAA);
    expect(aaaa.msg.answers).toHaveLength(0);
    expect(rcodeOf((await query(phone, "nx.example")).msg.header)).toBe(Rcode.NXDOMAIN);
    expect(addressOf((await query(phone, "nas.lan")).msg.answers[0]!.data)).toBe("192.168.1.20");
  });

  it("follows CNAME rewrites upstream", async () => {
    const { msg, body } = await query(phone, "alias.example");
    expect(msg.answers.map((r) => [r.name, r.type])).toEqual([
      ["alias.example", RRType.CNAME],
      ["target.example", RRType.A],
    ]);
    const cname = msg.answers[0]!;
    expect(readName(body, cname.data.byteOffset - body.byteOffset).name).toBe("target.example");
    expect(addressOf(msg.answers[1]!.data)).toMatch(/^192\.0\.2\./);
  });

  it("explains verdicts through the test endpoint", async () => {
    const res = await api("/rules/test", json({ name: "X.Ads.Example." }));
    expect(await res.json()).toEqual({
      name: "x.ads.example",
      type: "A",
      verdict: { action: "block", rule: { text: "||ads.example^", listId: "test", line: 1 } },
    });
  });

  it("reports the active snapshot and can disable filtering", async () => {
    const info = await (await api("/rules")).json<Record<string, unknown>>();
    expect(info).toMatchObject({ active: true, entries: 7, complex: 0, lists: [{ id: "test", name: "Test list", rules: 7 }] });

    expect((await api("/rules/snapshot", { method: "DELETE" })).status).toBe(204);
    expect(await (await api("/rules")).json()).toEqual({ active: false });
    expect(addressOf((await query(phone, "ads.example")).msg.answers[0]!.data)).toMatch(/^192\.0\.2\./);
  });

  it("replaces the snapshot on re-upload", async () => {
    await upload("||other.example^");
    expect(addressOf((await query(phone, "ads.example")).msg.answers[0]!.data)).toMatch(/^192\.0\.2\./);
    expect(addressOf((await query(phone, "other.example")).msg.answers[0]!.data)).toBe("0.0.0.0");
  });

  it("re-uploads only changed blobs and collects old ones", async () => {
    const big = Array.from({ length: 300 }, (_, i) => `||bulk${i}.example^`).join("\n");
    const first = await upload(big);
    expect(first.uploaded).toBe(33);
    const edited = await upload(`${big}\n||one-more.example^`);
    // Meta changes, plus the single shard holding the new rule
    expect(edited.uploaded).toBe(2);
    expect(edited.reused).toBe(31);

    const blobs = async () => (await env.RULES.list({ prefix: "blob:" })).keys.length;
    const afterTwo = await blobs();
    await upload("||third.example^");
    await upload("||fourth.example^");
    // Only the current and previous snapshots stay around
    expect(await blobs()).toBeLessThan(afterTwo + 33);
    expect(addressOf((await query(phone, "fourth.example")).msg.answers[0]!.data)).toBe("0.0.0.0");
  });

  it("rejects invalid uploads and commits", async () => {
    const zeros = "0".repeat(64);
    const put = (hash: string, body: BodyInit) => api(`/rules/blobs/${hash}`, { method: "PUT", body });
    expect((await put("nothex", "x")).status).toBe(400);
    expect(await (await put(zeros, "x")).json()).toEqual({ error: "blob content does not match its hash" });

    const commit = (body: unknown) => api("/rules/commit", json(body));
    expect((await commit({ meta: zeros, shards: [] })).status).toBe(400);
    expect((await api("/rules/test", json({ name: "x.example", type: "constructor" }))).status).toBe(400);
    const missing = await commit({ meta: zeros, shards: Array(32).fill(zeros) });
    expect(missing.status).toBe(409);

    // A blob with a valid hash but garbage content is rejected when committed as meta
    const garbage = new TextEncoder().encode("not json");
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", garbage))].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect((await put(hash, garbage)).status).toBe(204);
    const manifest = await (await api("/rules/manifest")).json<{ blobs: string[] }>();
    const bad = await commit({ meta: hash, shards: manifest.blobs.slice(1) });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid snapshot metadata" });
  });
});
