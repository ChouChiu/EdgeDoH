import { getRuntimeConfig } from "../../shared/runtime-config.ts";

export interface Device {
  id: string;
  name: string;
  createdAt: number;
}

interface DeviceRow {
  id: string;
  name: string;
  created_at: number;
}

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const ID_LENGTH = 10;
const ID_PATTERN = new RegExp(`^[a-z0-9]{${ID_LENGTH}}$`);

/** Isolate-level cache for devices missing from the KV config, e.g. created moments ago elsewhere */
const lookupCache = new Map<string, { device: Device | null; expires: number }>();
const HIT_TTL_MS = 60_000;
const MISS_TTL_MS = 30_000;
const MAX_CACHE_ENTRIES = 1000;

export function isDeviceId(value: string): boolean {
  return ID_PATTERN.test(value);
}

export function newDeviceId(): string {
  // 36^10 ≈ 2^51; rejection sampling keeps the distribution uniform
  const out: string[] = [];
  while (out.length < ID_LENGTH) {
    for (const b of crypto.getRandomValues(new Uint8Array(ID_LENGTH))) {
      if (b < 252 && out.length < ID_LENGTH) out.push(ID_ALPHABET[b % 36]!);
    }
  }
  return out.join("");
}

/** Looks the device up in the KV runtime config first and falls back to D1 */
export async function findDevice(env: Env, id: string): Promise<Device | null> {
  if (!isDeviceId(id)) return null;
  const name = (await getRuntimeConfig(env)).devices[id];
  if (name !== undefined) return { id, name, createdAt: 0 };

  const now = Date.now();
  const cached = lookupCache.get(id);
  if (cached && cached.expires > now) return cached.device;

  const row = await env.DB.prepare("SELECT id, name, created_at FROM devices WHERE id = ?").bind(id).first<DeviceRow>();
  const device = row ? fromRow(row) : null;
  if (lookupCache.size >= MAX_CACHE_ENTRIES) lookupCache.clear();
  lookupCache.set(id, { device, expires: now + (device ? HIT_TTL_MS : MISS_TTL_MS) });
  return device;
}

export async function listDevices(db: D1Database): Promise<Device[]> {
  const { results } = await db.prepare("SELECT id, name, created_at FROM devices ORDER BY created_at").all<DeviceRow>();
  return results.map(fromRow);
}

export async function createDevice(db: D1Database, name: string): Promise<Device> {
  const device: Device = { id: newDeviceId(), name, createdAt: Date.now() };
  await db
    .prepare("INSERT INTO devices (id, name, created_at) VALUES (?, ?, ?)")
    .bind(device.id, device.name, device.createdAt)
    .run();
  lookupCache.delete(device.id);
  return device;
}

export async function renameDevice(db: D1Database, id: string, name: string): Promise<Device | null> {
  const row = await db
    .prepare("UPDATE devices SET name = ? WHERE id = ? RETURNING id, name, created_at")
    .bind(name, id)
    .first<DeviceRow>();
  lookupCache.delete(id);
  return row ? fromRow(row) : null;
}

export async function deleteDevice(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM devices WHERE id = ?").bind(id).run();
  lookupCache.delete(id);
  return result.meta.changes > 0;
}

function fromRow(row: DeviceRow): Device {
  return { id: row.id, name: row.name, createdAt: row.created_at };
}
