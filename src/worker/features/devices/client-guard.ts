import { encodeIPv6, isIPv4 } from "#dns";
import { DurableObject } from "cloudflare:workers";
import { toHex } from "../../shared/crypto.ts";

export interface ClientLimit {
  /** Distinct source networks allowed per device inside the window; 0 turns the guard off */
  maxClients: number;
  windowMs: number;
}

export interface SeenClient {
  client: string;
  lastSeen: number;
}

/** Admitted (device, network) pairs skip the Durable Object for a while; bounded by the window */
const ADMIT_CACHE_MS = 5 * 60_000;
const MAX_ADMIT_CACHE = 5000;
const admitted = new Map<string, number>();

/**
 * One Durable Object per device remembers which source networks used its DoH URL recently, so a
 * leaked URL stops working for strangers once the device's own networks fill the allowance
 */
export class DeviceClients extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS clients (client TEXT PRIMARY KEY, last_seen INTEGER NOT NULL)");
  }

  admit(client: string, limit: ClientLimit): boolean {
    const now = Date.now();
    const sql = this.ctx.storage.sql;
    sql.exec("DELETE FROM clients WHERE last_seen < ?", now - limit.windowMs);
    const known = sql.exec("SELECT 1 FROM clients WHERE client = ?", client).toArray().length > 0;
    if (!known && sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM clients").one().n >= limit.maxClients) return false;
    sql.exec("INSERT INTO clients (client, last_seen) VALUES (?, ?) ON CONFLICT (client) DO UPDATE SET last_seen = excluded.last_seen", client, now);
    return true;
  }

  list(windowMs: number): SeenClient[] {
    return this.ctx.storage.sql
      .exec<{ client: string; last_seen: number }>("SELECT client, last_seen FROM clients WHERE last_seen >= ? ORDER BY last_seen DESC", Date.now() - windowMs)
      .toArray()
      .map((r) => ({ client: r.client, lastSeen: r.last_seen }));
  }

  reset(): void {
    this.ctx.storage.sql.exec("DELETE FROM clients");
  }
}

/** Whether `ip` may use the device; never throws, a failing guard lets the query through */
export async function admitClient(env: Env, deviceId: string, ip: string | null, limit: ClientLimit): Promise<boolean> {
  if (limit.maxClients === 0 || !ip) return true;
  const client = clientNetwork(ip);
  const key = `${deviceId}|${client}`;
  const now = Date.now();
  if ((admitted.get(key) ?? 0) > now) return true;
  try {
    const ok = await env.DEVICE_CLIENTS.getByName(deviceId).admit(client, limit);
    if (ok) {
      if (admitted.size >= MAX_ADMIT_CACHE) admitted.clear();
      admitted.set(key, now + Math.min(ADMIT_CACHE_MS, limit.windowMs));
    }
    return ok;
  } catch (err) {
    console.error("device client guard failed", String(err));
    return true;
  }
}

export function seenClients(env: Env, deviceId: string, windowMs: number): Promise<SeenClient[]> {
  return env.DEVICE_CLIENTS.getByName(deviceId).list(windowMs);
}

export async function resetClients(env: Env, deviceId: string): Promise<void> {
  for (const key of admitted.keys()) if (key.startsWith(`${deviceId}|`)) admitted.delete(key);
  await env.DEVICE_CLIENTS.getByName(deviceId).reset();
}

/** IPv6 hosts rotate privacy addresses inside their /64, so that prefix counts as one client */
export function clientNetwork(ip: string): string {
  if (isIPv4(ip)) return ip;
  try {
    const hex = toHex(encodeIPv6(ip).subarray(0, 8));
    return `${hex.match(/.{4}/g)!.map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
  } catch {
    return ip;
  }
}
