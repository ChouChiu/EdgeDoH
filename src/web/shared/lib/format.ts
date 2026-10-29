import type { Translate } from "@/shared/i18n/messages";

export type Formatters = ReturnType<typeof createFormatters>;

/** Number, size and time formatting bound to one locale */
export function createFormatters(locale: string, t: Translate) {
  const numberFormat = new Intl.NumberFormat(locale);
  const percentFormat = (digits: number) => new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: digits });
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  return {
    number: (n: number) => numberFormat.format(n),

    percent: (ratio: number) => percentFormat(ratio > 0 && ratio < 0.1 ? 1 : 0).format(ratio),

    bytes: (bytes: number) => {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    },

    relative: (time: number | string | null | undefined) => {
      if (time === null || time === undefined) return t("time.never");
      const ms = typeof time === "number" ? time : Date.parse(time);
      const diff = (ms - Date.now()) / 1000;
      const abs = Math.abs(diff);
      if (abs < 60) return t("time.justNow");
      if (abs < 3600) return relative.format(Math.round(diff / 60), "minute");
      if (abs < 86400) return relative.format(Math.round(diff / 3600), "hour");
      if (abs < 86400 * 30) return relative.format(Math.round(diff / 86400), "day");
      return new Date(ms).toLocaleDateString(locale);
    },

    /** Clock time, with the date only when it is not today */
    time: (ms: number) => {
      const d = new Date(ms);
      const today = d.toDateString() === new Date().toDateString();
      return today
        ? d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
        : d.toLocaleString(locale, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
    },

    dateTime: (iso: string) =>
      new Date(iso).toLocaleString(locale, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }),

    /** Chart axis and tooltip labels: times for short ranges, dates (and hours) for long ones */
    bucket: (iso: string, short: boolean, full = false) => {
      const d = new Date(iso);
      if (full) return d.toLocaleString(locale, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
      if (short) return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
      return d.toLocaleDateString(locale, { month: "numeric", day: "numeric" });
    },
  };
}
