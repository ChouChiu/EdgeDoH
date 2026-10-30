/**
 * Whole-configuration backup: settings, profiles, devices with their overrides, lists, custom rules
 * and local records.
 * Device IDs are left out because they are the DoH endpoints themselves; an import gives every
 * device a new one. Downloaded lists travel as URLs only and are fetched again after an import
 */
import { isHttpUrl, MAX_DEVICE_NAME, MAX_PROFILE_NAME } from "#contract";
import { HttpError } from "../../shared/http.ts";
import { publishRuntimeConfig } from "../../shared/runtime-config.ts";
import { isUpstreamList } from "../../shared/validate.ts";
import { newDeviceId, type StoredDeviceRule, validateDeviceRules } from "../devices/store.ts";
import {
  CUSTOM_LIST_ID,
  getLists,
  LIST_KINDS,
  type ListKind,
  MAX_CUSTOM_RULES_BYTES,
  MAX_INLINE_BYTES,
  MAX_LIST_NAME,
  textKey,
} from "../lists/store.ts";
import { DEFAULT_PROFILE_ID, PROFILE_DEFAULTS, profileErrors, validateProfile } from "../profiles/store.ts";
import { listRecords, type LocalRecord, validateRecords } from "../records/store.ts";
import { crossFieldErrors, defaultSettings, validateSettings } from "../settings/store.ts";

export const BACKUP_FORMAT = "edgedoh-backup";
export const BACKUP_VERSION = 1;
/** Inline lists and custom rules are each capped at 1 MiB, so this leaves room for a few of both */
export const MAX_BACKUP_BYTES = 8 * 1024 * 1024;
const MAX_DEVICES = 1000;
const MAX_PROFILES = 100;
const MAX_LISTS = 500;
const ID_RE = /^[A-Za-z0-9_.:-]{1,100}$/;

export interface BackupList {
  id: string;
  name: string;
  url: string;
  source: "registry" | "url" | "inline";
  kind: ListKind;
  upstreams: string[] | null;
  registryId: number | null;
  enabled: boolean;
  /** Inline lists only */
  text?: string;
}

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: number;
  /** Only the keys changed from their defaults, as stored */
  settings: Record<string, unknown>;
  /** `config` holds only the fields changed from the defaults, as stored */
  profiles: { id: string; name: string; config: Record<string, unknown> }[];
  /** `rules` are the device's overrides, which follow it to its new ID */
  devices: { name: string; profileId: string | null; rules: StoredDeviceRule[] }[];
  lists: BackupList[];
  customRules: string;
  records: LocalRecord[];
}

export interface ImportResult {
  devices: number;
  /** Lists that must be downloaded again before the next rebuild */
  pending: string[];
}

type Row = Record<string, string | number | null>;

export async function exportBackup(env: Env): Promise<Backup> {
  const [settings, profiles, devices, deviceRules] = await env.DB.batch<Row>([
    env.DB.prepare("SELECT key, value FROM settings ORDER BY key"),
    env.DB.prepare("SELECT id, name, config FROM profiles ORDER BY created_at, name"),
    env.DB.prepare("SELECT id, name, profile_id FROM devices ORDER BY created_at"),
    env.DB.prepare("SELECT device_id, name, action FROM device_rules ORDER BY name"),
  ]);
  const rules = new Map<string, StoredDeviceRule[]>();
  for (const r of deviceRules!.results) {
    const list = rules.get(String(r.device_id)) ?? [];
    list.push({ name: String(r.name), action: r.action as StoredDeviceRule["action"] });
    rules.set(String(r.device_id), list);
  }
  const [lists, records, customRules] = await Promise.all([getLists(env.DB), listRecords(env.DB), env.RULES.get(textKey(CUSTOM_LIST_ID))]);
  const inline = await Promise.all(lists.map((l) => (l.source === "inline" ? env.RULES.get(textKey(l.id)) : null)));
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    settings: Object.fromEntries(settings!.results.map((r) => [String(r.key), JSON.parse(String(r.value)) as unknown])),
    profiles: profiles!.results.map((r) => ({ id: String(r.id), name: String(r.name), config: JSON.parse(String(r.config)) as Record<string, unknown> })),
    devices: devices!.results.map((r) => ({
      name: String(r.name),
      profileId: r.profile_id === null ? null : String(r.profile_id),
      rules: rules.get(String(r.id)) ?? [],
    })),
    lists: lists.map((l, i) => ({
      id: l.id,
      name: l.name,
      url: l.url,
      source: l.source,
      kind: l.kind,
      upstreams: l.upstreams,
      registryId: l.registryId,
      enabled: l.enabled,
      ...(l.source === "inline" && { text: inline[i] ?? "" }),
    })),
    customRules: customRules ?? "",
    records,
  };
}

