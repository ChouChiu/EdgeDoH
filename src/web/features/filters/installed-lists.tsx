import { MAX_LIST_NAME } from "#contract";
import { AnimateIcon } from "@animate-ui/react/icons";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import { toast } from "sonner";
import { ExternalLink } from "@/shared/components/animate-ui/icons/external-link";
import { ListChecks } from "@/shared/components/animate-ui/icons/list-checks";
import { LoaderCircle } from "@/shared/components/animate-ui/icons/loader-circle";
import { Pencil } from "@/shared/components/animate-ui/icons/pencil";
import { Power } from "@/shared/components/animate-ui/icons/power";
import { PowerOff } from "@/shared/components/animate-ui/icons/power-off";
import { RefreshCw } from "@/shared/components/animate-ui/icons/refresh-cw";
import { Trash2 } from "@/shared/components/animate-ui/icons/trash-2";
import { ConfirmDialog } from "@/shared/components/confirm-dialog";
import { EmptyState, QueryError } from "@/shared/components/page";
import { SelectionBar } from "@/shared/components/selection-bar";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from "@/shared/ui/card";
import { Checkbox } from "@/shared/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Skeleton } from "@/shared/ui/skeleton";
import { Switch } from "@/shared/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { type Selection, useSelection } from "@/shared/hooks/use-selection";
import { useI18n } from "@/shared/i18n";
import { errorMessage, isHttpUrl } from "@/shared/lib/http";
import { AddUrlDialog } from "./add-url-dialog";
import { SnapshotCard } from "./snapshot-card";
import { type FilterList, type ListActions, LISTS_KEY, listsApi } from "./api";

export function InstalledLists({
  lists,
  error,
  actions,
  onBrowse,
}: {
  lists: FilterList[] | undefined;
  error: unknown;
  actions: ListActions;
  onBrowse: () => void;
}) {
  const { t } = useI18n();
  const ids = useMemo(() => lists?.map((l) => l.id) ?? [], [lists]);
  const selection = useSelection(ids);
  if (error) return <QueryError error={error} />;

  const batch = (keys: string[], step: string, each: (id: string) => Promise<unknown>, reason: string) => {
    selection.clear();
    void actions.runEach(keys, step, each, reason);
  };
  const setEnabled = (enabled: boolean) => {
    const keys = selection.selected.filter((id) => lists?.find((l) => l.id === id)?.enabled !== enabled);
    if (keys.length === 0) return selection.clear();
    batch(keys, t("filters.step.saving"), (id) => listsApi.update(id, { enabled }), t(enabled ? "filters.reason.enableMany" : "filters.reason.disableMany", { count: keys.length }));
  };
  const refresh = (keys: string[]) => batch(keys, t("filters.step.downloading"), listsApi.refresh, t("filters.reason.updateMany", { count: keys.length }));

  return (
    <>
      <SnapshotCard />
      <div className="flex flex-wrap items-center gap-2">
        {lists && lists.length > 0 && (
          <label className="mr-auto flex items-center gap-2 pl-3 text-sm text-muted-foreground">
            <Checkbox checked={selection.allState} onCheckedChange={(v) => selection.setAll(v === true)} disabled={actions.anyBusy} />
            {t("common.selectAll")}
          </label>
        )}
        <div className="ml-auto flex gap-2">
          {lists && lists.length > 0 && (
            <Button variant="outline" size="sm" disabled={actions.anyBusy} onClick={() => refresh(ids)}>
              <RefreshCw />
              {t("filters.updateAll")}
            </Button>
          )}
          <AddUrlDialog actions={actions} />
        </div>
      </div>
      {!lists && <Skeleton className="h-24 w-full" />}
      {lists?.length === 0 && (
        <EmptyState icon={<ListChecks />} title={t("filters.empty")}>
          <Button variant="link" onClick={onBrowse}>
            {t("filters.browseCatalog")}
          </Button>
        </EmptyState>
      )}
      <div className="grid gap-2">
        {lists?.map((list) => <InstalledCard key={list.id} list={list} actions={actions} selection={selection} />)}
      </div>
      <SelectionBar selection={selection}>
        <Button size="sm" variant="outline" disabled={actions.anyBusy} onClick={() => setEnabled(true)}>
          <Power />
          {t("common.enable")}
        </Button>
        <Button size="sm" variant="outline" disabled={actions.anyBusy} onClick={() => setEnabled(false)}>
          <PowerOff />
          {t("common.disable")}
        </Button>
        <Button size="sm" variant="outline" disabled={actions.anyBusy} onClick={() => refresh(selection.selected)}>
          <RefreshCw />
          {t("filters.update")}
        </Button>
        <ConfirmDialog
          title={t("filters.uninstallManyTitle", { count: selection.selected.length })}
          description={t("filters.uninstallBody")}
          confirmLabel={t("filters.uninstall")}
          onConfirm={() =>
            batch(selection.selected, t("filters.step.removing"), listsApi.remove, t("filters.reason.removeMany", { count: selection.selected.length }))
          }
        >
          <Button size="sm" variant="outline" disabled={actions.anyBusy}>
            <Trash2 />
            {t("filters.uninstall")}
          </Button>
        </ConfirmDialog>
      </SelectionBar>
    </>
  );
}

