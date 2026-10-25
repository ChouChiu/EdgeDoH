/** Metadata from the comment header filter lists start with, e.g. `! Title: …` (AdGuard) or `# Title: …` (hosts) */
export interface ListMeta {
  title?: string;
  description?: string;
  homepage?: string;
  license?: string;
  version?: string;
  lastModified?: string;
}

/** Enough for every header seen in HostlistsRegistry; the Worker only keeps this much of a download */
export const HEADER_BYTES = 16 * 1024;

const FIELDS: Record<string, keyof ListMeta> = {
  title: "title",
  description: "description",
  homepage: "homepage",
  license: "license",
  version: "version",
  "last modified": "lastModified",
  "last updated": "lastModified",
  timeupdated: "lastModified",
  date: "lastModified",
};

const MAX_LENGTH: Record<keyof ListMeta, number> = {
  title: 100,
  description: 500,
  homepage: 300,
  license: 300,
  version: 50,
  lastModified: 50,
};

const FIELD_RE = /^[!#]\s*([a-z][a-z ]*?)\s*:\s*(.+)$/i;
/** Cosmetic rules like `##.ad` and `#@#.ad` start with `#` too but are rules, so they end the header */
const COSMETIC_START_RE = /^#[@?$%]{0,2}#/;

/**
 * Reads header fields up to the first rule; `text` may be just the start of the list.
 * The first occurrence of a field wins, later comments are often per-section notes
 */
export function parseListHeader(text: string): ListMeta {
  const meta: ListMeta = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || /^\[adblock/i.test(line)) continue;
    if ((line[0] !== "!" && line[0] !== "#") || COSMETIC_START_RE.test(line)) break;
    const m = FIELD_RE.exec(line);
    const field = m?.[1]!.toLowerCase();
    // `! constructor: …` must not pick up Object.prototype members
    const key = field !== undefined && Object.hasOwn(FIELDS, field) ? FIELDS[field] : undefined;
    if (!key || meta[key] !== undefined) continue;
    const value = m![2]!.trim().slice(0, MAX_LENGTH[key]);
    if (value) meta[key] = value;
  }
  return meta;
}

/** Decodes the first bytes of a list, dropping a line the byte limit may have cut in half */
export function decodeListHead(head: Uint8Array, complete: boolean): string {
  const text = new TextDecoder().decode(head);
  return complete ? text : text.slice(0, text.lastIndexOf("\n") + 1);
}
