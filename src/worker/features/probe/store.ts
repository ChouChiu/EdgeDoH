import { DurableObject } from "cloudflare:workers";

/** A probe name is `<nonce>.edgedoh-probe.<dashboard host>`; the nonce is 32 lowercase hex digits */
const PROBE_LABEL = ".edgedoh-probe.";
const NONCE = /^[0-9a-f]{32}$/;
/** Hits only need to outlive the dashboard's follow-up request */
const PROBE_TTL_MS = 5 * 60_000;
/** All probes share one instance: they are rare, and a lookup must find the hit whichever colo wrote it */
const INSTANCE = "probes";

export interface ProbeHit {
  deviceId: string;
  deviceName: string;
  seenAt: number;
}

/** Remembers which device's DoH URL resolved each probe name, so the dashboard can tell which device it runs on */
export class ProbeResults extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS probes (nonce TEXT PRIMARY KEY, device_id TEXT NOT NULL, device_name TEXT NOT NULL, seen_at INTEGER NOT NULL)");
  }

  record(nonce: string, deviceId: string, deviceName: string): void {
    const now = Date.now();
    const sql = this.ctx.storage.sql;
    sql.exec("DELETE FROM probes WHERE seen_at < ?", now - PROBE_TTL_MS);
    sql.exec("INSERT OR REPLACE INTO probes (nonce, device_id, device_name, seen_at) VALUES (?, ?, ?, ?)", nonce, deviceId, deviceName, now);
  }

  find(nonce: string): ProbeHit | null {
    const row = this.ctx.storage.sql
      .exec<{ device_id: string; device_name: string; seen_at: number }>("SELECT device_id, device_name, seen_at FROM probes WHERE nonce = ? AND seen_at >= ?", nonce, Date.now() - PROBE_TTL_MS)
      .toArray()[0];
    return row ? { deviceId: row.device_id, deviceName: row.device_name, seenAt: row.seen_at } : null;
  }
}

export function isNonce(value: string): boolean {
  return NONCE.test(value);
}

/** The nonce of a probe name, else undefined. Runs on every DoH query, so it compares one fixed position first */
export function probeNonce(name: string): string | undefined {
  if (!name.startsWith(PROBE_LABEL, 32)) return undefined;
  const nonce = name.slice(0, 32);
  return isNonce(nonce) ? nonce : undefined;
}

/** Never throws: a failed write only makes the dashboard report this device as not using the resolver */
export async function recordProbe(env: Env, nonce: string, device: { id: string; name: string }): Promise<void> {
  try {
    await env.PROBES.getByName(INSTANCE).record(nonce, device.id, device.name);
  } catch (err) {
    console.error("probe record failed", String(err));
  }
}

export function findProbe(env: Env, nonce: string): Promise<ProbeHit | null> {
  return env.PROBES.getByName(INSTANCE).find(nonce);
}