function InstalledCard({ list, actions, selection }: { list: FilterList; actions: ListActions; selection: Selection }) {
  const { t, fmt } = useI18n();
  const busy = actions.busy[list.id];
  const reasons = Object.entries(list.reasons ?? {}).sort((a, b) => b[1] - a[1]);
  const run = (step: string, action: () => Promise<unknown>, reason: string) => void actions.run(list.id, step, action, reason);

  return (
    <Card size="sm" className={list.enabled ? undefined : "opacity-70"}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Checkbox
            checked={selection.has(list.id)}
            onCheckedChange={(v) => selection.toggle(list.id, v === true)}
            disabled={busy !== undefined}
            aria-label={`${t("common.select")} ${list.name}`}
          />
          {list.name}
          {list.source === "url" && <Badge variant="outline">{t("filters.customSource")}</Badge>}
          {!list.enabled && <Badge variant="secondary">{t("filters.disabled")}</Badge>}
        </CardTitle>
        <CardDescription className="space-y-1 pl-6">
          {list.meta?.description && (
            <p className="line-clamp-2" title={list.meta.description}>
              {list.meta.description}
            </p>
          )}
          <ListDetails list={list} />
        </CardDescription>
        <CardAction>
          <Switch
            checked={list.enabled}
            disabled={busy !== undefined}
            aria-label={t("filters.enable")}
            onCheckedChange={(enabled) =>
              run(t("filters.step.saving"), () => listsApi.update(list.id, { enabled }), t(enabled ? "filters.reason.enable" : "filters.reason.disable"))
            }
          />
        </CardAction>
      </CardHeader>
      <CardFooter className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-xs text-muted-foreground">
        <span>{list.rules === null ? t("filters.notCompiled") : t("filters.rules", { count: list.rules })}</span>
        {list.unsupported !== null && list.unsupported > 0 && (
          <Tooltip>
            {/* Part of the list silently does nothing, which is worth noticing without being an error */}
            <TooltipTrigger className="text-warning underline decoration-dotted">{t("filters.unsupported", { count: list.unsupported })}</TooltipTrigger>
            <TooltipContent className="max-w-80">
              {reasons.map(([reason, count]) => (
                <div key={reason}>
                  {fmt.number(count)} × {reason}
                </div>
              ))}
            </TooltipContent>
          </Tooltip>
        )}
        <span>{t("filters.fetched", { time: fmt.relative(list.fetchedAt) })}</span>
        <div className="ml-auto flex items-center gap-0.5">
          {busy && (
            <span className="mr-1 flex items-center gap-1" role="status">
              <LoaderCircle animate className="size-3.5" />
              {busy}
            </span>
          )}
          <RenameDialog list={list} disabled={busy !== undefined} />
          <Button
            variant="ghost"
            size="sm"
            disabled={busy !== undefined}
            onClick={() => run(t("filters.step.downloading"), () => listsApi.refresh(list.id), t("filters.reason.refresh"))}
          >
            <RefreshCw />
            {t("filters.update")}
          </Button>
          <ConfirmDialog
            title={t("filters.uninstallTitle", { name: list.name })}
            description={t("filters.uninstallBody")}
            confirmLabel={t("filters.uninstall")}
            onConfirm={() => run(t("filters.step.removing"), () => listsApi.remove(list.id), t("filters.reason.remove"))}
          >
            <Button variant="ghost" size="sm" disabled={busy !== undefined}>
              <Trash2 />
              {t("filters.uninstall")}
            </Button>
          </ConfirmDialog>
        </div>
      </CardFooter>
    </Card>
  );
}

