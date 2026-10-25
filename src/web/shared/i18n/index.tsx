import { createContext, Fragment, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createFormatters, type Formatters } from "@/shared/lib/format";
import { enUS } from "./locales/en-US";
import { zhHans } from "./locales/zh-Hans";
import { zhHant } from "./locales/zh-Hant";
import type { MessageKey, Messages, Params, Translate } from "./messages";

export type { MessageKey, Translate } from "./messages";

export const LOCALES = ["zh-Hans", "zh-Hant", "en-US"] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_NAMES: Record<Locale, string> = { "zh-Hans": "简体中文", "zh-Hant": "繁體中文", "en-US": "English" };

const CATALOGS: Record<Locale, Messages> = { "zh-Hans": zhHans, "zh-Hant": zhHant, "en-US": enUS };
const STORAGE_KEY = "locale";

interface I18n {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
  /** Like `t`, but placeholders may be React nodes */
  rich: (key: MessageKey, params: Record<string, ReactNode>) => ReactNode;
  fmt: Formatters;
}

const I18nContext = createContext<I18n | null>(null);

/** Saved choice first, then the browser languages; Traditional Chinese regions map to zh-Hant */
export function detectLocale(): Locale {
  const saved = readSaved();
  if (saved) return saved;
  for (const tag of navigator.languages) {
    const lower = tag.toLowerCase();
    if (lower.startsWith("zh")) return /hant|-tw|-hk|-mo/.test(lower) ? "zh-Hant" : "zh-Hans";
    if (lower.startsWith("en")) return "en-US";
  }
  return "en-US";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage can be unavailable (private mode); the choice then lasts for this tab only
    }
    setLocaleState(next);
  }, []);

  const value = useMemo<I18n>(() => {
    const catalog = CATALOGS[locale];
    const plural = new Intl.PluralRules(locale);
    const number = new Intl.NumberFormat(locale);
    const pick = (key: MessageKey, params?: Params | Record<string, ReactNode>) => {
      const message = catalog[key];
      if (typeof message === "string") return message;
      return plural.select(Number(params?.count)) === "one" ? message.one : message.other;
    };
    const t: Translate = (key, params) =>
      pick(key, params).replace(/\{(\w+)\}/g, (match, name: string) => {
        const v = params?.[name];
        return v === undefined ? match : typeof v === "number" ? number.format(v) : v;
      });
    const rich = (key: MessageKey, params: Record<string, ReactNode>) =>
      pick(key, params)
        .split(/(\{\w+\})/)
        .map((part, i) => <Fragment key={i}>{/^\{\w+\}$/.test(part) ? (params[part.slice(1, -1)] ?? part) : part}</Fragment>);
    return { locale, setLocale, t, rich, fmt: createFormatters(locale, t) };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used within I18nProvider");
  return value;
}

function readSaved(): Locale | undefined {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return LOCALES.find((l) => l === saved);
  } catch {
    return undefined;
  }
}
