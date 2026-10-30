import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { useLists } from "@/features/filters/api";
import { CUSTOM_LIST_ID } from "@/features/rules/api";
import { snapshotApi } from "@/features/snapshot/api";
import { useRebuild } from "@/features/snapshot/api";
import { BLOCKING_MODES, type BlockingMode } from "@/features/settings/api";
import { LoaderCircle } from "@/shared/components/animate-ui/icons/loader-circle";
import { RotateCcw } from "@/shared/components/animate-ui/icons/rotate-ccw";
import { Save } from "@/shared/components/animate-ui/icons/save";
import { Trash2 } from "@/shared/components/animate-ui/icons/trash-2";
import { Row, Section } from "@/shared/components/form-section";
import { PageHeader, QueryError } from "@/shared/components/page";
import { ConfirmDialog } from "@/shared/components/confirm-dialog";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Skeleton } from "@/shared/ui/skeleton";
import { Switch } from "@/shared/ui/switch";
import { Textarea } from "@/shared/ui/textarea";
import { useI18n } from "@/shared/i18n";
import { errorMessage } from "@/shared/lib/http";
import { splitUpstreams, validateUpstreams } from "@/shared/lib/upstreams";
import { DEFAULT_PROFILE_ID, MAX_PROFILE_NAME, type Profile, PROFILES_KEY, profileName, profilesApi, type Schedule, useProfiles } from "./api";
import { ScheduleEditor } from "./schedule-editor";
import { ServicePicker } from "./service-picker";

const INHERIT = "inherit";
const NO_SWITCH = "none";

/** Form state: upstreams are edited one per line; empty means the global ones */
type Draft = Omit<Profile, "id" | "upstreams"> & { upstreams: string };

export function ProfilePage() {
  const { t } = useI18n();
  const { id = DEFAULT_PROFILE_ID } = useParams();
  const profiles = useProfiles();
  const profile = profiles.data?.find((p) => p.id === id);

  if (profiles.error) return <QueryError error={profiles.error} />;
  if (!profiles.data) return <Skeleton className="h-96 w-full" />;
  if (!profile) return <QueryError error={new Error(t("profiles.notFound"))} />;
  return <ProfileForm key={profile.id} profile={profile} />;
}

