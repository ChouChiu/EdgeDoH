import { describe, expect, it } from "vitest";
import { api } from "../../test/helpers.ts";

const fetchCount = async (init?: RequestInit) => (await (await api("/services/community", init)).json<{ fetch: number }>()).fetch;

describe("services API", () => {
  it("passes a catalog file through unchanged", async () => {
    const res = await api("/services/adguard");
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.text()).toBe('{"license":"GPL-3.0","services":[{"id":"tiktok","name":"TikTok","group":"social_network","icon":"<svg/>","rules":["||tiktok.test^"]}]}');
  });

  it("serves the cached copy until a no-cache request replaces it", async () => {
    const first = await fetchCount();
    expect(await fetchCount()).toBe(first);
    const fresh = await fetchCount({ headers: { "cache-control": "no-cache" } });
    expect(fresh).toBe(first + 1);
    expect(await fetchCount()).toBe(fresh);
  });

  it("serves only known sources", async () => {
    expect((await api("/services/other")).status).toBe(404);
  });
});
