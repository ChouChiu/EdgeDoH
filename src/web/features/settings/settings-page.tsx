import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { LoaderCircle } from "@/shared/components/animate-ui/icons/loader-circle";
import { RotateCcw } from "@/shared/components/animate-ui/icons/rotate-ccw";
import { Save } from "@/shared/components/animate-ui/icons/save";
import { PageHeader, QueryError } from "@/shared/components/page";
import { ThemeSwitch } from "@/shared/components/header-controls";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Skeleton } from "@/shared/ui/skeleton";
import { Switch } from "@/shared/ui/switch";
import { Textarea } from "@/shared/ui/textarea";
import { type Locale, LOCALE_NAMES, LOCALES, type Translate, useI18n } from "@/shared/i18n";
import { errorMessage, isHttpUrl } from "@/shared/lib/http";
import {
  BLOCKING_MODES,
  type BlockingMode,
  MAX_UPSTREAMS,
  type Settings,
  SETTINGS_KEY,
  settingsApi,
  UPSTREAM_MODES,
  type UpstreamMode,
  useSettings,
} from "./api";

type NumberField = "blockedTtl" | "upstreamTimeoutMs" | "cacheMinTtl" | "cacheMaxTtl" | "maxDeviceClients" | "deviceClientWindowMinutes";
const NUMBER_FIELDS: NumberField[] = ["blockedTtl", "upstreamTimeoutMs", "cacheMinTtl", "cacheMaxTtl", "maxDeviceClients", "deviceClientWindowMinutes"];

/** Form state: numbers stay strings while typing, upstreams are one per line */
type Draft = Omit<Settings, NumberField | "upstreams"> & Record<NumberField, string> & { upstreams: string };

export function SettingsPage() {
  const { t } = useI18n();
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <PageHeader title={t("nav.settings")} description={t("settings.description")} />
      <AppearanceCard />
      <ServerSettings />
    </div>
  );
}

/** Browser-only preferences, the same ones as the header toggles */
function AppearanceCard() {
  const { t, locale, setLocale } = useI18n();
  return (
    <Section title={t("settings.appearance")} description={t("settings.appearanceDescription")}>
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
  const errors = {
    upstreams: validateUpstreams(upstreams, t),
    customIp: draft.blockingMode === "custom_ip" && !draft.blockingIpv4.trim() && !draft.blockingIpv6.trim() ? t("settings.customIpRequired") : undefined,
    cacheRange: Number(draft.cacheMinTtl) > Number(draft.cacheMaxTtl) ? t("settings.cacheRange") : undefined,
  };
  const invalid = Object.values(errors).some(Boolean);
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(settings.data));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!invalid) save.mutate(fromDraft(draft, upstreams));
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
      <Section title={t("settings.filtering")} description={t("settings.filteringDescription")}>
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

      <Section title={t("settings.upstream")} description={t("settings.upstreamDescription")}>
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

      <Section title={t("settings.cache")} description={t("settings.cacheDescription")}>
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

      <Section title={t("settings.abuse")} description={t("settings.abuseDescription")}>
        <Row label={t("settings.maxDeviceClients")} hint={t("settings.maxDeviceClientsHint")} htmlFor="maxDeviceClients">
          {number("maxDeviceClients", 0, 1000)}
        </Row>
        <fieldset disabled={draft.maxDeviceClients === "0"} className="disabled:opacity-60">
          <Row label={t("settings.deviceClientWindow")} hint={t("settings.deviceClientWindowHint")} htmlFor="deviceClientWindowMinutes">
            {number("deviceClientWindowMinutes", 5, 10080)}
          </Row>
        </fieldset>
      </Section>

      <Section title={t("settings.queryLog")}>
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

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card size="sm" className="gap-0 pb-0">
      <CardHeader className="border-b pb-3">
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription className="text-xs">{description}</CardDescription>}
      </CardHeader>
      <CardContent className="divide-y">{children}</CardContent>
    </Card>
  );
}

interface RowProps {
  label: string;
  hint?: string | undefined;
  hintError?: boolean;
  htmlFor: string;
  /** Small controls such as switches stay beside the label even on phones */
  inline?: boolean;
  children: ReactNode;
}

/** Label and hint on the left, the control on the right; wider controls stack under the label on narrow screens */
function Row({ label, hint, hintError, htmlFor, inline, children }: RowProps) {
  return (
    <div className={inline ? "flex items-center justify-between gap-4 py-2.5" : "flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4"}>
      <div className="min-w-0 space-y-0.5">
        <Label htmlFor={htmlFor}>{label}</Label>
        {hint && <p className={hintError ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
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

function toDraft(s: Settings): Draft {
  return {
    ...s,
    upstreams: s.upstreams.join("\n"),
    ...(Object.fromEntries(NUMBER_FIELDS.map((key) => [key, String(s[key])])) as Record<NumberField, string>),
  };
}

function fromDraft(draft: Draft, upstreams: string[]): Settings {
  return {
    ...draft,
    blockingIpv4: draft.blockingIpv4.trim(),
    blockingIpv6: draft.blockingIpv6.trim(),
    upstreams,
    ...(Object.fromEntries(NUMBER_FIELDS.map((key) => [key, Number(draft[key])])) as Record<NumberField, number>),
  };
}

function splitUpstreams(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

function validateUpstreams(upstreams: string[], t: Translate): string | undefined {
  if (upstreams.length === 0 || upstreams.length > MAX_UPSTREAMS) return t("settings.upstreamCount");
  const invalid = upstreams.find((u) => !isHttpUrl(u, ["https:"]));
  return invalid === undefined ? undefined : t("settings.invalidUpstream", { url: invalid });
}
