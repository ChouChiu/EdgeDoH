import { BLOCKING_MODES, type BlockingMode, DEFAULT_PROFILE_ID, DEVICE_RULES_LIST_ID, isUpstreamList, SERVICE_LIST_PREFIX } from "#contract";
import type { Snapshot } from "#filter";
import { HttpError } from "../../shared/http.ts";
import { getRuntimeConfig, publishRuntimeConfig } from "../../shared/runtime-config.ts";
import { isOneOf, UPSTREAMS_ERROR } from "../../shared/validate.ts";

const MAX_IDS = 1000;
const ID_RE = /^[A-Za-z0-9_.:-]{1,100}$/;

/** Minutes since local midnight; `end <= start` runs past midnight into the next day */
export interface Schedule {
  timezone: string;
  /** 0 = Sunday … 6 = Saturday, the day the window starts on */
  days: number[];
  start: number;
  end: number;
}

export interface ProfileConfig {
  /** Off: no filter list, service or safe search applies to this profile's devices */
  filtering: boolean;
  /** Filter list IDs (including `custom`) applied; null applies every enabled list */
  lists: string[] | null;
  /** AdGuard blocked service IDs, always blocked */
  services: string[];
  /** Blocked only while `schedule` is active */
  scheduledServices: string[];
  /** Profile the devices use instead while `schedule` is active; that profile's own switch is not followed */
  scheduledProfile: string | null;
  schedule: Schedule | null;
  safeSearch: boolean;
  youtubeRestricted: boolean;
  /** Block public answers that point at loopback, private or link-local addresses */
  rebinding: boolean;
  /** null uses the global setting */
  blockingMode: BlockingMode | null;
  /** null uses the global upstreams */
  upstreams: string[] | null;
  /** Send names covered by route lists to those lists' upstreams */
  splitDns: boolean;
  /** Forward the client's /24 (IPv6 /56) to upstreams as EDNS Client Subnet */
  ecs: boolean;
  /** Add Cloudflare's ECH config to HTTPS records of Cloudflare-proxied names */
  ech: boolean;
  /** Advertise HTTP/3 in HTTPS records of Cloudflare-proxied names */
  h3: boolean;
}

export interface Profile extends ProfileConfig {
  id: string;
  name: string;
}

export const PROFILE_DEFAULTS: ProfileConfig = {
  filtering: true,
  lists: null,
  services: [],
  scheduledServices: [],
  scheduledProfile: null,
  schedule: null,
  safeSearch: false,
  youtubeRestricted: false,
  rebinding: false,
  blockingMode: null,
  upstreams: null,
  splitDns: true,
  ecs: false,
  ech: false,
  h3: false,
};

interface Row {
  id: string;
  name: string;
  config: string;
  created_at: number;
}

/** Profiles rebuilt from the runtime config, recomputed only when that object changes */
let cached: { source: object; profiles: Map<string, Profile> } | undefined;

/** The device's profile, or the default one when it has none or it was deleted */
export async function getProfile(env: Env, id: string | null): Promise<Profile> {
  const profiles = await runtimeProfiles(env);
  return profiles.get(id ?? DEFAULT_PROFILE_ID) ?? profiles.get(DEFAULT_PROFILE_ID) ?? defaultProfile();
}

/**
 * The profile in force at `now`: the scheduled profile while `profile`'s schedule runs, otherwise
 * `profile` itself, which is also kept when the scheduled one was deleted
 */
export async function profileAt(env: Env, profile: Profile, now: number): Promise<Profile> {
  if (profile.scheduledProfile === null || profile.schedule === null || !scheduleActive(profile.schedule, now)) return profile;
  return (await runtimeProfiles(env)).get(profile.scheduledProfile) ?? profile;
}

async function runtimeProfiles(env: Env): Promise<Map<string, Profile>> {
  const config = await getRuntimeConfig(env);
  if (cached?.source !== config.profiles) {
    const profiles = new Map<string, Profile>();
    for (const [pid, raw] of Object.entries(config.profiles)) profiles.set(pid, fromStored(pid, raw));
    cached = { source: config.profiles, profiles };
  }
  return cached.profiles;
}

