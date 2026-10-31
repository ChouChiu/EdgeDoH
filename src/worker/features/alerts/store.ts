/**
 * Threshold alerts over the query log, checked by a cron trigger and sent to a webhook only when an
 * alert starts or ends, so a lasting problem produces two messages rather than one every run
 */
import { getSettings, type Settings } from "../settings/store.ts";
import { alertSql, runSql, statsConfig } from "../stats/query.ts";

/** Must match the cron interval in wrangler.jsonc */
export const ALERT_WINDOW_MINUTES = 15;
/** Below this many queries a percentage says little, so rate alerts wait for more traffic */
const MIN_QUERIES = 20;
const STATE_KEY = "alerts:state";
const SEND_TIMEOUT_MS = 10_000;

export type AlertKind = "failures" | "blocked" | "limited";

export interface Totals {
  total: number;
  failed: number;
  blocked: number;
  limited: number;
}

export interface Alert {
  kind: AlertKind;
  /** Percent for failures and blocked, a query count for limited */
  value: number;
  threshold: number;
}

/**
 * Alerts firing for this window. A window too quiet to judge a percentage keeps the rate alerts of
 * `previous` as they were, so a lasting problem is not reported as resolved overnight
 */
export function activeAlerts(
  t: Totals,
  s: Pick<Settings, "alertFailurePercent" | "alertBlockedPercent" | "alertLimitedQueries">,
  previous: Alert[] = [],
): Alert[] {
  const out: Alert[] = [];
  const percent = (n: number) => Math.round((n / t.total) * 1000) / 10;
  if (t.total < MIN_QUERIES) {
    const enabled = { failures: s.alertFailurePercent > 0, blocked: s.alertBlockedPercent > 0, limited: false };
    out.push(...previous.filter((p) => enabled[p.kind]));
  } else {
    if (s.alertFailurePercent > 0 && percent(t.failed) >= s.alertFailurePercent) {
      out.push({ kind: "failures", value: percent(t.failed), threshold: s.alertFailurePercent });
    }
    if (s.alertBlockedPercent > 0 && percent(t.blocked) >= s.alertBlockedPercent) {
      out.push({ kind: "blocked", value: percent(t.blocked), threshold: s.alertBlockedPercent });
    }
  }
  if (s.alertLimitedQueries > 0 && t.limited >= s.alertLimitedQueries) out.push({ kind: "limited", value: t.limited, threshold: s.alertLimitedQueries });
  return out;
}

const TITLES: Record<AlertKind, string> = {
  failures: "Upstream failures",
  blocked: "Blocked share",
  limited: "Queries refused by the client limit",
};

function describe(a: Alert, status: "firing" | "resolved"): string {
  const unit = a.kind === "limited" ? "" : "%";
  return status === "firing" ? `${TITLES[a.kind]}: ${a.value}${unit} (threshold ${a.threshold}${unit})` : `${TITLES[a.kind]}: back to normal`;
}

export interface AlertMessage {
  source: "edgedoh";
  /** One readable line per alert; also sent as `content` for Discord-style webhooks */
  text: string;
  content: string;
  alerts: (Alert & { status: "firing" | "resolved" })[];
  window: { minutes: number; total: number };
  at: string;
}

function buildMessage(firing: Alert[], resolved: Alert[], totals: Totals, now: number): AlertMessage {
  const lines = [...firing.map((a) => describe(a, "firing")), ...resolved.map((a) => describe(a, "resolved"))];
  const text = `EdgeDoH, last ${ALERT_WINDOW_MINUTES} min (${totals.total} queries)\n${lines.join("\n")}`;
  return {
    source: "edgedoh",
    text,
    content: text,
    alerts: [...firing.map((a) => ({ ...a, status: "firing" as const })), ...resolved.map((a) => ({ ...a, status: "resolved" as const }))],
    window: { minutes: ALERT_WINDOW_MINUTES, total: totals.total },
    at: new Date(now).toISOString(),
  };
}

export async function sendWebhook(url: string, message: unknown): Promise<number> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  await res.body?.cancel();
  return res.status;
}

/**
 * One alert check: a single SQL read, then a webhook call and a KV write only when the set of
 * firing alerts changed. Does nothing while alerts are off or stats are not configured
 */
export async function runAlerts(env: Env, now = Date.now()): Promise<{ firing: AlertKind[]; sent: boolean }> {
  const settings = await getSettings(env);
  if (!settings.alertWebhookUrl) return { firing: [], sent: false };
  let config;
  try {
    config = statsConfig(env);
  } catch {
    return { firing: [], sent: false };
  }
  const [row] = await runSql<Record<string, number | string>>(config, alertSql(config.dataset, ALERT_WINDOW_MINUTES));
  const totals: Totals = { total: Number(row?.total ?? 0), failed: Number(row?.failed ?? 0), blocked: Number(row?.blocked ?? 0), limited: Number(row?.limited ?? 0) };
  const previous = (await env.RULES.get<Alert[]>(STATE_KEY, "json")) ?? [];
  const active = activeAlerts(totals, settings, previous);
  const firing = active.filter((a) => !previous.some((p) => p.kind === a.kind));
  const resolved = previous.filter((p) => !active.some((a) => a.kind === p.kind));
  if (firing.length === 0 && resolved.length === 0) return { firing: active.map((a) => a.kind), sent: false };

  const status = await sendWebhook(settings.alertWebhookUrl, buildMessage(firing, resolved, totals, now));
  // Keep the old state on failure, so the next run retries the same transition
  if (status < 200 || status >= 300) {
    console.warn("alert webhook rejected the message", { status });
    return { firing: active.map((a) => a.kind), sent: false };
  }
  await env.RULES.put(STATE_KEY, JSON.stringify(active));
  return { firing: active.map((a) => a.kind), sent: true };
}
