import { SnapshotError } from "#filter";
import { devicesApi } from "./features/devices/api.ts";
export { DeviceClients } from "./features/devices/client-guard.ts";
import { ruleTestApi } from "./features/doh/api.ts";
import { handleDoh } from "./features/doh/handler.ts";
import { catalogApi, customRulesApi, listsApi } from "./features/lists/api.ts";
import { profilesApi } from "./features/profiles/api.ts";
import { recordsApi } from "./features/records/api.ts";
import { rulesApi } from "./features/rules/api.ts";
import { servicesApi } from "./features/services/api.ts";
import { settingsApi } from "./features/settings/api.ts";
import { statsApi } from "./features/stats/api.ts";
import { requireAccess } from "./shared/access.ts";
import { HttpError, router } from "./shared/http.ts";

const api = router();
api.use("*", requireAccess);
api.get("/health", (c) => c.json({ ok: true }));
api.route("/devices", devicesApi);
api.route("/rules/test", ruleTestApi);
api.route("/rules", rulesApi);
api.route("/stats", statsApi);
api.route("/lists", listsApi);
api.route("/catalog", catalogApi);
api.route("/custom-rules", customRulesApi);
api.route("/settings", settingsApi);
api.route("/profiles", profilesApi);
api.route("/services", servicesApi);
api.route("/local-records", recordsApi);
api.all("*", (c) => c.json({ error: "not found" }, 404));
api.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
  if (err instanceof SnapshotError) return c.json({ error: err.message }, 400);
  console.error("unhandled API error", err);
  return c.json({ error: "internal error" }, 500);
});

const app = router();
app.route("/api", api);

const DOH_PATH = /^\/dns-query\/([^/]+)$/;

export default {
  fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    // DoH skips the router entirely: on a cold isolate every millisecond counts against the free plan's 10 ms CPU
    if (pathname === "/dns-query" || pathname.startsWith("/dns-query/")) {
      const deviceId = DOH_PATH.exec(pathname)?.[1];
      return deviceId ? handleDoh(request, env, ctx, deviceId) : new Response("unknown device", { status: 404 });
    }
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
