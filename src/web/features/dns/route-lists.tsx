import { MAX_LIST_NAME } from "#contract";
import { type FormEvent, useState } from "react";
import { type FilterList, type ListActions, listsApi, useListAction, useRouteLists } from "@/features/filters/api";
import { LoaderCircle } from "@/shared/components/animate-ui/icons/loader-circle";
import { Network } from "@/shared/components/animate-ui/icons/network";
import { Pencil } from "@/shared/components/animate-ui/icons/pencil";
import { Plus } from "@/shared/components/animate-ui/icons/plus";
import { RefreshCw } from "@/shared/components/animate-ui/icons/refresh-cw";
import { Trash2 } from "@/shared/components/animate-ui/icons/trash-2";
import { EmptyState, QueryError } from "@/shared/components/page";
import { ConfirmDialog } from "@/shared/components/confirm-dialog";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from "@/shared/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Skeleton } from "@/shared/ui/skeleton";
import { Switch } from "@/shared/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { Textarea } from "@/shared/ui/textarea";
import { useI18n } from "@/shared/i18n";
import { splitUpstreams, validateUpstreams } from "@/shared/lib/upstreams";

const NEW_KEY = "new-route";

export function RouteLists() {
  const { t } = useI18n();
  const lists = useRouteLists();
  const actions = useListAction();
  if (lists.error) return <QueryError error={lists.error} />;
  return (
    <>
      <div className="flex justify-end">
        <RouteDialog actions={actions} />
      </div>
      {!lists.data && <Skeleton className="h-24 w-full" />}
      {lists.data?.length === 0 && (
        <EmptyState icon={<Network />} title={t("dns.routesEmpty")}>
          {t("dns.routesEmptyHint")}
        </EmptyState>
      )}
      <div className="grid gap-2">
        {lists.data?.map((list) => <RouteCard key={list.id} list={list} actions={actions} />)}
      </div>
    </>
  );
}

function RouteCard({ list, actions }: { list: FilterList; actions: ListActions }) {
  const { t, fmt } = useI18n();
  const busy = actions.busy[list.id];
  const run = (step: string, action: () => Promise<unknown>, reason: string) => void actions.run(list.id, step, action, reason);
  return (
    <Card size="sm" className={list.enabled ? undefined : "opacity-70"}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {list.name}
          {list.source === "inline" && <Badge variant="outline">{t("dns.inline")}</Badge>}
        </CardTitle>
        <CardDescription className="space-y-0.5 font-mono text-xs break-all">
          {list.upstreams?.map((u) => <div key={u}>→ {u}</div>)}
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
        <span>{list.rules === null ? t("filters.notCompiled") : t("dns.domains", { count: list.rules })}</span>
        {list.source !== "inline" && <span>{t("filters.fetched", { time: fmt.relative(list.fetchedAt) })}</span>}
        <div className="ml-auto flex items-center gap-0.5">
          {busy && (
            <span className="mr-1 flex items-center gap-1" role="status">
              <LoaderCircle animate className="size-3.5" />
              {busy}
            </span>
          )}
          <RouteDialog list={list} actions={actions} />
          {list.source !== "inline" && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy !== undefined}
              onClick={() => run(t("filters.step.downloading"), () => listsApi.refresh(list.id), t("filters.reason.refresh"))}
            >
              <RefreshCw />
              {t("filters.update")}
            </Button>
          )}
          <ConfirmDialog
            title={t("filters.uninstallTitle", { name: list.name })}
            confirmLabel={t("common.delete")}
            onConfirm={() => run(t("filters.step.removing"), () => listsApi.remove(list.id), t("filters.reason.remove"))}
          >
            <Button variant="ghost" size="icon-sm" disabled={busy !== undefined} aria-label={t("common.delete")} title={t("common.delete")}>
              <Trash2 />
            </Button>
          </ConfirmDialog>
        </div>
      </CardFooter>
    </Card>
  );
}

