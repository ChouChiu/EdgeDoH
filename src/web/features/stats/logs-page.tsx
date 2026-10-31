import { ANSWER_SOURCES, FILTER_ACTIONS, STATS_RANGES } from "#contract";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { Ban } from "@/shared/components/animate-ui/icons/ban";
import { Check } from "@/shared/components/animate-ui/icons/check";
import { ChevronLeft } from "@/shared/components/animate-ui/icons/chevron-left";
import { ChevronRight } from "@/shared/components/animate-ui/icons/chevron-right";
import { ScrollText } from "@/shared/components/animate-ui/icons/scroll-text";
import { Search } from "@/shared/components/animate-ui/icons/search";
import { X } from "@/shared/components/animate-ui/icons/x";
import { EmptyState, PageHeader, QueryError } from "@/shared/components/page";
import { SelectionBar } from "@/shared/components/selection-bar";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { Checkbox } from "@/shared/ui/checkbox";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Skeleton } from "@/shared/ui/skeleton";
import { Switch } from "@/shared/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/ui/table";
import { useDevices } from "@/features/devices/api";
import { appendCustomRules } from "@/features/rules/api";
import { useRebuild } from "@/features/snapshot/api";
import { useSelection } from "@/shared/hooks/use-selection";
import { type MessageKey, useI18n } from "@/shared/i18n";
import { errorMessage } from "@/shared/lib/http";
import { isStatsNotConfigured, type LogEntry, parseRange, type StatsQuery, statsApi } from "./api";
import { LogRow, ruleFor, type RuleKind } from "./log-row";
import { StatsNotConfigured } from "./stats-not-configured";

const PAGE_SIZE = 50;
const REFRESH_MS = 10_000;
const ALL = "all";
const FILTER_KEYS = ["range", "device", "action", "source", "search"];

const rowKey = (entry: LogEntry, i: number) => `${entry.time}|${entry.device}|${entry.name}|${i}`;

