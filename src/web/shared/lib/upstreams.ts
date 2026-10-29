import type { Translate } from "@/shared/i18n/messages";
import { isHttpUrl } from "./http";

/** Same limit the Worker enforces for global, profile and route-list upstreams */
export const MAX_UPSTREAMS = 5;

/** Upstreams are edited one per line (any whitespace separates them) */
export function splitUpstreams(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/** Error text for an upstream list, or undefined when it is valid; `optional` allows an empty list */
export function validateUpstreams(upstreams: string[], t: Translate, optional = false): string | undefined {
  if (optional && upstreams.length === 0) return undefined;
  if (upstreams.length === 0 || upstreams.length > MAX_UPSTREAMS) return t("settings.upstreamCount");
  const invalid = upstreams.find((u) => !isHttpUrl(u, ["https:"]));
  return invalid === undefined ? undefined : t("settings.invalidUpstream", { url: invalid });
}
