import { useMemo } from "react";
import { Row } from "@/shared/components/form-section";
import { Input } from "@/shared/ui/input";
import { useI18n } from "@/shared/i18n";
import { cn } from "@/shared/lib/utils";
import type { Schedule } from "./api";

/** Monday first, as most of the dashboard's locales count weeks */
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function ScheduleEditor({ value, onChange }: { value: Schedule; onChange: (next: Schedule) => void }) {
  const { t, locale } = useI18n();
  const dayNames = useMemo(() => {
    // 2026-11-01 is a Sunday; day d is d days later
    const format = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
    return Array.from({ length: 7 }, (_, d) => format.format(Date.UTC(2026, 10, 1 + d)));
  }, [locale]);
  const zones = useMemo(() => Intl.supportedValuesOf("timeZone"), []);
  const days = new Set(value.days);
  const toggle = (d: number) => onChange({ ...value, days: days.has(d) ? value.days.filter((x) => x !== d) : [...value.days, d].sort() });

  return (
    <>
      <Row label={t("profiles.scheduleDays")} htmlFor="schedule-days">
        <div id="schedule-days" className="flex flex-wrap gap-1">
          {DAY_ORDER.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={days.has(d)}
              onClick={() => toggle(d)}
              className={cn("h-8 min-w-10 rounded-md border px-2 text-xs transition-colors", days.has(d) ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent")}
            >
              {dayNames[d]}
            </button>
          ))}
        </div>
      </Row>
      <Row label={t("profiles.scheduleTime")} hint={value.end <= value.start ? t("profiles.scheduleOvernight") : undefined} htmlFor="schedule-start">
        <div className="flex items-center gap-2">
          <Input id="schedule-start" type="time" className="w-28" value={toTime(value.start)} onChange={(e) => onChange({ ...value, start: fromTime(e.target.value) })} />
          <span className="text-muted-foreground">–</span>
          <Input
            aria-label={t("profiles.scheduleEnd")}
            type="time"
            className="w-28"
            value={toTime(value.end)}
            onChange={(e) => onChange({ ...value, end: fromTime(e.target.value) })}
          />
        </div>
      </Row>
      <Row label={t("profiles.timezone")} htmlFor="schedule-zone">
        <Input id="schedule-zone" list="schedule-zones" className="w-56" value={value.timezone} onChange={(e) => onChange({ ...value, timezone: e.target.value })} />
        <datalist id="schedule-zones">
          {zones.map((z) => (
            <option key={z} value={z} />
          ))}
        </datalist>
      </Row>
    </>
  );
}

function toTime(minutes: number): string {
  const m = minutes % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function fromTime(text: string): number {
  const [h = 0, m = 0] = text.split(":").map(Number);
  return h * 60 + m;
}