/** Adds a route list, or edits `list`: name and upstreams, plus the domains of an inline list */
function RouteDialog({ list, actions }: { list?: FilterList; actions: ListActions }) {
  const { t } = useI18n();
  const key = list?.id ?? NEW_KEY;
  const busy = actions.busy[key];
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"url" | "inline">(list?.source === "inline" ? "inline" : "url");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [upstreams, setUpstreams] = useState("");

  const onOpenChange = async (next: boolean) => {
    if (busy) return;
    if (next) {
      setName(list?.name ?? "");
      setUrl(list?.url ?? "");
      setUpstreams(list?.upstreams?.join("\n") ?? "");
      setText(list?.source === "inline" ? await listsApi.text(list.id) : "");
    }
    setOpen(next);
  };

  const upstreamList = splitUpstreams(upstreams);
  const upstreamError = validateUpstreams(upstreamList, t);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (upstreamError) return;
    const reason = t(list ? "dns.reason.edit" : "dns.reason.add");
    const result = await actions.run(
      key,
      t(list || mode === "inline" ? "filters.step.saving" : "filters.step.downloading"),
      async () => {
        if (!list) {
          const source = mode === "url" ? { url: url.trim() } : { text };
          return listsApi.addRoute({ ...(name.trim() && { name: name.trim() }), upstreams: upstreamList, ...source });
        }
        await listsApi.update(list.id, { upstreams: upstreamList, ...(name.trim() && { name: name.trim() }) });
        if (list.source === "inline") await listsApi.setText(list.id, text);
      },
      reason,
    );
    if (result) setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => void onOpenChange(o)}>
      <DialogTrigger asChild>
        {list ? (
          <Button variant="ghost" size="icon-sm" disabled={busy !== undefined} aria-label={t("dns.editRoute")} title={t("dns.editRoute")}>
            <Pencil />
          </Button>
        ) : (
          <Button size="sm">
            <Plus />
            {t("dns.addRoute")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={(e) => void submit(e)} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t(list ? "dns.editRoute" : "dns.addRoute")}</DialogTitle>
            <DialogDescription>{t("dns.routeDescription")}</DialogDescription>
          </DialogHeader>
          {!list && (
            <Tabs value={mode} onValueChange={(v) => setMode(v as "url" | "inline")}>
              <TabsList>
                <TabsTrigger value="url">{t("dns.sourceUrl")}</TabsTrigger>
                <TabsTrigger value="inline">{t("dns.sourceInline")}</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          <div className="space-y-2">
            <Label htmlFor="route-name">{mode === "inline" && !list ? t("common.name") : t("filters.nameOptional")}</Label>
            <Input id="route-name" maxLength={MAX_LIST_NAME} required={mode === "inline" && !list} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          {!list && mode === "url" && (
            <div className="space-y-2">
              <Label htmlFor="route-url">{t("filters.url")}</Label>
              <Input
                id="route-url"
                type="url"
                required
                placeholder="https://example.com/accelerated-domains.china.conf"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
          )}
          {(list ? list.source === "inline" : mode === "inline") && (
            <div className="space-y-2">
              <Label htmlFor="route-text">{t("dns.domainsLabel")}</Label>
              <Textarea
                id="route-text"
                className="min-h-32 font-mono text-sm"
                spellCheck={false}
                autoCapitalize="none"
                placeholder={"corp.example\nserver=/intranet.example/10.0.0.53"}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="route-upstreams">{t("settings.upstreams")}</Label>
            <Textarea
              id="route-upstreams"
              required
              className="font-mono text-sm"
              spellCheck={false}
              autoCapitalize="none"
              inputMode="url"
              aria-invalid={upstreams !== "" && upstreamError !== undefined}
              placeholder="https://dns.alidns.com/dns-query"
              value={upstreams}
              onChange={(e) => setUpstreams(e.target.value)}
            />
            <p className={upstreams !== "" && upstreamError ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
              {(upstreams !== "" && upstreamError) || t("settings.upstreamsHint")}
            </p>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy !== undefined || upstreamError !== undefined}>
              {busy && <LoaderCircle animate />}
              {busy ?? t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
