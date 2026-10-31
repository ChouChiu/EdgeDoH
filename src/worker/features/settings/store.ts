import { BLOCKING_MODES, type BlockingMode, isHttpUrl, isUpstreamList, MAX_ECH_FORCED_DOMAINS, UPSTREAM_MODES, type UpstreamMode } from "#contract";
import { isIPv4, isIPv6 } from "#dns";
import { isDomain } from "#filter";
import { getRuntimeConfig, publishRuntimeConfig, type RuntimeConfig } from "../../shared/runtime-config.ts";
import { isOneOf, UPSTREAMS_ERROR } from "../../shared/validate.ts";

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
  /** Lowercase names (and their subdomains) handled as Cloudflare-proxied whatever the upstream answers */
  echForcedDomains: string[];
  /** https:// URL that receives alert messages as JSON; empty turns alerts off */
  alertWebhookUrl: string;
  /** Percent of queries answered with SERVFAIL because every upstream failed; 0 turns this alert off */
  alertFailurePercent: number;
  /** Percent of queries blocked; 0 turns this alert off */
  alertBlockedPercent: number;
  /** Queries refused by the client limit in one check window; 0 turns this alert off */
  alertLimitedQueries: number;
}

const MAX_TTL = 86400;
const MIN_TIMEOUT_MS = 500;
const MAX_TIMEOUT_MS = 10_000;
const MAX_MIN_TTL = 3600;
const MAX_DEVICE_CLIENTS = 1000;
const MAX_CLIENT_WINDOW_MINUTES = 7 * 24 * 60;
const MAX_URL = 2048;

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

export function defaultSettings(env: Env): Settings {
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
    echForcedDomains: [],
    alertWebhookUrl: "",
    alertFailurePercent: 5,
    alertBlockedPercent: 0,
    alertLimitedQueries: 1,
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
        if (isUpstreamList(value)) valid[key] = value;
        else errors.push(UPSTREAMS_ERROR);
        break;
      case "alertWebhookUrl":
        if (value === "" || (typeof value === "string" && value.length <= MAX_URL && isHttpUrl(value, ["https:"]))) valid[key] = value;
        else errors.push("alertWebhookUrl must be an https:// URL or empty");
        break;
      case "alertFailurePercent":
      case "alertBlockedPercent":
        integer(key, value, 0, 100);
        break;
      case "alertLimitedQueries":
        integer(key, value, 0, 100_000);
        break;
      case "echForcedDomains":
        if (isListOf(value, MAX_ECH_FORCED_DOMAINS, (v) => v === v.toLowerCase() && isDomain(v))) valid[key] = value;
        else errors.push(`echForcedDomains must be at most ${MAX_ECH_FORCED_DOMAINS} distinct lowercase domain names`);
        break;
      default:
        errors.push(`unknown setting ${key}`);
    }
  }
  return { valid: valid as Partial<Settings>, errors };
}

function isListOf(value: unknown, max: number, item: (v: string) => boolean): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= max &&
    new Set(value).size === value.length &&
    value.every((v) => typeof v === "string" && item(v))
  );
}
