// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RebuildProvider } from "@/features/snapshot/rebuild-provider";
import { I18nProvider } from "@/shared/i18n";
import { DeviceRulesDialog } from "./device-rules-dialog";

const device = (id: string) => ({ id, name: id, createdAt: 0, profileId: null, pausedUntil: null, url: "", clients: 0 }) as never;

beforeEach(() => {
  localStorage.setItem("locale", "en-US");
  const rules = [
    { deviceId: "phone", name: "a.test", action: "block" },
    { deviceId: "phone", name: "b.test", action: "allow" },
    { deviceId: "laptop", name: "c.test", action: "block" },
  ];
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(rules)));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DeviceRulesDialog", () => {
  it("counts every card's rules from one request", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <I18nProvider>
          <RebuildProvider>
            <DeviceRulesDialog device={device("phone")} />
            <DeviceRulesDialog device={device("laptop")} />
            <DeviceRulesDialog device={device("tv")} />
          </RebuildProvider>
        </I18nProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("2")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe("/api/devices/rules");
  });
});
