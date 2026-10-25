import { HttpError, readJsonObject, router } from "../../shared/http.ts";
import { crossFieldErrors, getSettings, saveSettings, validateSettings } from "./store.ts";

export const settingsApi = router();

settingsApi.get("/", async (c) => c.json(await getSettings(c.env)));

settingsApi.patch("/", async (c) => {
  const { valid, errors } = validateSettings(await readJsonObject(c));
  if (errors.length === 0) errors.push(...crossFieldErrors({ ...(await getSettings(c.env)), ...valid }));
  if (errors.length > 0) throw new HttpError(400, errors.join("; "));
  return c.json(await saveSettings(c.env, valid));
});
