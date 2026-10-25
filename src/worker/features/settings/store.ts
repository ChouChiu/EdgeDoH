import { isIPv4, isIPv6 } from "#dns";
import { isHttpUrl } from "../../shared/http.ts";
import { getRuntimeConfig, publishRuntimeConfig, type RuntimeConfig } from "../../shared/runtime-config.ts";

export const BLOCKING_MODES = ["null_ip", "custom_ip", "nxdomain", "refused", "nodata"] as const;
export type BlockingMode = (typeof BLOCKING_MODES)[number];

export const UPSTREAM_MODES = ["fallback", "parallel"] as const;
export type UpstreamMode = (typeof UPSTREAM_MODES)[number];

export interface Settings {
  /** Off: every query is forwarded, rules are not even loaded */
  filteringEnabled: boolean;
  blockingMode: BlockingMode;
  /** Addresses answered by `custom_ip`; empty means no record for that family */
  blockingIpv4: string;
  blockingIpv6: string;
  blockedTtl: number;
  /** Answer every AAAA query with an empty NOERROR, like AdGuard Home's aaaa_disabled */
  disableIpv6: boolean;
  upstreams: string[];
  /** fallback: one after another; parallel: all at once, first good answer wins */
  upstreamMode: UpstreamMode;
  upstreamTimeoutMs: number;
  cacheEnabled: boolean;
  /** Bounds applied to upstream TTLs, both in the cache and in answers sent to clients */
  cacheMinTtl: number;
  cacheMaxTtl: number;
  queryLogEnabled: boolean;
  /** Distinct source networks (IPv4 address or IPv6 /64) one device may be used from per window; 0 is unlimited */
  maxDeviceClients: number;
  deviceClientWindowMinutes: number;
}

const MAX_TTL = 86400;
const MAX_UPSTREAMS = 5;
const MIN_TIMEOUT_MS = 500;
const MAX_TIMEOUT_MS = 10_000;
const MAX_MIN_TTL = 3600;
const MAX_DEVICE_CLIENTS = 1000;
const MAX_CLIENT_WINDOW_MINUTES = 7 * 24 * 60;

/** Recomputed only when the runtime config object changes */
let cached: { source: RuntimeConfig; settings: Settings } | undefined;

/** wrangler.jsonc vars and the constants here are the defaults; rows in the settings table override them */
export async function getSettings(env: Env): Promise<Settings> {
  const config = await getRuntimeConfig(env);
  if (cached?.source === config) return cached.settings;
  const settings = { ...defaultSettings(env), ...validateSettings(config.settings).valid };
  cached = { source: config, settings };
  return settings;
}

function defaultSettings(env: Env): Settings {
  return {
    filteringEnabled: true,
    blockingMode: isOneOf(BLOCKING_MODES, env.BLOCKING_MODE) ? env.BLOCKING_MODE : "null_ip",
    blockingIpv4: "",
    blockingIpv6: "",
    blockedTtl: Number(env.BLOCKED_TTL) || 10,
    disableIpv6: false,
    upstreams: env.UPSTREAMS.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    upstreamMode: "fallback",
    upstreamTimeoutMs: Number(env.UPSTREAM_TIMEOUT_MS) || 3000,
    cacheEnabled: true,
    cacheMinTtl: 0,
    cacheMaxTtl: MAX_TTL,
    queryLogEnabled: true,
    maxDeviceClients: 0,
    deviceClientWindowMinutes: 60,
  };
}

export async function saveSettings(env: Env, patch: Partial<Settings>): Promise<Settings> {
  const entries = Object.entries(patch);
  if (entries.length > 0) {
    await env.DB.batch(
      entries.map(([key, value]) =>
        env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").bind(
          key,
          JSON.stringify(value),
        ),
      ),
    );
  }
  await publishRuntimeConfig(env);
  return getSettings(env);
}

/** Rules that span several keys, checked against the settings a patch would produce */
export function crossFieldErrors(settings: Settings): string[] {
  const errors: string[] = [];
  if (settings.cacheMinTtl > settings.cacheMaxTtl) errors.push("cacheMinTtl must not exceed cacheMaxTtl");
  if (settings.blockingMode === "custom_ip" && !settings.blockingIpv4 && !settings.blockingIpv6) {
    errors.push("custom_ip needs blockingIpv4 or blockingIpv6");
  }
  return errors;
}

/** Splits input into the valid subset and an error message for each rejected key */
export function validateSettings(input: Record<string, unknown>): { valid: Partial<Settings>; errors: string[] } {
  const valid: Record<string, unknown> = {};
  const errors: string[] = [];
  const integer = (key: string, value: unknown, min: number, max: number) => {
    if (Number.isInteger(value) && (value as number) >= min && (value as number) <= max) valid[key] = value;
    else errors.push(`${key} must be an integer between ${min} and ${max}`);
  };
  const boolean = (key: string, value: unknown) => {
    if (typeof value === "boolean") valid[key] = value;
    else errors.push(`${key} must be true or false`);
  };

  for (const [key, value] of Object.entries(input)) {
    switch (key) {
      case "filteringEnabled":
      case "disableIpv6":
      case "cacheEnabled":
      case "queryLogEnabled":
        boolean(key, value);
        break;
      case "blockingMode":
        if (isOneOf(BLOCKING_MODES, value)) valid[key] = value;
        else errors.push(`blockingMode must be one of ${BLOCKING_MODES.join(", ")}`);
        break;
      case "upstreamMode":
        if (isOneOf(UPSTREAM_MODES, value)) valid[key] = value;
        else errors.push(`upstreamMode must be one of ${UPSTREAM_MODES.join(", ")}`);
        break;
      case "blockingIpv4":
      case "blockingIpv6":
        if (value === "" || (typeof value === "string" && (key === "blockingIpv4" ? isIPv4 : isIPv6)(value))) {
          valid[key] = value;
        } else {
          errors.push(`${key} must be a valid ${key === "blockingIpv4" ? "IPv4" : "IPv6"} address or empty`);
        }
        break;
      case "blockedTtl":
        integer(key, value, 0, MAX_TTL);
        break;
      case "upstreamTimeoutMs":
        integer(key, value, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
        break;
      case "cacheMinTtl":
        integer(key, value, 0, MAX_MIN_TTL);
        break;
      case "cacheMaxTtl":
        integer(key, value, 1, MAX_TTL);
        break;
      case "maxDeviceClients":
        integer(key, value, 0, MAX_DEVICE_CLIENTS);
        break;
      case "deviceClientWindowMinutes":
        integer(key, value, 5, MAX_CLIENT_WINDOW_MINUTES);
        break;
      case "upstreams":
        if (
          Array.isArray(value) &&
          value.length >= 1 &&
          value.length <= MAX_UPSTREAMS &&
          value.every((u) => typeof u === "string" && isHttpUrl(u, ["https:"]))
        ) {
          valid[key] = value;
        } else {
          errors.push(`upstreams must be 1-${MAX_UPSTREAMS} https:// DoH URLs`);
        }
        break;
      default:
        errors.push(`unknown setting ${key}`);
    }
  }
  return { valid: valid as Partial<Settings>, errors };
}

function isOneOf<T extends string>(options: readonly T[], value: unknown): value is T {
  return options.includes(value as T);
}
