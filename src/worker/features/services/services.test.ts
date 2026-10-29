import { describe, expect, it } from "vitest";
import { api } from "../../test/helpers.ts";

describe("services API", () => {
  it("passes a catalog file through unchanged", async () => {
    const res = await api("/services/adguard");
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.text()).toBe('{"license":"GPL-3.0","services":[{"id":"tiktok","name":"TikTok","group":"social_network","icon":"<svg/>","rules":["||tiktok.test^"]}]}');
  });

  it("reports a catalog that cannot be fetched", async () => {
    expect((await api("/services/community")).status).toBe(502);
  });

  it("serves only known sources", async () => {
    expect((await api("/services/other")).status).toBe(404);
  });
});
