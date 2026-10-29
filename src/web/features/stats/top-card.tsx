import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { QueryError } from "@/shared/components/page";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Skeleton } from "@/shared/ui/skeleton";
import { useListName } from "@/features/filters/api";
import { useServices } from "@/features/profiles/api";
import { ServiceIcon } from "@/shared/components/service-icon";
import { useI18n } from "@/shared/i18n";
import { type Range, statsApi, type TopItem, type TopKind } from "./api";

const ROW = "relative block overflow-hidden rounded-md px-2 py-1 text-sm";

/**
 * One tint per ranking so six cards on a page stay apart at a glance, following the verdict colours:
 * red is what was stopped, yellow is ordinary traffic, blue is where a query came from or went to
 */
const BAR: Record<TopKind, string> = {
  domains: "bg-primary/15",
  blocked: "bg-destructive/10",
  devices: "bg-info/15",
  rules: "bg-destructive/10",
  lists: "bg-primary/15",
  upstreams: "bg-success/15",
  services: "bg-primary/15",
  clients: "bg-info/15",
  networks: "bg-info/15",
};

/** Rows the query log can filter by link to it; rules, lists and upstreams have no such filter */
function logLink(kind: TopKind, item: TopItem, range: Range): string | undefined {
  if (kind !== "domains" && kind !== "blocked" && kind !== "devices") return undefined;
  const params = new URLSearchParams({ range });
  if (kind === "devices") params.set("device", item.key);
  else params.set("search", item.key);
  if (kind === "blocked") params.set("action", "block");
  return `/logs?${params}`;
}

export function TopCard({ kind, range, enabled }: { kind: TopKind; range: Range; enabled: boolean }) {
  const { t, fmt } = useI18n();
  const listName = useListName();
  const services = useServices();
  const service = (id: string) => services.data?.find((s) => s.id === id);
  const top = useQuery({ queryKey: ["stats", "top", kind, range], queryFn: () => statsApi.top(kind, { range }, 10), enabled });
  const max = Math.max(1, ...(top.data?.items.map((i) => i.count) ?? []));
  const labelOf = (item: TopItem) =>
    kind === "devices" ? item.label || item.key : kind === "lists" ? listName(item.key) : kind === "services" ? (service(item.key)?.name ?? item.key) : item.key;

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{t(`overview.top.${kind}`)}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-0.5">
        {top.error && <QueryError error={top.error} />}
        {!top.data && !top.error && Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-7 w-full" />)}
        {top.data?.items.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">{t("common.noData")}</p>}
        {top.data?.items.map((item) => {
          const label = labelOf(item);
          const href = logLink(kind, item, range);
          const body = (
            <>
              <div className={`absolute inset-y-0 left-0 ${BAR[kind]}`} style={{ width: `${(item.count / max) * 100}%` }} />
              <div className="relative flex items-center justify-between gap-2">
                <span className={kind === "rules" ? "truncate font-mono text-xs" : "flex min-w-0 items-center gap-1.5 truncate"}>
                  {kind === "services" && service(item.key) && <ServiceIcon icon={service(item.key)!.icon} />}
                  {label}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{fmt.number(item.count)}</span>
              </div>
            </>
          );
          return href ? (
            <Link
              key={item.key}
              to={href}
              title={`${label} · ${t("overview.viewLogs")}`}
              className={`${ROW} outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring`}
            >
              {body}
            </Link>
          ) : (
            <div key={item.key} title={label} className={ROW}>
              {body}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
