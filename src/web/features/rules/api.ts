import type { Verdict } from "#filter";
import { jsonBody, request } from "@/shared/lib/http";

export const CUSTOM_RULES_KEY = ["custom-rules"];

export const rulesApi = {
  get: () => request<string>("/custom-rules"),
  put: (text: string) => request<void>("/custom-rules", { method: "PUT", headers: { "content-type": "text/plain" }, body: text }),
  test: (name: string, type: string, deviceId?: string) =>
    request<{ name: string; type: string; verdict: Verdict }>("/rules/test", jsonBody("POST", { name, type, deviceId })),
};

/** Appends rules to the custom list, skipping lines it already has; returns how many were added */
export async function appendCustomRules(rules: string[]): Promise<number> {
  const text = await rulesApi.get();
  const existing = new Set(text.split(/\r?\n/).map((l) => l.trim()));
  const added = [...new Set(rules)].filter((rule) => !existing.has(rule));
  if (added.length > 0) await rulesApi.put(`${text.trimEnd()}${text.trim() ? "\n" : ""}${added.join("\n")}\n`);
  return added.length;
}
