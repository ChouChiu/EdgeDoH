/**
 * Devices, profiles, settings, split-DNS routes and local records mirrored from D1 into one small
 * KV value. Each D1 query costs a few ms of CPU, so the DoH path reads this instead; D1 stays the
 * source of truth for the API. Values are raw rows, validated by the feature that reads them
 */
// Versioned so a Worker reading the new shape never picks up a value written by an older one
const CONFIG_KEY = "config:v2";
const CHECK_INTERVAL_MS = 30_000;

export interface RuntimeDevice {
  name: string;
  /** Absent means the default profile */
  profile?: string;
  /** Filtering is skipped until this time, ms since epoch */
  pausedUntil?: number;
}

export interface RuntimeConfig {
  devices: Record<string, RuntimeDevice>;
  /** Raw rows of the settings table */
  settings: Record<string, unknown>;
  /** Profile ID to `{ name, ...config }` as stored */
  profiles: Record<string, Record<string, unknown>>;
  /** Route list ID to its upstream DoH URLs, enabled route lists only */
  routes: Record<string, string[]>;
  records: { name: string; type: string; value: string }[];
}

const EMPTY: RuntimeConfig = { devices: {}, settings: {}, profiles: {}, routes: {}, records: [] };

let state: { config: RuntimeConfig; checkedAt: number } | undefined;
let inflight: Promise<RuntimeConfig> | undefined;

export function getRuntimeConfig(env: Env): Promise<RuntimeConfig> {
  if (state && Date.now() - state.checkedAt < CHECK_INTERVAL_MS) return Promise.resolve(state.config);
  inflight ??= refresh(env).finally(() => {
    inflight = undefined;
  });
  return inflight;
}

type Row = Record<string, string | number | null>;

/** Rebuilds the KV copy from D1; call after every change to anything it mirrors */
export async function publishRuntimeConfig(env: Env): Promise<RuntimeConfig> {
  const [devices, settings, profiles, routes, records] = await env.DB.batch<Row>([
    env.DB.prepare("SELECT id, name, profile_id, paused_until FROM devices"),
    env.DB.prepare("SELECT key, value FROM settings"),
    env.DB.prepare("SELECT id, name, config FROM profiles"),
    env.DB.prepare("SELECT id, upstreams FROM filter_lists WHERE kind = 'route' AND enabled = 1"),
    env.DB.prepare("SELECT name, type, value FROM local_records"),
  ]);
  const now = Date.now();
  const config: RuntimeConfig = {
    devices: Object.fromEntries(
      devices!.results.map((r) => {
        const device: RuntimeDevice = { name: String(r.name) };
        if (r.profile_id) device.profile = String(r.profile_id);
        if (typeof r.paused_until === "number" && r.paused_until > now) device.pausedUntil = r.paused_until;
        return [String(r.id), device];
      }),
    ),
    settings: Object.fromEntries(settings!.results.map((r) => [String(r.key), JSON.parse(String(r.value)) as unknown])),
    profiles: Object.fromEntries(
      profiles!.results.map((r) => [String(r.id), { ...(JSON.parse(String(r.config)) as Record<string, unknown>), name: String(r.name) }]),
    ),
    routes: Object.fromEntries(routes!.results.map((r) => [String(r.id), JSON.parse(String(r.upstreams ?? "[]")) as string[]])),
    records: records!.results.map((r) => ({ name: String(r.name), type: String(r.type), value: String(r.value) })),
  };
  await env.RULES.put(CONFIG_KEY, JSON.stringify(config));
  state = { config, checkedAt: Date.now() };
  return config;
}

async function refresh(env: Env): Promise<RuntimeConfig> {
  const checkedAt = Date.now();
  try {
    const stored = await env.RULES.get<RuntimeConfig>(CONFIG_KEY, { type: "json", cacheTtl: 30 });
    // First run after deploying a new shape: seed the KV copy from D1
    const config = stored ?? (await publishRuntimeConfig(env));
    state = { config, checkedAt };
    return config;
  } catch (err) {
    console.error("failed to load runtime config", String(err));
    state = { config: state?.config ?? EMPTY, checkedAt };
    return state.config;
  }
}
