import type { Context } from "hono";
import { type AppEnv, HttpError, readJsonObject, router } from "../../shared/http.ts";
import { publishRuntimeConfig } from "../../shared/runtime-config.ts";
import { getSettings } from "../settings/store.ts";
import { resetClients, seenClients } from "./client-guard.ts";
import { mobileconfig } from "./mobileconfig.ts";
import { createDevice, deleteDevice, type Device, findDevice, isDeviceId, listDevices, renameDevice } from "./store.ts";

const MAX_NAME_LENGTH = 64;
const NOT_FOUND = "device not found";

export const devicesApi = router();

devicesApi.get("/", async (c) => {
  const devices = await listDevices(c.env.DB);
  return c.json(devices.map((d) => present(d, c.req.url)));
});

devicesApi.post("/", async (c) => {
  const device = await createDevice(c.env.DB, await readName(c));
  await publishRuntimeConfig(c.env);
  return c.json(present(device, c.req.url), 201);
});

devicesApi.patch("/:id", async (c) => {
  const id = c.req.param("id");
  if (!isDeviceId(id)) throw new HttpError(404, NOT_FOUND);
  const device = await renameDevice(c.env.DB, id, await readName(c));
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

/** Source networks that used the device inside the client-limit window */
devicesApi.get("/:id/clients", async (c) => {
  const device = await findDevice(c.env, c.req.param("id"));
  if (!device) throw new HttpError(404, NOT_FOUND);
  const settings = await getSettings(c.env);
  return c.json({
    limit: settings.maxDeviceClients,
    windowMinutes: settings.deviceClientWindowMinutes,
    clients: await seenClients(c.env, device.id, settings.deviceClientWindowMinutes * 60_000),
  });
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
    "content-disposition": `attachment; filename="cf-dns-${device.id}.mobileconfig"`,
  });
});

async function readName(c: Context<AppEnv>): Promise<string> {
  const { name } = await readJsonObject(c);
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (trimmed.length === 0 || trimmed.length > MAX_NAME_LENGTH) throw new HttpError(400, `name must be 1-${MAX_NAME_LENGTH} characters`);
  return trimmed;
}

function present(device: Device, requestUrl: string) {
  return { ...device, dohUrl: new URL(`/dns-query/${device.id}`, requestUrl).toString() };
}
