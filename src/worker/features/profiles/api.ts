import type { Context } from "hono";
import { type AppEnv, HttpError, readJsonObject, router } from "../../shared/http.ts";
import { getSettings } from "../settings/store.ts";
import {
  createProfile,
  deleteProfile,
  listProfiles,
  MAX_PROFILE_NAME,
  PROFILE_DEFAULTS,
  type ProfileConfig,
  profileErrors,
  updateProfile,
  validateProfile,
} from "./store.ts";

const NOT_FOUND = "profile not found";

export const profilesApi = router();

profilesApi.get("/", async (c) => c.json(await listProfiles(c.env.DB)));

profilesApi.post("/", async (c) => {
  const { name, config } = await readProfile(c, true);
  return c.json(await createProfile(c.env, name!, config), 201);
});

profilesApi.patch("/:id", async (c) => {
  const { name, config } = await readProfile(c, false);
  const profile = await updateProfile(c.env, c.req.param("id"), name, config);
  if (!profile) throw new HttpError(404, NOT_FOUND);
  return c.json(profile);
});

profilesApi.delete("/:id", async (c) => {
  if (!(await deleteProfile(c.env, c.req.param("id")))) throw new HttpError(404, NOT_FOUND);
  return c.body(null, 204);
});

async function readProfile(c: Context<AppEnv>, create: boolean): Promise<{ name: string | undefined; config: Partial<ProfileConfig> }> {
  const { name, ...rest } = await readJsonObject(c);
  const trimmed = typeof name === "string" ? name.trim() : undefined;
  if ((create || name !== undefined) && (!trimmed || trimmed.length > MAX_PROFILE_NAME)) {
    throw new HttpError(400, `name must be 1-${MAX_PROFILE_NAME} characters`);
  }
  const { valid, errors } = validateProfile(rest);
  if (errors.length === 0) errors.push(...profileErrors({ ...PROFILE_DEFAULTS, ...valid }, await getSettings(c.env)));
  if (errors.length > 0) throw new HttpError(400, errors.join("; "));
  return { name: trimmed, config: valid };
}
