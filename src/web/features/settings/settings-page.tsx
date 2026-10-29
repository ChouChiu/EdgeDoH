import { useShouldReduceMotion } from "@animate-ui/react/utils/motion";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { LoaderCircle } from "@/shared/components/animate-ui/icons/loader-circle";
import { RotateCcw } from "@/shared/components/animate-ui/icons/rotate-ccw";
import { Save } from "@/shared/components/animate-ui/icons/save";
import { Row, Section } from "@/shared/components/form-section";
import { PageHeader, QueryError } from "@/shared/components/page";
import { ThemeSwitch } from "@/shared/components/header-controls";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Skeleton } from "@/shared/ui/skeleton";
import { Switch } from "@/shared/ui/switch";
import { Textarea } from "@/shared/ui/textarea";
import { type Locale, LOCALE_NAMES, LOCALES, useI18n } from "@/shared/i18n";
import { errorMessage } from "@/shared/lib/http";
import { splitUpstreams, validateUpstreams } from "@/shared/lib/upstreams";
import { isDomain } from "#filter";
import { MAX_ECH_FORCED_DOMAINS } from "#contract";
import {
  BLOCKING_MODES,
  type BlockingMode,
  type Settings,
  SETTINGS_KEY,
  settingsApi,
  UPSTREAM_MODES,
  type UpstreamMode,
  useSettings,
} from "./api";

type NumberField = "blockedTtl" | "upstreamTimeoutMs" | "cacheMinTtl" | "cacheMaxTtl" | "maxDeviceClients" | "deviceClientWindowMinutes";
const NUMBER_FIELDS: NumberField[] = ["blockedTtl", "upstreamTimeoutMs", "cacheMinTtl", "cacheMaxTtl", "maxDeviceClients", "deviceClientWindowMinutes"];

type ListField = "upstreams" | "echForcedDomains";

/** Form state: numbers stay strings while typing, lists are one entry per line */
type Draft = Omit<Settings, NumberField | ListField> & Record<NumberField, string> & Record<ListField, string>;

/** Page order; the index beside the form lists the same sections */
const SECTIONS = ["filtering", "upstream", "cache", "abuse", "ech", "queryLog", "appearance"] as const;
type SectionKey = (typeof SECTIONS)[number];
const sectionId = (key: SectionKey) => `settings-${key}`;

export function SettingsPage() {
  const { t } = useI18n();
  return (
    <div className="mx-auto w-full max-w-3xl lg:grid lg:max-w-5xl lg:grid-cols-[10rem_minmax(0,1fr)] lg:items-start lg:gap-8">
      <SectionIndex />
      <div className="min-w-0 space-y-4">
        <PageHeader title={t("nav.settings")} />
        {/* Server behaviour is what this page is for; the browser-only preferences repeat the header toggles, so they go last */}
        <ServerSettings />
        <AppearanceCard />
      </div>
    </div>
  );
}

/**
 * Wide screens keep every section one click away while the form scrolls; the entry for the section at the top of the
 * view is marked. Phones scroll the single column instead
 */
