import { describe, expect, it } from "vitest";
import { api } from "../../test/helpers.ts";

describe("services API", () => {
  it("serves the registry and community rule sets with invalid entries dropped", async () => {
    const services = await (await api("/services")).json<{ id: string }[]>();
    // Community rule sets that cannot be fetched (all but DouYin here) are left out
    expect(services).toEqual([
      { id: "tiktok", name: "TikTok", group: "social_network", icon: "<svg/>", rules: ["||tiktok.test^", "||tiktokcdn.test^"] },
      { id: "douyin", name: "抖音", group: "social_network", icon: "", rules: ["|api.douyin.test^", "||douyinvod.test^"] },
    ]);
  });
});
