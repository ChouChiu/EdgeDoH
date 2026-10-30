import type { DeviceRuleAction } from "#contract";

export interface DeviceRule {
  deviceId: string;
  /** Lowercase domain; subdomains are covered too */
  name: string;
  action: DeviceRuleAction;
}

/**
 * Adblock text for per-device overrides. `$important` lets them beat the profile's lists in both
 * directions: an allow wins over important blocks, a block over plain allowlist rules
 */
export function deviceRulesText(rules: DeviceRule[]): string {
  return rules.map((r) => `${r.action === "allow" ? "@@" : ""}||${r.name}^$client=${r.deviceId},important`).join("\n");
}