function ProfileForm({ profile }: { profile: Profile }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const lists = useLists();
  const profiles = useProfiles();
  const { rebuild } = useRebuild();
  const [draft, setDraft] = useState<Draft>(() => toDraft(profile));
  useEffect(() => setDraft(toDraft(profile)), [profile]);

  const save = useMutation({
    mutationFn: (next: Draft) => profilesApi.update(profile.id, fromDraft(next, profile.id)),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: PROFILES_KEY });
      toast.success(t("settings.saved"), { description: t("settings.savedDetail") });
      // Snapshots compiled before services existed cannot block them yet
      if (saved.services.length + saved.scheduledServices.length > 0) {
        const info = await snapshotApi.info();
        if (!info.active || !info.lists.some((l) => l.kind === "service")) await rebuild(t("profiles.compileServices"));
      }
    },
    onError: (err) => toast.error(t("common.saveFailed"), { description: errorMessage(err, t) }),
  });
  const remove = useMutation({
    mutationFn: () => profilesApi.remove(profile.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: PROFILES_KEY });
      void navigate("/profiles");
    },
    onError: (err) => toast.error(t("common.saveFailed"), { description: errorMessage(err, t) }),
  });

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const upstreamError = validateUpstreams(splitUpstreams(draft.upstreams), t, true);
  const nameError = !draft.name.trim() && profile.id !== DEFAULT_PROFILE_ID;
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(profile));
  const isDefault = profile.id === DEFAULT_PROFILE_ID;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!upstreamError && !nameError) save.mutate(draft);
  };

  const listOptions = [
    ...(lists.data ?? []).map((l) => ({ id: l.id, name: l.name })),
    { id: CUSTOM_LIST_ID, name: t("rebuild.customList") },
  ];
  const chosen = new Set(draft.lists ?? []);
  const otherProfiles = (profiles.data ?? []).filter((p) => p.id !== profile.id);
  // A target deleted since it was chosen is ignored by the Worker, so it reads as no switch
  const switchTarget = otherProfiles.some((p) => p.id === draft.scheduledProfile) ? draft.scheduledProfile : null;

  return (
    <form onSubmit={submit} className="mx-auto w-full max-w-3xl space-y-4">
      <PageHeader
        title={profileName(profile, t)}
        actions={
          !isDefault && (
            <ConfirmDialog title={t("profiles.deleteTitle", { name: profile.name })} confirmLabel={t("common.delete")} onConfirm={() => remove.mutate()}>
              <Button type="button" variant="ghost" size="sm" disabled={remove.isPending}>
                <Trash2 />
                {t("common.delete")}
              </Button>
            </ConfirmDialog>
          )
        }
      />

      <Section title={t("profiles.filtering")}>
        {!isDefault && (
          <Row label={t("common.name")} htmlFor="profile-name">
            <Input id="profile-name" className="w-56" maxLength={MAX_PROFILE_NAME} aria-invalid={nameError} value={draft.name} onChange={(e) => set("name", e.target.value)} />
          </Row>
        )}
        <Row label={t("profiles.filteringEnabled")} htmlFor="filtering" inline>
          <Switch id="filtering" checked={draft.filtering} onCheckedChange={(v) => set("filtering", v)} />
        </Row>
        <fieldset disabled={!draft.filtering} className="divide-y disabled:opacity-60">
          <Row label={t("profiles.allLists")} hint={t("profiles.allListsHint")} htmlFor="all-lists" inline>
            <Switch id="all-lists" checked={draft.lists === null} onCheckedChange={(v) => set("lists", v ? null : listOptions.map((l) => l.id))} />
          </Row>
          {draft.lists !== null && (
            <div className="grid gap-2 py-3 sm:grid-cols-2">
              {listOptions.map((l) => (
                <label key={l.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={chosen.has(l.id)}
                    onCheckedChange={(v) => set("lists", v === true ? [...chosen, l.id] : [...chosen].filter((id) => id !== l.id))}
                  />
                  <span className="truncate">{l.name}</span>
                </label>
              ))}
            </div>
          )}
          <Row label={t("profiles.blockingMode")} htmlFor="profile-blocking">
            <Select value={draft.blockingMode ?? INHERIT} onValueChange={(v) => set("blockingMode", v === INHERIT ? null : (v as BlockingMode))}>
              <SelectTrigger id="profile-blocking" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={INHERIT}>{t("profiles.inherit")}</SelectItem>
                {BLOCKING_MODES.map((m) => (
                  <SelectItem key={m} value={m}>
                    {t(`settings.mode.${m}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <Row label={t("profiles.safeSearch")} hint={t("profiles.safeSearchHint")} htmlFor="safe-search" inline>
            <Switch id="safe-search" checked={draft.safeSearch} onCheckedChange={(v) => set("safeSearch", v)} />
          </Row>
          <Row label={t("profiles.youtube")} htmlFor="youtube" inline>
            <Switch id="youtube" checked={draft.youtubeRestricted} onCheckedChange={(v) => set("youtubeRestricted", v)} />
          </Row>
          <Row label={t("profiles.rebinding")} hint={t("profiles.rebindingHint")} htmlFor="rebinding" inline>
            <Switch id="rebinding" checked={draft.rebinding} onCheckedChange={(v) => set("rebinding", v)} />
          </Row>
        </fieldset>
      </Section>

      <Section title={t("profiles.services")} description={t("profiles.servicesDescription")}>
        <fieldset disabled={!draft.filtering} className="disabled:opacity-60">
          <ServicePicker id="services" value={draft.services} onChange={(v) => set("services", v)} />
        </fieldset>
      </Section>

      {/* A switch works even while this profile filters nothing: an open daytime profile can turn strict at night */}
      <Section title={t("profiles.schedule")} description={t("profiles.scheduleDescription")}>
        <div className="divide-y">
          <Row label={t("profiles.scheduleEnabled")} htmlFor="schedule-on" inline>
            <Switch id="schedule-on" checked={draft.schedule !== null} onCheckedChange={(v) => set("schedule", v ? newSchedule() : null)} />
          </Row>
          {draft.schedule && (
            <>
              <ScheduleEditor value={draft.schedule} onChange={(v) => set("schedule", v)} />
              <Row label={t("profiles.scheduleSwitch")} hint={t("profiles.scheduleSwitchHint")} htmlFor="schedule-profile">
                <Select value={switchTarget ?? NO_SWITCH} onValueChange={(v) => set("scheduledProfile", v === NO_SWITCH ? null : v)}>
                  <SelectTrigger id="schedule-profile" className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_SWITCH}>{t("profiles.scheduleNoSwitch")}</SelectItem>
                    {otherProfiles.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {profileName(p, t)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Row>
              <fieldset disabled={!draft.filtering || switchTarget !== null} className="disabled:opacity-60">
                <ServicePicker id="scheduled-services" value={draft.scheduledServices} onChange={(v) => set("scheduledServices", v)} />
              </fieldset>
            </>
          )}
        </div>
      </Section>

      <Section title={t("profiles.resolution")}>
        <div className="grid gap-2 py-3">
          <Textarea
            id="profile-upstreams"
            aria-label={t("settings.upstreams")}
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            inputMode="url"
            aria-invalid={upstreamError !== undefined}
            className="font-mono text-sm"
            placeholder={t("profiles.upstreamsPlaceholder")}
            value={draft.upstreams}
            onChange={(e) => set("upstreams", e.target.value)}
          />
          {upstreamError && <p className="text-xs text-destructive">{upstreamError}</p>}
        </div>
        <Row label={t("profiles.splitDns")} hint={t("profiles.splitDnsHint")} htmlFor="split-dns" inline>
          <Switch id="split-dns" checked={draft.splitDns} onCheckedChange={(v) => set("splitDns", v)} />
        </Row>
        <Row label={t("profiles.ecs")} hint={t("profiles.ecsHint")} htmlFor="ecs" inline>
          <Switch id="ecs" checked={draft.ecs} onCheckedChange={(v) => set("ecs", v)} />
        </Row>
        <Row label={t("profiles.ech")} hint={t("profiles.echHint")} htmlFor="ech" inline>
          <Switch id="ech" checked={draft.ech} onCheckedChange={(v) => set("ech", v)} />
        </Row>
        <Row label={t("profiles.h3")} hint={t("profiles.h3Hint")} htmlFor="h3" inline>
          <Switch id="h3" checked={draft.h3} onCheckedChange={(v) => set("h3", v)} />
        </Row>
      </Section>

      <div className="sticky bottom-keyboard-float z-10 flex items-center justify-end gap-2 rounded-xl border bg-card/95 px-3 py-2 shadow-sm backdrop-blur">
        {dirty && <span className="mr-auto text-xs text-muted-foreground">{t("common.unsaved")}</span>}
        <Button type="button" variant="ghost" disabled={!dirty || save.isPending} onClick={() => setDraft(toDraft(profile))}>
          <RotateCcw />
          {t("common.reset")}
        </Button>
        <Button type="submit" disabled={!dirty || save.isPending || upstreamError !== undefined || nameError}>
          {save.isPending ? <LoaderCircle animate /> : <Save />}
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}

function newSchedule(): Schedule {
  return { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, days: [1, 2, 3, 4, 5], start: 21 * 60, end: 7 * 60 };
}

function toDraft({ id: _id, upstreams, ...rest }: Profile): Draft {
  return { ...rest, upstreams: upstreams?.join("\n") ?? "" };
}

function fromDraft({ name, upstreams, ...rest }: Draft, id: string) {
  const list = splitUpstreams(upstreams);
  return { ...rest, ...(id !== DEFAULT_PROFILE_ID && { name: name.trim() }), upstreams: list.length > 0 ? list : null };
}
