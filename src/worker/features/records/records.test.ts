import { buildQuery, parseMessage, RRType } from "#dns";
import { afterEach, describe, expect, it } from "vitest";
import { api, createDevice, json, postQuery } from "../../test/helpers.ts";

async function query(deviceId: string, name: string, type: number = RRType.A) {
  const res = await postQuery(deviceId, buildQuery(name, type));
  expect(res.status).toBe(200);
  return { msg: parseMessage(new Uint8Array(await res.arrayBuffer())) };
}

const firstAddress = async (deviceId: string, name: string) => {
  const { msg } = await query(deviceId, name);
  return [...(msg.answers.find((r) => r.type === RRType.A)?.data ?? [])].join(".");
};

afterEach(async () => {
  await api("/local-records", json([], "PUT"));
});

describe("local records", () => {
  it("validates and answers exact and wildcard names", async () => {
    expect((await api("/local-records", json([{ name: "bad name", type: "A", value: "1.2.3.4" }], "PUT"))).status).toBe(400);
    expect(
      (await api("/local-records", json([{ name: "a.lan", type: "CNAME", value: "b.lan" }, { name: "a.lan", type: "A", value: "1.2.3.4" }], "PUT"))).status,
    ).toBe(400);
    const saved = await api(
      "/local-records",
      json(
        [
          { name: "NAS.lan.", type: "A", value: "192.168.1.20" },
          { name: "*.home.lan", type: "A", value: "192.168.1.30" },
        ],
        "PUT",
      ),
    );
    expect(await saved.json()).toEqual([
      { name: "*.home.lan", type: "A", value: "192.168.1.30" },
      { name: "nas.lan", type: "A", value: "192.168.1.20" },
    ]);
    const { id: device } = await createDevice();
    expect(await firstAddress(device, "nas.lan")).toBe("192.168.1.20");
    expect(await firstAddress(device, "tv.home.lan")).toBe("192.168.1.30");
    expect((await query(device, "nas.lan", RRType.AAAA)).msg.answers).toHaveLength(0);
  });

  it("answers local AAAA records even with IPv6 resolution disabled", async () => {
    await api("/local-records", json([{ name: "v6.lan", type: "AAAA", value: "fd00::20" }], "PUT"));
    await api("/settings", json({ disableIpv6: true }, "PATCH"));
    try {
      const { id: device } = await createDevice();
      expect((await query(device, "v6.lan", RRType.AAAA)).msg.answers).toHaveLength(1);
      expect((await query(device, "other.lan", RRType.AAAA)).msg.answers).toHaveLength(0);
    } finally {
      await api("/settings", json({ disableIpv6: false }, "PATCH"));
    }
  });
});
