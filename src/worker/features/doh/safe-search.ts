import { Rcode, RRType } from "#dns";
import type { Verdict } from "#filter";

/** Matched-list ID shown in logs for safe search rewrites */
const SAFE_SEARCH_LIST_ID = "safesearch";

/** Google's country domains: google.de, google.co.uk, google.com.hk … with or without www. */
const GOOGLE_RE = /^(?:www\.)?google\.(?:com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/;

const SEARCH: Record<string, string> = {
  "bing.com": "strict.bing.com",
  "www.bing.com": "strict.bing.com",
  "duckduckgo.com": "safe.duckduckgo.com",
  "www.duckduckgo.com": "safe.duckduckgo.com",
  "start.duckduckgo.com": "safe.duckduckgo.com",
};

/** Google's documented hostnames for YouTube Restricted Mode */
const YOUTUBE: Record<string, string> = {
  "www.youtube.com": "restrict.youtube.com",
  "m.youtube.com": "restrict.youtube.com",
  "youtubei.googleapis.com": "restrict.youtube.com",
  "youtube.googleapis.com": "restrict.youtube.com",
  "www.youtube-nocookie.com": "restrict.youtube.com",
};

/**
 * CNAME rewrite enforcing safe search, the way the search engines document for networks:
 * the name is pointed at the engine's filtered front end
 */
export function safeSearchVerdict(name: string, opts: { safeSearch: boolean; youtubeRestricted: boolean }): Verdict | undefined {
  let target: string | undefined;
  if (opts.safeSearch) target = GOOGLE_RE.test(name) ? "forcesafesearch.google.com" : SEARCH[name];
  if (!target && opts.youtubeRestricted) target = YOUTUBE[name];
  if (!target) return undefined;
  return {
    action: "rewrite",
    rule: { text: `${name} CNAME ${target}`, listId: SAFE_SEARCH_LIST_ID, line: 0 },
    rcode: Rcode.NOERROR,
    records: [{ type: RRType.CNAME, value: target }],
  };
}
