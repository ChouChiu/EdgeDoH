import type { StatsRange } from "#contract";
import { useQuery } from "@tanstack/react-query";
import { QueryError } from "@/shared/components/page";
import { Skeleton } from "@/shared/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/ui/table";
import { useI18n } from "@/shared/i18n";
import { statsApi } from "./api";

/** Above this share of failed attempts an upstream is worth a look */
const WARN_RATE = 0.05;

/** Answers, failures and round trip per upstream host */
export function UpstreamHealth({ range, enabled }: { range: StatsRange; enabled: boolean }) {
  const { t, fmt } = useI18n();
  const health = useQuery({ queryKey: ["stats", "upstreams", range], queryFn: () => statsApi.upstreams({ range }), enabled });
  const ms = (v: number | null) => (v === null ? "–" : `${fmt.number(v)} ms`);

  if (health.error) return <QueryError error={health.error} />;
  if (!health.data) return Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-7 w-full" />);
  if (health.data.items.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{t("common.noData")}</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("overview.upstream.host")}</TableHead>
          <TableHead className="text-right">{t("overview.upstream.answered")}</TableHead>
          <TableHead className="text-right">{t("overview.upstream.failureRate")}</TableHead>
          <TableHead className="text-right">{t("overview.upstream.avg")}</TableHead>
          <TableHead className="hidden text-right sm:table-cell">P95</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {health.data.items.map((u) => (
          <TableRow key={u.host}>
            <TableCell className="max-w-48 truncate font-mono text-xs" title={u.host}>
              {u.host}
            </TableCell>
            <TableCell className="text-right tabular-nums">{fmt.number(u.answered)}</TableCell>
            <TableCell
              className={`text-right tabular-nums ${u.failureRate > WARN_RATE ? "text-destructive" : "text-muted-foreground"}`}
              title={t("overview.upstream.failedCount", { count: u.failed })}
            >
              {fmt.percent(u.failureRate)}
            </TableCell>
            <TableCell className="text-right tabular-nums">{ms(u.avgMs)}</TableCell>
            <TableCell className="hidden text-right tabular-nums text-muted-foreground sm:table-cell">{ms(u.p95Ms)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
