// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RebuildContext } from "@/features/snapshot/api";
import { I18nProvider } from "@/shared/i18n";
import { enUS } from "@/shared/i18n/locales/en-US";
import { SnapshotCard } from "./snapshot-card";

beforeEach(() => localStorage.setItem("locale", "en-US"));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderWith(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(body, { status })));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <RebuildContext.Provider value={{ stage: null, rebuild: vi.fn() }}>
          <SnapshotCard />
        </RebuildContext.Provider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

describe("SnapshotCard", () => {
  it("shows the server's error instead of loading forever", async () => {
    renderWith(500, { error: "KV unavailable" });
    expect((await screen.findByText("KV unavailable")).className).toContain("text-destructive");
  });

  it("warns when no snapshot is active", async () => {
    renderWith(200, { active: false });
    expect((await screen.findByText(enUS["snapshot.inactive"] as string)).className).toContain("text-warning");
  });
});