export async function listProfiles(db: D1Database): Promise<Profile[]> {
  const { results } = await db.prepare("SELECT id, name, config, created_at FROM profiles ORDER BY created_at, name").all<Row>();
  return results.map((r) => fromStored(r.id, { ...(JSON.parse(r.config) as Record<string, unknown>), name: r.name }));
}

export async function findProfile(db: D1Database, id: string): Promise<Profile | null> {
  const row = await db.prepare("SELECT id, name, config, created_at FROM profiles WHERE id = ?").bind(id).first<Row>();
  return row ? fromStored(row.id, { ...(JSON.parse(row.config) as Record<string, unknown>), name: row.name }) : null;
}

export async function createProfile(env: Env, name: string, config: Partial<ProfileConfig>): Promise<Profile> {
  const id = crypto.randomUUID().slice(0, 8);
  await env.DB.prepare("INSERT INTO profiles (id, name, config, created_at) VALUES (?, ?, ?, ?)")
    .bind(id, name, JSON.stringify(config), Date.now())
    .run();
  await publishRuntimeConfig(env);
  return (await findProfile(env.DB, id))!;
}

export async function updateProfile(env: Env, id: string, name: string | undefined, patch: Partial<ProfileConfig>): Promise<Profile | null> {
  const current = await findProfile(env.DB, id);
  if (!current) return null;
  const { id: _id, name: oldName, ...config } = current;
  await env.DB.prepare("UPDATE profiles SET name = ?, config = ? WHERE id = ?")
    .bind(name ?? oldName, JSON.stringify({ ...config, ...patch }), id)
    .run();
  await publishRuntimeConfig(env);
  return findProfile(env.DB, id);
}

export async function deleteProfile(env: Env, id: string): Promise<boolean> {
  if (id === DEFAULT_PROFILE_ID) throw new HttpError(400, "the default profile cannot be deleted");
  const [, , result] = await env.DB.batch([
    env.DB.prepare("UPDATE devices SET profile_id = NULL WHERE profile_id = ?").bind(id),
    // Profiles that switched to this one on a schedule stop switching
    env.DB.prepare("UPDATE profiles SET config = json_remove(config, '$.scheduledProfile') WHERE json_extract(config, '$.scheduledProfile') = ?").bind(id),
    env.DB.prepare("DELETE FROM profiles WHERE id = ?").bind(id),
  ]);
  if (result!.meta.changes === 0) return false;
  await publishRuntimeConfig(env);
  return true;
}

function defaultProfile(): Profile {
  return { id: DEFAULT_PROFILE_ID, name: "Default", ...PROFILE_DEFAULTS };
}

/** Stored values are validated again on read, so a bad row degrades to defaults instead of failing queries */
function fromStored(id: string, raw: Record<string, unknown>): Profile {
  const { name, ...config } = raw;
  return { id, name: typeof name === "string" ? name : id, ...PROFILE_DEFAULTS, ...validateProfile(config).valid };
}

/** Splits input into the valid subset and an error message for each rejected key */
export function validateProfile(input: Record<string, unknown>): { valid: Partial<ProfileConfig>; errors: string[] } {
  const valid: Record<string, unknown> = {};
  const errors: string[] = [];
  const ids = (key: string, value: unknown) => {
    if (Array.isArray(value) && value.length <= MAX_IDS && value.every((v) => typeof v === "string" && ID_RE.test(v))) {
      valid[key] = [...new Set(value as string[])];
    } else {
      errors.push(`${key} must be a list of IDs`);
    }
  };

  for (const [key, value] of Object.entries(input)) {
    switch (key) {
      case "filtering":
      case "safeSearch":
      case "youtubeRestricted":
      case "rebinding":
      case "splitDns":
      case "ecs":
      case "ech":
      case "h3":
        if (typeof value === "boolean") valid[key] = value;
        else errors.push(`${key} must be true or false`);
        break;
      case "lists":
        if (value === null) valid[key] = null;
        else ids(key, value);
        break;
      case "services":
      case "scheduledServices":
        ids(key, value);
        break;
      case "blockingMode":
        if (value === null || isOneOf(BLOCKING_MODES, value)) valid[key] = value;
        else errors.push(`blockingMode must be null or one of ${BLOCKING_MODES.join(", ")}`);
        break;
      case "scheduledProfile":
        if (value === null || (typeof value === "string" && ID_RE.test(value))) valid[key] = value;
        else errors.push("scheduledProfile must be null or a profile ID");
        break;
      case "upstreams":
        if (value === null || isUpstreamList(value)) valid[key] = value;
        else errors.push(`${UPSTREAMS_ERROR}, or null`);
        break;
      case "schedule":
        if (value === null) valid[key] = null;
        else {
          const schedule = parseSchedule(value);
          if (schedule) valid[key] = schedule;
          else errors.push("schedule needs a valid timezone, days 0-6 and start/end minutes 0-1440");
        }
        break;
      default:
        errors.push(`unknown profile field ${key}`);
    }
  }
  return { valid: valid as Partial<ProfileConfig>, errors };
}

