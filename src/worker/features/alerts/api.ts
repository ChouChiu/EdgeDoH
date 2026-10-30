import { HttpError, router } from "../../shared/http.ts";
import { getSettings } from "../settings/store.ts";
import { ALERT_WINDOW_MINUTES, sendWebhook } from "./store.ts";

export const alertsApi = router();

/** Sends a sample message to the saved webhook so its setup can be checked */
alertsApi.post("/test", async (c) => {
  const { alertWebhookUrl } = await getSettings(c.env);
  if (!alertWebhookUrl) throw new HttpError(400, "no alert webhook is configured");
  const text = "EdgeDoH test alert: this webhook receives alert messages";
  let status: number;
  try {
    status = await sendWebhook(alertWebhookUrl, { source: "edgedoh", text, content: text, alerts: [], window: { minutes: ALERT_WINDOW_MINUTES, total: 0 }, at: new Date().toISOString() });
  } catch (err) {
    throw new HttpError(502, `webhook unreachable: ${String(err)}`);
  }
  if (status < 200 || status >= 300) throw new HttpError(502, `webhook answered HTTP ${status}`);
  return c.json({ status });
});