/** Replaces the whole configuration with the backup's; nothing is written unless all of it is valid */
export async function importBackup(env: Env, input: unknown): Promise<ImportResult> {
  const backup = validateBackup(env, input);
  const previous = await getLists(env.DB);
  const now = Date.now();
  const { DB } = env;

  const profiles = backup.profiles.filter((p) => p.id !== DEFAULT_PROFILE_ID);
  const fallback = backup.profiles.find((p) => p.id === DEFAULT_PROFILE_ID) ?? { name: "Default", config: {} };
  await DB.batch([
    DB.prepare("DELETE FROM devices"),
    DB.prepare("DELETE FROM filter_lists"),
    DB.prepare("DELETE FROM local_records"),
    DB.prepare("DELETE FROM settings"),
    DB.prepare("DELETE FROM profiles WHERE id != ?").bind(DEFAULT_PROFILE_ID),
    DB.prepare("UPDATE profiles SET name = ?, config = ? WHERE id = ?").bind(fallback.name, JSON.stringify(fallback.config), DEFAULT_PROFILE_ID),
    ...profiles.map((p, i) =>
      DB.prepare("INSERT INTO profiles (id, name, config, created_at) VALUES (?, ?, ?, ?)").bind(p.id, p.name, JSON.stringify(p.config), now + i),
    ),
    ...backup.devices.flatMap((d, i) => {
      const id = newDeviceId();
      return [
        DB.prepare("INSERT INTO devices (id, name, created_at, profile_id) VALUES (?, ?, ?, ?)").bind(id, d.name, now + i, d.profileId),
        ...d.rules.map((r) => DB.prepare("INSERT INTO device_rules (device_id, name, action) VALUES (?, ?, ?)").bind(id, r.name, r.action)),
      ];
    }),
    ...backup.lists.map((l, i) =>
      DB.prepare(
        "INSERT INTO filter_lists (id, name, url, source, kind, upstreams, registry_id, enabled, fetched_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(
        l.id,
        l.name,
        l.url,
        l.source,
        l.kind,
        l.upstreams ? JSON.stringify(l.upstreams) : null,
        l.registryId,
        l.enabled ? 1 : 0,
        l.source === "inline" ? now : null,
        now + i,
      ),
    ),
    ...backup.records.map((r) => DB.prepare("INSERT INTO local_records (name, type, value) VALUES (?, ?, ?)").bind(r.name, r.type, r.value)),
    ...Object.entries(backup.settings).map(([key, value]) => DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").bind(key, JSON.stringify(value))),
  ]);

  const kept = new Set(backup.lists.map((l) => l.id));
  await Promise.all([
    env.RULES.put(textKey(CUSTOM_LIST_ID), backup.customRules),
    ...backup.lists.filter((l) => l.source === "inline").map((l) => env.RULES.put(textKey(l.id), l.text ?? "")),
    // A downloaded list keeps its old text until it is fetched again, unless it left the configuration
    ...previous.filter((l) => !kept.has(l.id)).map((l) => env.RULES.delete(textKey(l.id))),
  ]);
  await publishRuntimeConfig(env);
  return { devices: backup.devices.length, pending: backup.lists.filter((l) => l.source !== "inline").map((l) => l.id) };
}

function validateBackup(env: Env, input: unknown): Backup {
  const b = object(input, "backup");
  if (b.format !== BACKUP_FORMAT) throw new HttpError(400, "not an EdgeDoH backup");
  if (b.version !== BACKUP_VERSION) throw new HttpError(400, `unsupported backup version ${String(b.version)}`);
  const errors: string[] = [];

  const settings = validateSettings(object(b.settings, "settings"));
  errors.push(...settings.errors.map((e) => `settings: ${e}`));
  const global = { ...defaultSettings(env), ...settings.valid };
  if (settings.errors.length === 0) errors.push(...crossFieldErrors(global).map((e) => `settings: ${e}`));

  const profiles = array(b.profiles, "profiles", MAX_PROFILES).map((item, i) => {
    const p = object(item, `profile ${i + 1}`);
    const id = typeof p.id === "string" && ID_RE.test(p.id) ? p.id : (errors.push(`profile ${i + 1}: invalid id`), "");
    const name = trimmedName(p.name, MAX_PROFILE_NAME) ?? (errors.push(`profile ${i + 1}: name must be 1-${MAX_PROFILE_NAME} characters`), "");
    const { valid, errors: invalid } = validateProfile(object(p.config, `profile ${i + 1} config`));
    errors.push(...invalid.map((e) => `profile ${name || i + 1}: ${e}`));
    if (invalid.length === 0) errors.push(...profileErrors({ ...PROFILE_DEFAULTS, ...valid }, global).map((e) => `profile ${name}: ${e}`));
    return { id, name, config: valid as Record<string, unknown> };
  });
  const profileIds = new Set(profiles.map((p) => p.id));
  if (profileIds.size !== profiles.length) errors.push("profiles: duplicate id");

  const devices = array(b.devices, "devices", MAX_DEVICES).map((item, i) => {
    const d = object(item, `device ${i + 1}`);
    const name = trimmedName(d.name, MAX_DEVICE_NAME) ?? (errors.push(`device ${i + 1}: name must be 1-${MAX_DEVICE_NAME} characters`), "");
    const profileId = d.profileId === null || d.profileId === DEFAULT_PROFILE_ID ? null : d.profileId;
    if (profileId !== null && (typeof profileId !== "string" || !profileIds.has(profileId))) errors.push(`device ${name}: unknown profile`);
    let rules: StoredDeviceRule[] = [];
    try {
      rules = validateDeviceRules(d.rules ?? []);
    } catch (err) {
      errors.push(`device ${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return { name, profileId: profileId as string | null, rules };
  });

  const lists = array(b.lists, "lists", MAX_LISTS).map((item, i) => validateList(object(item, `list ${i + 1}`), i, errors));
  if (new Set(lists.map((l) => l.id)).size !== lists.length) errors.push("lists: duplicate id");

  if (typeof b.customRules !== "string") errors.push("customRules must be text");
  else if (new TextEncoder().encode(b.customRules).length > MAX_CUSTOM_RULES_BYTES) errors.push(`customRules exceed ${MAX_CUSTOM_RULES_BYTES} bytes`);

  let records: LocalRecord[] = [];
  try {
    records = validateRecords(b.records);
  } catch (err) {
    errors.push(`records: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (errors.length > 0) throw new HttpError(400, errors.slice(0, 10).join("; "));
  return { ...(b as unknown as Backup), settings: settings.valid, profiles, devices, lists, records };
}

function validateList(l: Record<string, unknown>, i: number, errors: string[]): BackupList {
  const label = typeof l.name === "string" && l.name ? l.name : `list ${i + 1}`;
  const fail = (why: string) => errors.push(`${label}: ${why}`);
  const id = typeof l.id === "string" && ID_RE.test(l.id) && l.id !== CUSTOM_LIST_ID ? l.id : (fail("invalid id"), "");
  const name = trimmedName(l.name, MAX_LIST_NAME) ?? (fail(`name must be 1-${MAX_LIST_NAME} characters`), "");
  const source = l.source === "registry" || l.source === "url" || l.source === "inline" ? l.source : (fail("unknown source"), "url");
  const kind = (LIST_KINDS as readonly unknown[]).includes(l.kind) ? (l.kind as ListKind) : (fail("unknown kind"), "filter");
  const url = typeof l.url === "string" ? l.url : "";
  if (source !== "inline" && !isHttpUrl(url)) fail("URL must be http or https");
  const upstreams = kind === "route" ? (isUpstreamList(l.upstreams) ? l.upstreams : (fail("route lists need 1-5 https upstreams"), null)) : null;
  const registryId = source === "registry" ? (Number.isInteger(l.registryId) ? (l.registryId as number) : (fail("invalid registryId"), null)) : null;
  if (typeof l.enabled !== "boolean") fail("enabled must be true or false");
  let text: string | undefined;
  if (source === "inline") {
    if (typeof l.text !== "string") fail("inline lists need their text");
    else if (new TextEncoder().encode(l.text).length > MAX_INLINE_BYTES) fail(`text exceeds ${MAX_INLINE_BYTES} bytes`);
    else text = l.text;
  }
  return { id, name, url: source === "inline" ? "" : url, source, kind, upstreams, registryId, enabled: l.enabled === true, ...(text !== undefined && { text }) };
}

function object(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new HttpError(400, `${what} must be an object`);
  return value as Record<string, unknown>;
}

function array(value: unknown, what: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new HttpError(400, `${what} must be a list of at most ${max}`);
  return value;
}

function trimmedName(value: unknown, max: number): string | undefined {
  const name = typeof value === "string" ? value.trim() : "";
  return name && name.length <= max ? name : undefined;
}