function parseSchedule(value: unknown): Schedule | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { timezone, days, start, end } = value as Record<string, unknown>;
  const minute = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 1440;
  if (typeof timezone !== "string" || !isTimeZone(timezone) || !minute(start) || !minute(end)) return undefined;
  if (!Array.isArray(days) || !days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) return undefined;
  return { timezone, days: [...new Set(days as number[])].sort(), start, end };
}

function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** custom_ip answers with the global addresses, so a profile may only pick it when they exist */
export function profileErrors(profile: ProfileConfig, global: { blockingIpv4: string; blockingIpv6: string }): string[] {
  if (profile.blockingMode === "custom_ip" && !global.blockingIpv4 && !global.blockingIpv6) {
    return ["custom_ip needs blockingIpv4 or blockingIpv6 in the global settings"];
  }
  return [];
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const formatters = new Map<string, Intl.DateTimeFormat>();

/** Whether `now` falls inside the schedule, evaluated in the schedule's own time zone */
export function scheduleActive(schedule: Schedule, now: number): boolean {
  let format = formatters.get(schedule.timezone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", { timeZone: schedule.timezone, weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" });
    formatters.set(schedule.timezone, format);
  }
  let day = 0;
  let minute = 0;
  for (const part of format.formatToParts(now)) {
    if (part.type === "weekday") day = WEEKDAYS.indexOf(part.value);
    else if (part.type === "hour") minute += Number(part.value) * 60;
    else if (part.type === "minute") minute += Number(part.value);
  }
  const { days, start, end } = schedule;
  if (start < end) return days.includes(day) && minute >= start && minute < end;
  // Overnight window: the evening part belongs to `day`, the early morning part to the day before
  return (days.includes(day) && minute >= start) || (days.includes((day + 6) % 7) && minute < end);
}

const masks = new WeakMap<Snapshot, WeakMap<Profile, (Uint8Array | undefined)[]>>();

/**
 * Lists of `snapshot` that apply to the profile, as the matcher's `active` mask. Cached per
 * snapshot and profile object, both of which are replaced whenever they change
 */
export function activeLists(snapshot: Snapshot, profile: Profile, scheduled: boolean): Uint8Array {
  let byProfile = masks.get(snapshot);
  if (!byProfile) {
    byProfile = new WeakMap();
    masks.set(snapshot, byProfile);
  }
  let slots = byProfile.get(profile);
  if (!slots) {
    slots = [];
    byProfile.set(profile, slots);
  }
  const slot = scheduled ? 1 : 0;
  const hit = slots[slot];
  if (hit) return hit;

  const lists = profile.lists === null ? undefined : new Set(profile.lists);
  const services = new Set([...profile.services, ...(scheduled ? profile.scheduledServices : [])].map((s) => SERVICE_LIST_PREFIX + s));
  const mask = new Uint8Array(snapshot.meta.lists.length);
  snapshot.meta.lists.forEach((list, i) => {
    const kind = list.kind ?? "filter";
    // Device overrides target single devices through `$client`, so no profile can switch them off
    if (kind === "filter") mask[i] = !lists || lists.has(list.id) || list.id === DEVICE_RULES_LIST_ID ? 1 : 0;
    else if (kind === "service") mask[i] = services.has(list.id) ? 1 : 0;
  });
  slots[slot] = mask;
  return mask;
}
