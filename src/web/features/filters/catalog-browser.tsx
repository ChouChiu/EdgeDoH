import { useQuery } from "@tanstack/react-query";
import { Check, ExternalLink, Loader2, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState, QueryError } from "@/shared/components/page";
import { SelectionBar } from "@/shared/components/selection-bar";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/shared/ui/card";
import { Checkbox } from "@/shared/ui/checkbox";
import { Input } from "@/shared/ui/input";
import { Skeleton } from "@/shared/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { useSelection } from "@/shared/hooks/use-selection";
import { type MessageKey, useI18n } from "@/shared/i18n";
import { type CatalogFilter, type FilterList, listsApi } from "./api";
import type { ListActions } from "./use-list-action";

const ALL = "all";
const KNOWN_GROUPS = new Set([1, 2, 3, 4]);
const busyKey = (filterId: number) => `registry-${filterId}`;

export function CatalogBrowser({ installed, actions }: { installed: FilterList[]; actions: ListActions }) {
  const { t, rich } = useI18n();
  const catalog = useQuery({ queryKey: ["catalog"], queryFn: listsApi.catalog, staleTime: 3_600_000 });
  const [group, setGroup] = useState(ALL);
  const [search, setSearch] = useState("");

  const installedIds = useMemo(() => new Set(installed.map((l) => l.registryId)), [installed]);
  const languages = useMemo(
    () => new Map(catalog.data?.tags.filter((tag) => tag.keyword.startsWith("lang:")).map((tag) => [tag.tagId, tag.keyword.slice(5)])),
    [catalog.data],
  );
  const groups = useMemo(() => catalog.data?.groups.toSorted((a, b) => a.displayNumber - b.displayNumber) ?? [], [catalog.data]);

  const filters = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (catalog.data?.filters ?? [])
      .filter((f) => !f.deprecated)
      .filter((f) => group === ALL || String(f.groupId) === group)
      .filter((f) => !q || f.name.toLowerCase().includes(q) || f.description.toLowerCase().includes(q))
      .sort((a, b) => a.groupId - b.groupId || a.displayNumber - b.displayNumber);
  }, [catalog.data, group, search]);

  const installable = useMemo(() => filters.filter((f) => !installedIds.has(f.filterId)).map((f) => busyKey(f.filterId)), [filters, installedIds]);
  const selection = useSelection(installable);

  const installSelected = () => {
    const keys = selection.selected;
    selection.clear();
    void actions.runEach(
      keys,
      t("filters.step.downloading"),
      (key) => listsApi.installRegistry(Number(key.slice("registry-".length))),
      t("filters.reason.installMany", { count: keys.length }),
    );
  };

  const groupLabel = (id: number, fallback: string) => (KNOWN_GROUPS.has(id) ? t(`filters.group.${id}` as MessageKey) : fallback);

  if (catalog.error) return <QueryError error={catalog.error} title={t("filters.catalogError")} />;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={group} onValueChange={setGroup} className="max-w-full overflow-x-auto">
          <TabsList>
            <TabsTrigger value={ALL}>{t("filters.group.all")}</TabsTrigger>
            {groups.map((g) => (
              <TabsTrigger key={g.groupId} value={String(g.groupId)}>
                {groupLabel(g.groupId, g.groupName)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("filters.searchCatalog")}
            enterKeyHint="search"
            aria-label={t("filters.searchCatalog")}
          />
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        {!catalog.data && Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-40" />)}
        {filters.map((f) => (
          <CatalogCard
            key={f.filterId}
            filter={f}
            group={groupLabel(f.groupId, t("filters.group.2"))}
            languages={f.tags.map((tag) => languages.get(tag)).filter((l) => l !== undefined)}
            installed={installedIds.has(f.filterId)}
            busy={actions.busy[busyKey(f.filterId)]}
            selected={selection.has(busyKey(f.filterId))}
            onSelect={(on) => selection.toggle(busyKey(f.filterId), on)}
            onInstall={() =>
              void actions.run(
                busyKey(f.filterId),
                t("filters.step.downloading"),
                () => listsApi.installRegistry(f.filterId),
                t("filters.reason.install", { name: f.name }),
              )
            }
          />
        ))}
      </div>
      {catalog.data && filters.length === 0 && <EmptyState icon={<Search />} title={t("filters.noMatch")} />}
      <SelectionBar selection={selection}>
        <Button size="sm" disabled={actions.anyBusy} onClick={installSelected}>
          <Plus />
          {t("filters.installSelected")}
        </Button>
      </SelectionBar>
      <p className="text-xs text-muted-foreground">
        {rich("filters.catalogSource", {
          link: (
            <a className="underline" href="https://github.com/AdguardTeam/HostlistsRegistry" target="_blank" rel="noreferrer">
              AdguardTeam/HostlistsRegistry
            </a>
          ),
        })}
      </p>
    </>
  );
}

function CatalogCard({
  filter,
  group,
  languages,
  installed,
  busy,
  selected,
  onSelect,
  onInstall,
}: {
  filter: CatalogFilter;
  group: string;
  languages: string[];
  installed: boolean;
  busy: string | undefined;
  selected: boolean;
  onSelect: (selected: boolean) => void;
  onInstall: () => void;
}) {
  const { t, fmt } = useI18n();
  return (
    <Card size="sm" className="flex flex-col">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {!installed && (
            <Checkbox checked={selected} onCheckedChange={(v) => onSelect(v === true)} disabled={busy !== undefined} aria-label={`${t("common.select")} ${filter.name}`} />
          )}
          {filter.name}
          <Badge variant="secondary">{group}</Badge>
          {languages.slice(0, 3).map((l) => (
            <Badge key={l} variant="outline">
              {l}
            </Badge>
          ))}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1">
        <p className="line-clamp-3 text-sm text-muted-foreground" title={filter.description}>
          {filter.description}
        </p>
      </CardContent>
      <CardFooter className="flex items-center gap-3 py-2 text-xs text-muted-foreground">
        {filter.timeUpdated && <span>{t("filters.updated", { time: fmt.relative(filter.timeUpdated) })}</span>}
        {filter.homepage && (
          <a href={filter.homepage} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
            {t("filters.homepage")}
            <ExternalLink className="size-3" />
          </a>
        )}
        <div className="ml-auto">
          {installed && !busy ? (
            <Button size="sm" variant="secondary" disabled>
              <Check />
              {t("filters.installed")}
            </Button>
          ) : (
            <Button size="sm" disabled={busy !== undefined} onClick={onInstall}>
              {busy ? <Loader2 className="animate-spin" /> : <Plus />}
              {busy ?? t("common.install")}
            </Button>
          )}
        </div>
      </CardFooter>
    </Card>
  );
}
