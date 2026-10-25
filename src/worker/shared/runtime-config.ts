/**
 * Devices and settings mirrored from D1 into one small KV value. Each D1 query costs a few ms
 * of CPU, so the DoH path reads this instead; D1 stays the source of truth for the API
 */
const CONFIG_KEY = "config";
const CHECK_INTERVAL_MS = 30_000;

export interface RuntimeConfig {
  /** Device ID to name */
  devices: Record<string, string>;
  /** Raw rows of the settings table, validated by the reader */
  settings: Record<string, unknown>;
}

const EMPTY: RuntimeConfig = { devices: {}, settings: {} };

let state: { config: RuntimeConfig; checkedAt: number } | undefined;
let inflight: Promise<RuntimeConfig> | undefined;

export function getRuntimeConfig(env: Env): Promise<RuntimeConfig> {
  if (state && Date.now() - state.checkedAt < CHECK_INTERVAL_MS) return Promise.resolve(state.config);
  inflight ??= refresh(env).finally(() => {
    inflight = undefined;
  });
  return inflight;
}

/** Rebuilds the KV copy from D1; call after every device or settings change */
export async function publishRuntimeConfig(env: Env): Promise<RuntimeConfig> {
  const [devices, settings] = await env.DB.batch<{ id?: string; name?: string; key?: string; value?: string }>([
    env.DB.prepare("SELECT id, name FROM devices"),
    env.DB.prepare("SELECT key, value FROM settings"),
  ]);
  const config: RuntimeConfig = {
    devices: Object.fromEntries(devices!.results.map((r) => [r.id!, r.name!])),
    settings: Object.fromEntries(settings!.results.map((r) => [r.key!, JSON.parse(r.value!) as unknown])),
  };
  await env.RULES.put(CONFIG_KEY, JSON.stringify(config));
  state = { config, checkedAt: Date.now() };
  return config;
}

async function refresh(env: Env): Promise<RuntimeConfig> {
  const checkedAt = Date.now();
  try {
    const stored = await env.RULES.get<RuntimeConfig>(CONFIG_KEY, { type: "json", cacheTtl: 30 });
    // First run after deploying this feature: seed the KV copy from D1
    const config = stored ?? (await publishRuntimeConfig(env));
    state = { config, checkedAt };
    return config;
  } catch (err) {
    console.error("failed to load runtime config", String(err));
    state = { config: state?.config ?? EMPTY, checkedAt };
    return state.config;
  }
}
