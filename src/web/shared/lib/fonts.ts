import type { Locale } from "@/shared/i18n";

/**
 * The CJK serifs are hundreds of unicode-range faces; their CSS alone is ~40 kB gzip per script, so each locale pulls
 * in only its own on demand instead of every visitor paying for both in the render-blocking stylesheet. English pages
 * show no CJK headings and load neither. Until a sheet arrives, headings use the browser's serif and then swap
 */
const CJK_SERIF: Partial<Record<Locale, () => Promise<unknown>>> = {
  "zh-Hans": () => import("@fontsource-variable/noto-serif-sc"),
  "zh-Hant": () => import("@fontsource-variable/noto-serif-tc"),
};

export function loadSerifFor(locale: Locale) {
  // A failed chunk only costs the web font; headings keep the fallback serif
  void CJK_SERIF[locale]?.().catch(() => {});
}