export function LogsPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const [draft, setDraft] = useState(params.get("search") ?? "");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const { rebuild } = useRebuild();
  const devices = useDevices();

  const page = Math.max(1, Math.floor(Number(params.get("page"))) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const action = FILTER_ACTIONS.find((a) => a === params.get("action"));
  const source = ANSWER_SOURCES.find((s) => s === params.get("source"));
  const query: StatsQuery = {
    range: parseRange(params.get("range")),
    ...(params.get("device") && { device: params.get("device")! }),
    ...(action && { action }),
    ...(source && { source }),
    ...(params.get("search") && { search: params.get("search")! }),
  };
  const filtered = FILTER_KEYS.some((k) => params.has(k));

  // Links from the overview change the search while this page stays mounted
  const search = params.get("search") ?? "";
  useEffect(() => setDraft(search), [search]);

  const logs = useQuery({
    queryKey: ["stats", "logs", query, offset],
    queryFn: () => statsApi.logs(query, PAGE_SIZE, offset),
    placeholderData: keepPreviousData,
    // Older pages do not change, only the newest one is worth polling
    refetchInterval: autoRefresh && page === 1 ? REFRESH_MS : false,
  });
  const items = logs.data?.items;
  const keys = useMemo(() => items?.map(rowKey) ?? [], [items]);
  const selection = useSelection(keys);

  /** Every filter change starts again from the first page */
  const setParam = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(params);
    if (value && value !== ALL) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    setParams(next, { replace: key !== "page" });
  };

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    setParam("search", draft.trim() || undefined);
  };

  const addRules = async (kind: RuleKind, names: string[]) => {
    const unique = [...new Set(names)];
    try {
      const added = await appendCustomRules(unique.map((name) => ruleFor(name, kind)));
      if (added === 0) {
        toast.info(unique.length === 1 ? t("logs.ruleExists", { rule: ruleFor(unique[0]!, kind) }) : t("logs.rulesExist"));
        return;
      }
      selection.clear();
      const reason: MessageKey = kind === "block" ? "logs.batchReason.block" : "logs.batchReason.allow";
      await rebuild(unique.length === 1 ? t(kind === "block" ? "logs.blockReason" : "logs.allowReason") : t(reason, { count: added }));
    } catch (err) {
      toast.error(t("logs.writeFailed"), { description: errorMessage(err, t) });
    }
  };

  const selectedNames = () => {
    const picked = new Set(selection.selected);
    return items?.filter((entry, i) => picked.has(rowKey(entry, i))).map((entry) => entry.name) ?? [];
  };

  return (
    <>
      <PageHeader
        title={t("nav.logs")}
        description={t("logs.description")}
        actions={
          <div className="flex items-center gap-2">
            <Switch id="auto-refresh" checked={autoRefresh} onCheckedChange={setAutoRefresh} />
            <Label htmlFor="auto-refresh" className="font-normal text-muted-foreground">
              {t("logs.autoRefresh")}
            </Label>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        <FilterSelect label={t("logs.range")} value={query.range} onChange={(v) => setParam("range", v === "24h" ? undefined : v)} className="w-28">
          {STATS_RANGES.map((r) => (
            <SelectItem key={r} value={r}>
              {t(`range.${r}`)}
            </SelectItem>
          ))}
        </FilterSelect>
        <FilterSelect label={t("logs.col.device")} value={query.device ?? ALL} onChange={(v) => setParam("device", v)} className="w-36">
          <SelectItem value={ALL}>{t("logs.allDevices")}</SelectItem>
          {devices.data?.map((d) => (
            <SelectItem key={d.id} value={d.id}>
              {d.name}
            </SelectItem>
          ))}
        </FilterSelect>
        <FilterSelect label={t("logs.col.action")} value={query.action ?? ALL} onChange={(v) => setParam("action", v)} className="w-32">
          <SelectItem value={ALL}>{t("logs.allActions")}</SelectItem>
          {FILTER_ACTIONS.map((a) => (
            <SelectItem key={a} value={a}>
              {t(`action.${a}`)}
            </SelectItem>
          ))}
        </FilterSelect>
        <FilterSelect label={t("logs.col.source")} value={query.source ?? ALL} onChange={(v) => setParam("source", v)} className="w-36">
          <SelectItem value={ALL}>{t("logs.allSources")}</SelectItem>
          {ANSWER_SOURCES.map((s) => (
            <SelectItem key={s} value={s}>
              {t(`logs.source.${s}`)}
            </SelectItem>
          ))}
        </FilterSelect>
        <form onSubmit={onSearch} className="flex min-w-48 flex-1 gap-2">
          <Input
            type="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("logs.searchPlaceholder")}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="url"
            enterKeyHint="search"
            aria-label={t("logs.searchPlaceholder")}
          />
          <Button type="submit" variant="outline" size="icon" aria-label={t("common.search")} title={t("common.search")}>
            <Search />
          </Button>
        </form>
        {filtered && (
          <Button variant="ghost" onClick={() => setParams({}, { replace: true })}>
            <X />
            {t("logs.clearFilters")}
          </Button>
        )}
      </div>

      {isStatsNotConfigured(logs.error) ? (
        <StatsNotConfigured />
      ) : logs.error ? (
        <QueryError error={logs.error} />
      ) : (
        <Card className="py-0">
          <CardContent className={logs.isPlaceholderData ? "px-0 opacity-60 transition-opacity" : "px-0"}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8 pr-0">
                    <Checkbox
                      checked={selection.allState}
                      disabled={keys.length === 0}
                      onCheckedChange={(v) => selection.setAll(v === true)}
                      aria-label={t("common.selectAll")}
                    />
                  </TableHead>
                  <TableHead className="w-36">{t("logs.col.time")}</TableHead>
                  <TableHead>{t("logs.col.name")}</TableHead>
                  <TableHead className="hidden md:table-cell">{t("logs.col.device")}</TableHead>
                  <TableHead>{t("logs.col.action")}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t("logs.col.rule")}</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">{t("logs.col.latency")}</TableHead>
                  <TableHead className="w-10">
                    <span className="sr-only">{t("common.actions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!items &&
                  Array.from({ length: 8 }, (_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={8}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    </TableRow>
                  ))}
                {items?.map((entry, i) => {
                  const key = rowKey(entry, i);
                  return (
                    <LogRow key={key} entry={entry} selected={selection.has(key)} onSelect={(on) => selection.toggle(key, on)} onRule={(kind, names) => void addRules(kind, names)} />
                  );
                })}
              </TableBody>
            </Table>
            {items?.length === 0 && (
              <div className="p-3">
                <EmptyState icon={<ScrollText />} title={t("logs.empty")} />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <SelectionBar selection={selection}>
        <Button size="sm" variant="outline" onClick={() => void addRules("block", selectedNames())}>
          <Ban />
          {t("logs.blockSelected")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void addRules("allow", selectedNames())}>
          <Check />
          {t("logs.allowSelected")}
        </Button>
      </SelectionBar>

      {!logs.error && (
        <div className="flex items-center justify-end gap-2">
          <span className="mr-auto text-xs text-muted-foreground tabular-nums">{t("common.page", { page })}</span>
          <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setParam("page", page > 2 ? String(page - 1) : undefined)}>
            <ChevronLeft />
            {t("common.prevPage")}
          </Button>
          <Button variant="outline" size="sm" disabled={(items?.length ?? 0) < PAGE_SIZE} onClick={() => setParam("page", String(page + 1))}>
            {t("common.nextPage")}
            <ChevronRight />
          </Button>
        </div>
      )}
    </>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  className,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className: string;
  children: ReactNode;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>{children}</SelectContent>
    </Select>
  );
}