/** Names live only in D1 and the dashboard, so renaming needs no rebuild */
function RenameDialog({ list, disabled }: { list: FilterList; disabled: boolean }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(list.name);
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await listsApi.update(list.id, { name: name.trim() });
      await queryClient.invalidateQueries({ queryKey: LISTS_KEY });
      setOpen(false);
      toast.success(t("filters.renamed"));
    } catch (err) {
      toast.error(t("common.saveFailed"), { description: errorMessage(err, t) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setName(list.name);
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" disabled={disabled} aria-label={t("common.rename")} title={t("common.rename")}>
          <Pencil />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("filters.renameTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`rename-${list.id}`}>{t("common.name")}</Label>
            <Input id={`rename-${list.id}`} required autoFocus maxLength={MAX_LIST_NAME} value={name} onChange={(e) => setName(e.target.value)} enterKeyHint="done" />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving && <LoaderCircle animate />}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** One row of facts from the list's own header plus its source; links only for http(s) values */
function ListDetails({ list }: { list: FilterList }) {
  const { t, rich, fmt } = useI18n();
  const meta = list.meta ?? {};
  const modified = meta.lastModified ? Date.parse(meta.lastModified) : Number.NaN;
  const items = [
    meta.version && t("filters.version", { version: meta.version }),
    !Number.isNaN(modified) && t("filters.updated", { time: fmt.relative(modified) }),
    meta.license &&
      rich("filters.license", {
        license: isHttpUrl(meta.license) ? <ExternalLinkText href={meta.license}>{licenseLabel(meta.license)}</ExternalLinkText> : meta.license,
      }),
    meta.homepage && isHttpUrl(meta.homepage) && <ExternalLinkText href={meta.homepage}>{t("filters.homepage")}</ExternalLinkText>,
    // Registry URLs all look alike, so they collapse to a label; hand-added ones keep their host to tell them apart
    <ExternalLinkText href={list.url} title={list.url}>
      {list.source === "url" ? new URL(list.url).hostname : t("filters.sourceFile")}
    </ExternalLinkText>,
  ].filter(Boolean);
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
      {items.map((item, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          {i > 0 && <span aria-hidden>·</span>}
          {item}
        </span>
      ))}
    </div>
  );
}

function ExternalLinkText({ href, title, children }: { href: string; title?: string; children: ReactNode }) {
  return (
    <AnimateIcon asChild animateOnHover>
      <a href={href} title={title} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-foreground hover:underline">
        {children}
        <ExternalLink className="size-3" />
      </a>
    </AnimateIcon>
  );
}

/** A license given as a URL is shown by its file name, e.g. `LICENSE` or `gpl-3.0.html` */
function licenseLabel(url: string): string {
  const { pathname, hostname } = new URL(url);
  return pathname.split("/").filter(Boolean).at(-1) ?? hostname;
}
