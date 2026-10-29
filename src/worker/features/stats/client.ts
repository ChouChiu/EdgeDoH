/**
 * DoH requests carry no information about the app behind a lookup: system resolvers send every
 * app's queries alike. What the User-Agent does tell apart is the DoH client itself, e.g. a browser
 * with its own secure DNS versus the operating system
 */
const KNOWN: [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, "Edge"],
  [/\bOPR\//, "Opera"],
  [/\bFirefox\//, "Firefox"],
  [/\bChrom(?:e|ium)\//, "Chrome"],
  [/\bVersion\/[\d.]+.*\bSafari\//, "Safari"],
  // CFNetwork and Darwin only appear in Apple's networking stack
  [/\b(?:CFNetwork|Darwin)\//, "Apple"],
];

const MAX_LABEL = 40;

/** A short client label; unknown agents fall back to their first product token without version */
export function clientLabel(userAgent: string | null): string {
  if (!userAgent) return "";
  for (const [re, label] of KNOWN) if (re.test(userAgent)) return label;
  const token = userAgent.trim().split(/[\s/]/, 1)[0] ?? "";
  return token.slice(0, MAX_LABEL);
}
