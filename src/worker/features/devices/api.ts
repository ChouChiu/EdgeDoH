import { MAX_DEVICE_NAME } from "#contract";
import type { Context } from "hono";
import { type AppEnv, HttpError, readJson, readJsonObject, router } from "../../shared/http.ts";
import { publishRuntimeConfig } from "../../shared/runtime-config.ts";
import { getSettings } from "../settings/store.ts";
import { resetClients, seenClients } from "./client-guard.ts";
import { mobileconfig } from "./mobileconfig.ts";
import { findProfile } from "../profiles/store.ts";
import {
  createDevice,
  deleteDevice,
  type Device,
  type DevicePatch,
  findDevice,
  isDeviceId,
  listDeviceRules,
  listDevices,
  replaceDeviceRules,
  updateDevice,
  validateDeviceRules,
} from "./store.ts";

/** A day; longer breaks are better expressed by switching the device's profile */
const MAX_PAUSE_MINUTES = 24 * 60;
const NOT_FOUND = "device not found";

export const devicesApi = router();

devicesApi.get("/", async (c) => {
  const devices = await listDevices(c.env.DB);
  return c.json(devices.map((d) => present(d, c.req.url)));
});

/** Every device's overrides, read by the dashboard's snapshot compiler */
devicesApi.get("/rules", async (c) => c.json(await listDeviceRules(c.env.DB)));

devicesApi.get("/:id/rules", async (c) => {
  const id = c.req.param("id");
  if (!isDeviceId(id) || !(await findDevice(c.env, id))) throw new HttpError(404, NOT_FOUND);
  return c.json((await listDeviceRules(c.env.DB, id)).map(({ name, action }) => ({ name, action })));
});

/** Replaces the device's overrides; they take effect after the dashboard rebuilds the snapshot */
devicesApi.put("/:id/rules", async (c) => {
  const id = c.req.param("id");
  if (!isDeviceId(id) || !(await findDevice(c.env, id))) throw new HttpError(404, NOT_FOUND);
  const rules = validateDeviceRules(await readJson(c));
  await replaceDeviceRules(c.env.DB, id, rules);
  return c.json(rules);
});

devicesApi.post("/", async (c) => {
  const body = await readJsonObject(c);
  const device = await createDevice(c.env.DB, readName(body.name), await readProfileId(c, body.profileId));
  await publishRuntimeConfig(c.env);
  return c.json(present(device, c.req.url), 201);
});

devicesApi.patch("/:id", async (c) => {
  const id = c.req.param("id");
  if (!isDeviceId(id)) throw new HttpError(404, NOT_FOUND);
  const body = await readJsonObject(c);
  const patch: DevicePatch = {};
  if (body.name !== undefined) patch.name = readName(body.name);
  if (body.profileId !== undefined) patch.profileId = await readProfileId(c, body.profileId);
  const device = await updateDevice(c.env.DB, id, patch);
  if (!device) throw new HttpError(404, NOT_FOUND);
  await publishRuntimeConfig(c.env);
  return c.json(present(device, c.req.url));
});

devicesApi.delete("/:id", async (c) => {
  const id = c.req.param("id");
  if (!isDeviceId(id) || !(await deleteDevice(c.env.DB, id))) throw new HttpError(404, NOT_FOUND);
  await Promise.all([publishRuntimeConfig(c.env), resetClients(c.env, id)]);
  return c.body(null, 204);
});

/** `{ minutes }` pauses filtering for that long; 0 resumes it */
devicesApi.post("/:id/pause", async (c) => {
  const id = c.req.param("id");
  if (!isDeviceId(id)) throw new HttpError(404, NOT_FOUND);
  const { minutes } = await readJsonObject(c);
  if (!Number.isInteger(minutes) || (minutes as number) < 0 || (minutes as number) > MAX_PAUSE_MINUTES) {
    throw new HttpError(400, `minutes must be an integer between 0 and ${MAX_PAUSE_MINUTES}`);
  }
  const pausedUntil = minutes === 0 ? null : Date.now() + (minutes as number) * 60_000;
  const device = await updateDevice(c.env.DB, id, { pausedUntil });
  if (!device) throw new HttpError(404, NOT_FOUND);
  await publishRuntimeConfig(c.env);
  return c.json(present(device, c.req.url));
});

/** Source networks that used the device inside the client-limit window; none while the limit is off */
devicesApi.get("/:id/clients", async (c) => {
  const device = await findDevice(c.env, c.req.param("id"));
  if (!device) throw new HttpError(404, NOT_FOUND);
  const { maxDeviceClients: limit, deviceClientWindowMinutes: windowMinutes } = await getSettings(c.env);
  // Reading the list wakes the device's Durable Object, which is not worth it when nothing is limited
  const clients = limit > 0 ? await seenClients(c.env, device.id, windowMinutes * 60_000) : [];
  return c.json({ limit, windowMinutes, clients });
});

devicesApi.delete("/:id/clients", async (c) => {
  const device = await findDevice(c.env, c.req.param("id"));
  if (!device) throw new HttpError(404, NOT_FOUND);
  await resetClients(c.env, device.id);
  return c.body(null, 204);
});

devicesApi.get("/:id/mobileconfig", async (c) => {
  const device = await findDevice(c.env, c.req.param("id"));
  if (!device) throw new HttpError(404, NOT_FOUND);
  const { dohUrl } = present(device, c.req.url);
  return c.body(await mobileconfig(device, dohUrl), 200, {
    "content-type": "application/x-apple-aspen-config",
    "content-disposition": `attachment; filename="edgedoh-${device.id}.mobileconfig"`,
  });
});

function readName(name: unknown): string {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (trimmed.length === 0 || trimmed.length > MAX_DEVICE_NAME) throw new HttpError(400, `name must be 1-${MAX_DEVICE_NAME} characters`);
  return trimmed;
}

/** null or absent picks the default profile */
async function readProfileId(c: Context<AppEnv>, value: unknown): Promise<string | null> {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !(await findProfile(c.env.DB, value))) throw new HttpError(400, "unknown profile");
  return value;
}

function present(device: Device, requestUrl: string) {
  const pausedUntil = device.pausedUntil !== null && device.pausedUntil > Date.now() ? device.pausedUntil : null;
  return { ...device, pausedUntil, dohUrl: new URL(`/dns-query/${device.id}`, requestUrl).toString() };
}
