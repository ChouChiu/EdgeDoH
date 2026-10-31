import { HttpError, router } from "../../shared/http.ts";
import { findProbe, isNonce } from "./store.ts";

/** Mounted at /api/probe: which device's DoH URL, if any, resolved the dashboard's probe name */
export const probeApi = router();

probeApi.get("/:nonce", async (c) => {
  const nonce = c.req.param("nonce");
  if (!isNonce(nonce)) throw new HttpError(400, "invalid nonce");
  const hit = await findProbe(c.env, nonce);
  return c.json({ device: hit && { id: hit.deviceId, name: hit.deviceName } });
});
