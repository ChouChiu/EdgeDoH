import { RRType } from "#dns";
import { HttpError, readJsonObject, router } from "../../shared/http.ts";
import { getRuntimeConfig } from "../../shared/runtime-config.ts";
import { findDevice } from "../devices/store.ts";
import { getProfile, profileAt } from "../profiles/store.ts";
import { getSettings } from "../settings/store.ts";
import { decide } from "./decide.ts";

/** Mounted at /api/rules/test: explains how a name would be answered, as seen by one device or the default profile */
export const ruleTestApi = router();

ruleTestApi.post("/", async (c) => {
  const body = await readJsonObject(c);
  if (typeof body.name !== "string" || body.name.trim() === "") throw new HttpError(400, "name is required");
  const typeName = typeof body.type === "string" ? body.type.toUpperCase() : "A";
  if (!Object.hasOwn(RRType, typeName)) throw new HttpError(400, `unknown type ${typeName}`);
  const type = RRType[typeName as keyof typeof RRType];

  const device = typeof body.deviceId === "string" ? await findDevice(c.env, body.deviceId) : null;
  const [settings, assigned, runtime] = await Promise.all([getSettings(c.env), getProfile(c.env, device?.profileId ?? null), getRuntimeConfig(c.env)]);
  const now = Date.now();
  const profile = await profileAt(c.env, assigned, now);
  const name = body.name.trim().toLowerCase().replace(/\.$/, "");
  const { verdict } = await decide(c.env, {
    device: device ?? { id: "", name: "", pausedUntil: null },
    profile,
    settings,
    records: runtime.records,
    name,
    type,
    ip: null,
    now,
  });
  return c.json({ name, type: typeName, verdict });
});
