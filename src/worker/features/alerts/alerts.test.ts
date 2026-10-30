import { createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import worker from "../../index.ts";
import { api, json } from "../../test/helpers.ts";
import { activeAlerts, type AlertMessage, runAlerts } from "./store.ts";

const received = async () => (await fetch("https://hooks.test/received")).json<AlertMessage[]>();
const settings = (patch: Record<string, unknown>) => api("/settings", json(patch, "PATCH"));

afterEach(async () => {
  await settings({ alertWebhookUrl: "", alertFailurePercent: 5, alertBlockedPercent: 0, alertLimitedQueries: 1 });
  await env.RULES.delete("alerts:state");
  await received();
});

describe("activeAlerts", () => {
  const thresholds = { alertFailurePercent: 5, alertBlockedPercent: 30, alertLimitedQueries: 2 };

  it("compares percentages and counts with their thresholds", () => {
    expect(activeAlerts({ total: 200, failed: 10, blocked: 59, limited: 2 }, thresholds)).toEqual([
      { kind: "failures", value: 5, threshold: 5 },
      { kind: "limited", value: 2, threshold: 2 },
    ]);
    expect(activeAlerts({ total: 200, failed: 9, blocked: 60, limited: 1 }, thresholds)).toEqual([{ kind: "blocked", value: 30, threshold: 30 }]);
  });

  it("ignores percentages on little traffic and thresholds set to 0", () => {
    expect(activeAlerts({ total: 10, failed: 10, blocked: 10, limited: 0 }, thresholds)).toEqual([]);
    expect(activeAlerts({ total: 200, failed: 200, blocked: 200, limited: 200 }, { alertFailurePercent: 0, alertBlockedPercent: 0, alertLimitedQueries: 0 })).toEqual([]);
  });

  it("keeps firing rate alerts through a window too quiet to judge", () => {
    const failures = { kind: "failures" as const, value: 40, threshold: 5 };
    const limited = { kind: "limited" as const, value: 3, threshold: 2 };
    expect(activeAlerts({ total: 5, failed: 5, blocked: 0, limited: 0 }, thresholds, [failures, limited])).toEqual([failures]);
    expect(activeAlerts({ total: 5, failed: 5, blocked: 0, limited: 0 }, { ...thresholds, alertFailurePercent: 0 }, [failures])).toEqual([]);
  });
});

describe("runAlerts", () => {
  it("does nothing without a webhook", async () => {
    expect(await runAlerts(env)).toEqual({ firing: [], sent: false });
    expect(await received()).toEqual([]);
  });

  it("sends when alerts start and end, not while they last", async () => {
    // The fake log has 200 queries: 10% failed, 25% blocked, 3 refused by the client limit
    await settings({ alertWebhookUrl: "https://hooks.test/ok" });
    expect(await runAlerts(env)).toEqual({ firing: ["failures", "limited"], sent: true });
    const [started] = await received();
    expect(started!.alerts.map((a) => [a.kind, a.status, a.value])).toEqual([
      ["failures", "firing", 10],
      ["limited", "firing", 3],
    ]);
    expect(started!.text).toContain("Upstream failures: 10% (threshold 5%)");

    expect(await runAlerts(env)).toEqual({ firing: ["failures", "limited"], sent: false });
    expect(await received()).toEqual([]);

    await settings({ alertFailurePercent: 50 });
    expect(await runAlerts(env)).toEqual({ firing: ["limited"], sent: true });
    const [ended] = await received();
    expect(ended!.alerts).toEqual([{ kind: "failures", value: 10, threshold: 5, status: "resolved" }]);
  });

  it("retries the same transition after the webhook fails", async () => {
    await settings({ alertWebhookUrl: "https://hooks.test/fail" });
    expect((await runAlerts(env)).sent).toBe(false);
    expect(await env.RULES.get("alerts:state")).toBeNull();
    await settings({ alertWebhookUrl: "https://hooks.test/ok" });
    expect((await runAlerts(env)).sent).toBe(true);
  });

  it("runs from the 15-minute cron trigger", async () => {
    await settings({ alertWebhookUrl: "https://hooks.test/ok" });
    await worker.scheduled(createScheduledController({ cron: "17 */6 * * *" }), env);
    expect(await received()).toEqual([]);
    await worker.scheduled(createScheduledController({ cron: "*/15 * * * *" }), env);
    expect(await received()).toHaveLength(1);
  });

  it("checks the webhook on demand and validates its URL", async () => {
    expect((await api("/alerts/test", { method: "POST" })).status).toBe(400);
    expect((await settings({ alertWebhookUrl: "http://hooks.test/ok" })).status).toBe(400);
    await settings({ alertWebhookUrl: "https://hooks.test/ok" });
    expect((await api("/alerts/test", { method: "POST" })).status).toBe(200);
    expect((await received())[0]!.text).toContain("test alert");
    await settings({ alertWebhookUrl: "https://hooks.test/fail" });
    expect((await api("/alerts/test", { method: "POST" })).status).toBe(502);
  });
});
