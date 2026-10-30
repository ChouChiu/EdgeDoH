import { RRType } from "#dns";
import { type Inspection, inspect, type Verdict } from "#filter";
import type { RuntimeConfig } from "../../shared/runtime-config.ts";
import type { Device } from "../devices/store.ts";
import { activeLists, type Profile, scheduleActive } from "../profiles/store.ts";
import { localVerdict } from "../records/store.ts";
import { ensureShards, getSnapshot } from "../rules/store.ts";
import type { Settings } from "../settings/store.ts";
import { safeSearchVerdict } from "./safe-search.ts";

export interface DecideInput {
  device: Pick<Device, "id" | "name" | "pausedUntil">;
  profile: Profile;
  settings: Settings;
  records: RuntimeConfig["records"];
  /** Lowercase, without trailing dot */
  name: string;
  type: number;
  ip: string | null;
  now: number;
}

export interface Decision {
  verdict: Verdict;
  /** What the snapshot recognised the name as; absent when it was not consulted */
  inspection?: Inspection;
  /** AAAA query while IPv6 resolution is disabled: answer with an empty NOERROR */
  ipv6Off?: true;
}

/**
 * How a query is answered, shared by the DoH endpoint and the rule tester so they cannot drift:
 * local records, then the disabled-IPv6 shortcut, then the profile's lists and services, then safe search
 */
export async function decide(env: Env, input: DecideInput): Promise<Decision> {
  const { device, profile, settings, name, type, now } = input;
  const filtering = filteringActive(settings, profile, device, now);
  const local = localVerdict(input.records, name, type);
  if (!local && settings.disableIpv6 && type === RRType.AAAA) return { verdict: { action: "pass" }, ipv6Off: true };

  const inspection = await evaluate(env, input, filtering);
  let verdict = local ?? (filtering ? inspection.verdict : { action: "pass" });
  if (verdict.action === "pass" && filtering) verdict = safeSearchVerdict(name, profile) ?? verdict;
  return { verdict, inspection };
}

/** The global switch, the profile and the device's pause all let filtering apply */
export function filteringActive(settings: Settings, profile: Profile, device: Pick<Device, "pausedUntil">, now: number): boolean {
  return settings.filteringEnabled && profile.filtering && !(device.pausedUntil !== null && device.pausedUntil > now);
}

/**
 * Runs the snapshot even when filtering is off for this query: the same lookup tells which
 * service the name belongs to and which split-DNS route covers it
 */
async function evaluate(env: Env, input: DecideInput, filtering: boolean): Promise<Inspection> {
  const loaded = await getSnapshot(env.RULES);
  if (!loaded) return { verdict: { action: "pass" } };
  const { device, profile, name, type, ip, now } = input;
  await ensureShards(env.RULES, loaded, name);
  const scheduled = filtering && profile.schedule !== null && profile.scheduledServices.length > 0 && scheduleActive(profile.schedule, now);
  return inspect(loaded.snapshot, {
    name,
    type,
    client: { id: device.id, name: device.name, ...(ip && { ip }) },
    active: filtering ? activeLists(loaded.snapshot, profile, scheduled) : NOTHING,
  });
}

const NOTHING = new Uint8Array(0);