function SectionIndex() {
  const { t } = useI18n();
  const ready = useSettings().isSuccess;
  const reduce = useShouldReduceMotion();
  const [active, setActive] = useState<SectionKey>(SECTIONS[0]);

  useEffect(() => {
    if (!ready) return;
    const visible = new Map<Element, boolean>();
    // A section counts as current while it crosses the band just under the sticky header
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) visible.set(entry.target, entry.isIntersecting);
        const first = SECTIONS.find((key) => [...visible].some(([el, on]) => on && el.id === sectionId(key)));
        if (first) setActive(first);
      },
      { rootMargin: "-64px 0px -55% 0px" },
    );
    for (const key of SECTIONS) {
      const el = document.getElementById(sectionId(key));
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [ready]);

  const jump = (key: SectionKey) => {
    setActive(key);
    document.getElementById(sectionId(key))?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };

  return (
    <nav aria-label={t("settings.sections")} className="sticky top-[calc(4rem+env(safe-area-inset-top))] hidden pt-1 lg:block">
      <ul className="space-y-0.5">
        {SECTIONS.map((key) => (
          <li key={key}>
            <button
              type="button"
              aria-current={key === active ? "true" : undefined}
              onClick={() => jump(key)}
              className={cn(
                "w-full rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
                key === active && "bg-accent font-medium text-accent-foreground",
              )}
            >
              {t(`settings.${key}`)}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Browser-only preferences, the same ones as the header toggles */
function AppearanceCard() {
  const { t, locale, setLocale } = useI18n();
  return (
    <Section id={sectionId("appearance")} title={t("settings.appearance")} description={t("settings.appearanceDescription")}>
      <Row label={t("settings.theme")} htmlFor="theme" inline>
        <ThemeSwitch />
      </Row>
      <Row label={t("settings.language")} htmlFor="language">
        <Select value={locale} onValueChange={(v) => setLocale(v as Locale)}>
          <SelectTrigger id="language" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LOCALES.map((option) => (
              <SelectItem key={option} value={option} lang={option}>
                {LOCALE_NAMES[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
    </Section>
  );
}

function ServerSettings() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const settings = useSettings();
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    if (settings.data) setDraft(toDraft(settings.data));
  }, [settings.data]);

  const save = useMutation({
    mutationFn: (next: Settings) => settingsApi.patch(next),
    onSuccess: (data) => {
      queryClient.setQueryData(SETTINGS_KEY, data);
      toast.success(t("settings.saved"), { description: t("settings.savedDetail") });
    },
    onError: (err) => toast.error(t("common.saveFailed"), { description: errorMessage(err, t) }),
  });

  if (settings.error) return <QueryError error={settings.error} />;
  if (!draft || !settings.data) return <Skeleton className="h-96 w-full" />;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft({ ...draft, [key]: value });
  const upstreams = splitUpstreams(draft.upstreams);
  const forcedDomains = splitList(draft.echForcedDomains, (d) => d.toLowerCase().replace(/\.$/, ""));
  const errors = {
    upstreams: validateUpstreams(upstreams, t),
    echForcedDomains:
      forcedDomains.length > MAX_ECH_FORCED_DOMAINS
        ? t("settings.echTooMany", { max: MAX_ECH_FORCED_DOMAINS })
        : invalidEntry(forcedDomains, isDomain, (value) => t("settings.echInvalidDomain", { value })),
    customIp: draft.blockingMode === "custom_ip" && !draft.blockingIpv4.trim() && !draft.blockingIpv6.trim() ? t("settings.customIpRequired") : undefined,
    cacheRange: Number(draft.cacheMinTtl) > Number(draft.cacheMaxTtl) ? t("settings.cacheRange") : undefined,
  };
  const invalid = Object.values(errors).some(Boolean);
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(settings.data));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!invalid) save.mutate(fromDraft(draft, { upstreams, echForcedDomains: forcedDomains }));
  };

  const number = (key: NumberField, min: number, max: number, className = "w-32") => (
    <Input
      id={key}
      type="number"
      inputMode="numeric"
      enterKeyHint="done"
      min={min}
      max={max}
      step={1}
      required
      className={className}
      value={draft[key]}
      onChange={(e) => set(key, e.target.value)}
    />
  );

  return (
    <form onSubmit={submit} className="space-y-4">
      <Section id={sectionId("filtering")} title={t("settings.filtering")} description={t("settings.filteringDescription")}>
        <Row label={t("settings.filteringEnabled")} hint={t("settings.filteringEnabledHint")} htmlFor="filteringEnabled" inline>
          <Switch id="filteringEnabled" checked={draft.filteringEnabled} onCheckedChange={(v) => set("filteringEnabled", v)} />
        </Row>
        <Row label={t("settings.blockingMode")} hint={t(`settings.mode.${draft.blockingMode}.hint`)} htmlFor="blockingMode">
          <Select value={draft.blockingMode} onValueChange={(v) => set("blockingMode", v as BlockingMode)}>
            <SelectTrigger id="blockingMode" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BLOCKING_MODES.map((m) => (
                <SelectItem key={m} value={m}>
                  {t(`settings.mode.${m}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        {draft.blockingMode === "custom_ip" && (
          <div className="grid gap-3 py-3 sm:grid-cols-2">
            <AddressField id="blockingIpv4" label={t("settings.blockingIpv4")} placeholder="192.0.2.1" value={draft.blockingIpv4} onChange={(v) => set("blockingIpv4", v)} invalid={!!errors.customIp} />
            <AddressField id="blockingIpv6" label={t("settings.blockingIpv6")} placeholder="2001:db8::1" value={draft.blockingIpv6} onChange={(v) => set("blockingIpv6", v)} invalid={!!errors.customIp} />
            {errors.customIp && <p className="text-xs text-destructive sm:col-span-2">{errors.customIp}</p>}
          </div>
        )}
        <Row label={t("settings.ttl")} htmlFor="blockedTtl">
          {number("blockedTtl", 0, 86400)}
        </Row>
        <Row label={t("settings.disableIpv6")} hint={t("settings.disableIpv6Hint")} htmlFor="disableIpv6" inline>
          <Switch id="disableIpv6" checked={draft.disableIpv6} onCheckedChange={(v) => set("disableIpv6", v)} />
        </Row>
      </Section>

      <Section id={sectionId("upstream")} title={t("settings.upstream")} description={t("settings.upstreamDescription")}>
        <div className="grid gap-2 py-3">
          <Label htmlFor="upstreams">{t("settings.upstreams")}</Label>
          <Textarea
            id="upstreams"
            required
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            inputMode="url"
            aria-invalid={errors.upstreams !== undefined}
            aria-describedby="upstreams-hint"
            className="font-mono text-sm"
            value={draft.upstreams}
            onChange={(e) => set("upstreams", e.target.value)}
          />
          <p id="upstreams-hint" className={errors.upstreams ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
            {errors.upstreams ?? t("settings.upstreamsHint")}
          </p>
        </div>
        <Row label={t("settings.upstreamMode")} hint={t(`settings.upstreamMode.${draft.upstreamMode}.hint`)} htmlFor="upstreamMode">
          <Select value={draft.upstreamMode} onValueChange={(v) => set("upstreamMode", v as UpstreamMode)}>
            <SelectTrigger id="upstreamMode" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {UPSTREAM_MODES.map((m) => (
                <SelectItem key={m} value={m}>
                  {t(`settings.upstreamMode.${m}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row label={t("settings.upstreamTimeout")} htmlFor="upstreamTimeoutMs">
          {number("upstreamTimeoutMs", 500, 10000)}
        </Row>
      </Section>

      <Section id={sectionId("cache")} title={t("settings.cache")} description={t("settings.cacheDescription")}>
        <Row label={t("settings.cacheEnabled")} htmlFor="cacheEnabled" inline>
          <Switch id="cacheEnabled" checked={draft.cacheEnabled} onCheckedChange={(v) => set("cacheEnabled", v)} />
        </Row>
        <fieldset disabled={!draft.cacheEnabled} className="divide-y disabled:opacity-60">
          <Row label={t("settings.cacheMinTtl")} hint={errors.cacheRange ?? t("settings.cacheMinTtlHint")} hintError={!!errors.cacheRange} htmlFor="cacheMinTtl">
            {number("cacheMinTtl", 0, 3600)}
          </Row>
          <Row label={t("settings.cacheMaxTtl")} hint={t("settings.cacheMaxTtlHint")} htmlFor="cacheMaxTtl">
            {number("cacheMaxTtl", 1, 86400)}
          </Row>
        </fieldset>
      </Section>

      <Section id={sectionId("abuse")} title={t("settings.abuse")} description={t("settings.abuseDescription")}>
        <Row label={t("settings.maxDeviceClients")} hint={t("settings.maxDeviceClientsHint")} htmlFor="maxDeviceClients">
          {number("maxDeviceClients", 0, 1000)}
        </Row>
        <fieldset disabled={draft.maxDeviceClients === "0"} className="disabled:opacity-60">
          <Row label={t("settings.deviceClientWindow")} hint={t("settings.deviceClientWindowHint")} htmlFor="deviceClientWindowMinutes">
            {number("deviceClientWindowMinutes", 5, 10080)}
          </Row>
        </fieldset>
      </Section>

      <Section id={sectionId("ech")} title={t("settings.ech")} description={t("settings.echDescription")}>
        <ListInput
          id="echForcedDomains"
          label={t("settings.echForcedDomains")}
          hint={t("settings.echForcedDomainsHint", { max: MAX_ECH_FORCED_DOMAINS })}
          error={errors.echForcedDomains}
          placeholder="example.com"
          value={draft.echForcedDomains}
          onChange={(v) => set("echForcedDomains", v)}
        />
      </Section>

      <Section id={sectionId("queryLog")} title={t("settings.queryLog")}>
        <Row label={t("settings.queryLogEnabled")} hint={t("settings.queryLogHint")} htmlFor="queryLogEnabled" inline>
          <Switch id="queryLogEnabled" checked={draft.queryLogEnabled} onCheckedChange={(v) => set("queryLogEnabled", v)} />
        </Row>
      </Section>

      <div className="sticky bottom-keyboard-float z-10 flex items-center justify-end gap-2 rounded-xl border bg-card/95 px-3 py-2 shadow-sm backdrop-blur">
        {dirty && <span className="mr-auto text-xs text-muted-foreground">{t("common.unsaved")}</span>}
        <Button type="button" variant="ghost" disabled={!dirty || save.isPending} onClick={() => setDraft(toDraft(settings.data))}>
          <RotateCcw />
          {t("common.reset")}
        </Button>
        <Button type="submit" disabled={!dirty || save.isPending || invalid}>
          {save.isPending ? <LoaderCircle animate /> : <Save />}
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}

function AddressField(props: { id: string; label: string; placeholder: string; value: string; invalid: boolean; onChange: (value: string) => void }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={props.id}>{props.label}</Label>
      <Input
        id={props.id}
        className="font-mono text-sm"
        placeholder={props.placeholder}
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
        aria-invalid={props.invalid}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </div>
  );
}

function ListInput(props: { id: string; label: string; hint: string; error: string | undefined; placeholder: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="grid gap-2 py-3">
      <Label htmlFor={props.id}>{props.label}</Label>
      <Textarea
        id={props.id}
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
        aria-invalid={props.error !== undefined}
        aria-describedby={`${props.id}-hint`}
        className="font-mono text-sm"
        placeholder={props.placeholder}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
      <p id={`${props.id}-hint`} className={props.error ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
        {props.error ?? props.hint}
      </p>
    </div>
  );
}

/** Entries separated by any whitespace, normalised and without duplicates */
function splitList(text: string, normalise: (entry: string) => string = (entry) => entry): string[] {
  return [...new Set(text.split(/\s+/).filter(Boolean).map(normalise))];
}

function invalidEntry(entries: string[], valid: (entry: string) => boolean, message: (value: string) => string): string | undefined {
  const invalid = entries.find((entry) => !valid(entry));
  return invalid === undefined ? undefined : message(invalid);
}

function toDraft(s: Settings): Draft {
  return {
    ...s,
    upstreams: s.upstreams.join("\n"),
    echForcedDomains: s.echForcedDomains.join("\n"),
    ...(Object.fromEntries(NUMBER_FIELDS.map((key) => [key, String(s[key])])) as Record<NumberField, string>),
  };
}

function fromDraft(draft: Draft, lists: Pick<Settings, ListField>): Settings {
  return {
    ...draft,
    blockingIpv4: draft.blockingIpv4.trim(),
    blockingIpv6: draft.blockingIpv6.trim(),
    ...lists,
    ...(Object.fromEntries(NUMBER_FIELDS.map((key) => [key, Number(draft[key])])) as Record<NumberField, number>),
  };
}
