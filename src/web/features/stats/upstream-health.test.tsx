// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/shared/i18n";
import { UpstreamHealth } from "./upstream-health";

const items = [
  { host: "cloudflare-dns.com", answered: 640, failed: 3, failureRate: 0.0047, avgMs: 18.2, p95Ms: 41 },
  { host: "down.example", answered: 0, failed: 9, failureRate: 1, avgMs: null, p95Ms: null },
];

beforeEach(() => {
  localStorage.setItem("locale", "en-US");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ range: "24h", items })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("UpstreamHealth", () => {
  it("shows answers, failure rate and round trip per upstream, flagging failing ones", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <I18nProvider>
          <UpstreamHealth range="24h" enabled />
        </I18nProvider>
      </QueryClientProvider>,
    );
    const healthy = (await screen.findByText("cloudflare-dns.com")).closest("tr")!;
    expect(within(healthy).getByText("18.2 ms")).toBeTruthy();
    expect(within(healthy).getByText("640")).toBeTruthy();
    const down = screen.getByText("down.example").closest("tr")!;
    const rate = within(down).getByText("100%");
    expect(rate.className).toContain("text-destructive");
    expect(within(down).getAllByText("–")).toHaveLength(2);
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe("/api/stats/upstreams?range=24h");
  });
});
