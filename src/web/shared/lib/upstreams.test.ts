import { MAX_UPSTREAMS } from "#contract";
import { describe, expect, it } from "vitest";
import type { Translate } from "@/shared/i18n/messages";
import { splitUpstreams, validateUpstreams } from "./upstreams";

const t: Translate = (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key);

describe("upstreams helpers", () => {
  it("splits whitespace-separated upstream URLs", () => {
    expect(splitUpstreams(" https://1.1.1.1/dns-query\n\nhttps://8.8.8.8/dns-query  ")).toEqual([
      "https://1.1.1.1/dns-query",
      "https://8.8.8.8/dns-query",
    ]);
    expect(splitUpstreams("   \n\t  ")).toEqual([]);
  });

  it("validates required, optional, count, and https scheme", () => {
    expect(validateUpstreams([], t)).toBe("settings.upstreamCount");
    expect(validateUpstreams([], t, true)).toBeUndefined();
    expect(validateUpstreams(["http://1.1.1.1/dns-query"], t)).toBe('settings.invalidUpstream:{"url":"http://1.1.1.1/dns-query"}');
    expect(validateUpstreams(["https://1.1.1.1/dns-query"], t)).toBeUndefined();

    const tooMany = Array.from({ length: MAX_UPSTREAMS + 1 }, (_, i) => `https://dns${i}.example/dns-query`);
    expect(validateUpstreams(tooMany, t)).toBe("settings.upstreamCount");
  });
});
