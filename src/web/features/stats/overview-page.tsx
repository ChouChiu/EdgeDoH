import { AnimateIcon } from "@animate-ui/react/icons";
import { SlidingNumber } from "@animate-ui/react/primitives/texts/sliding-number";
import { useShouldReduceMotion } from "@animate-ui/react/utils/motion";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { useSearchParams } from "react-router";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Activity } from "@/shared/components/animate-ui/icons/activity";
import { Ban } from "@/shared/components/animate-ui/icons/ban";
import { Database } from "@/shared/components/animate-ui/icons/database";
import { Gauge } from "@/shared/components/animate-ui/icons/gauge";
import { PageHeader, QueryError } from "@/shared/components/page";
import { Card } from "@/shared/ui/card";
import { type ChartConfig, ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@/shared/ui/chart";
import { Skeleton } from "@/shared/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { useI18n } from "@/shared/i18n";
import { isStatsNotConfigured, parseRange, type Range, RANGES, statsApi, type TopKind } from "./api";
import { StatsNotConfigured } from "./stats-not-configured";
import { TopCard, TopList } from "./top-card";

/** What most visits come for stays in view; the rest share one tabbed card and load only when picked */
const PRIMARY_TOP: TopKind[] = ["domains", "blocked", "devices"];
const MORE_TOP: TopKind[] = ["services", "rules", "lists", "upstreams", "clients", "networks"];

export function OverviewPage() {
  const { t, fmt } = useI18n();
  const [params, setParams] = useSearchParams();
  const range = parseRange(params.get("range"));
  const summary = useQuery({ queryKey: ["stats", "summary", range], queryFn: () => statsApi.summary({ range }) });
  const data = summary.data;

  return (
    <>
      <PageHeader
        title={t("nav.overview")}
        actions={
          <Tabs value={range} onValueChange={(v) => setParams(v === "24h" ? {} : { range: v }, { replace: true })}>
            <TabsList>
              {RANGES.map((r) => (
                <TabsTrigger key={r} value={r}>
                  {t(`range.${r}`)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        }
      />

      {isStatsNotConfigured(summary.error) ? (
        <StatsNotConfigured />
      ) : summary.error ? (
        <QueryError error={summary.error} />
      ) : (
        <>
          {/* The headline numbers and their trend are one reading, so they share one surface; hairline gaps split the cells */}
          <Card className="gap-0 py-0">
            <div className="grid grid-cols-2 gap-px border-b bg-border lg:grid-cols-4">
              <Stat primary icon={<Activity />} tone="text-primary" label={t("overview.total")} value={data && <Count value={data.total} />} />
              <Stat
                icon={<Ban />}
                tone="text-destructive"
                label={t("overview.blocked")}
                value={data && <Count value={data.blocked} />}
                hint={data && t("overview.share", { percent: fmt.percent(data.blockedRatio) })}
              />
              <Stat
                icon={<Database />}
                tone="text-info"
                label={t("overview.cached")}
                value={data && <Count value={data.cached} />}
                hint={data && data.total > 0 ? t("overview.share", { percent: fmt.percent(data.cached / data.total) }) : undefined}
              />
              <Stat
                icon={<Gauge />}
                // Upstream failures are the one thing on this row that is wrong rather than just large
                tone={data && data.failed > 0 ? "text-destructive" : "text-success"}
                label={t("overview.latency")}
                value={data && <><Count value={data.avgLatencyMs} /> ms</>}
                hint={data && data.failed > 0 ? t("overview.failures", { count: data.failed }) : undefined}
              />
            </div>
            {/* Dependent queries wait for the summary so an unconfigured API costs one request, not five */}
            <TrafficChart range={range} enabled={summary.isSuccess} />
          </Card>

          <div className="grid gap-3 lg:grid-cols-3">
            {PRIMARY_TOP.map((kind) => (
              <TopCard key={kind} kind={kind} range={range} enabled={summary.isSuccess} />
            ))}
          </div>
          <MoreRankings range={range} enabled={summary.isSuccess} />
        </>
      )}
    </>
  );
}

/** Digits slide to each new value (a range switch, a refetch); every locale groups thousands with a comma. Latency has one decimal */
function Count({ value }: { value: number }) {
  return <SlidingNumber number={value} thousandSeparator="," decimalPlaces={Number.isInteger(value) ? 0 : 1} />;
}

/** One cell of the headline strip; the total is the page's anchor, so its number is the largest thing on screen */
function Stat({
  icon,
  label,
  value,
  hint,
  tone,
  primary,
}: {
  icon: ReactNode;
  label: string;
  value?: ReactNode;
  hint?: string | undefined;
  tone?: string | undefined;
  primary?: boolean;
}) {
  return (
    <AnimateIcon asChild animateOnHover>
      <div className="flex flex-col gap-1 bg-card px-4 py-3.5">
        <p className="flex items-center gap-2 text-sm text-muted-foreground [&_svg]:size-4">
          {/* The tone rides on a wrapper, not an interpolated class: Tailwind only emits classes it can see as literals */}
          <span className={tone ?? "text-muted-foreground"}>{icon}</span>
          {label}
        </p>
        <div className={primary ? "type-display max-sm:text-2xl" : "type-figure"}>
          {value ?? <Skeleton className={primary ? "h-9 w-28" : "h-8 w-24"} />}
        </div>
        <p className="type-meta h-4">{hint}</p>
      </div>
    </AnimateIcon>
  );
}

function TrafficChart({ range, enabled }: { range: Range; enabled: boolean }) {
  const { t, fmt } = useI18n();
  const series = useQuery({ queryKey: ["stats", "timeseries", range], queryFn: () => statsApi.timeseries({ range }), enabled });
  const short = range === "1h" || range === "24h";
  // Recharts draws areas in over 1.5 s by default; a short ease-out keeps the reveal from upstaging the data
  const animate = !useShouldReduceMotion();
  const config = {
    // Same reading as the cards above: yellow is everything that came in, red is the part that was stopped
    total: { label: t("overview.series.total"), color: "var(--chart-1)" },
    blocked: { label: t("overview.series.blocked"), color: "var(--destructive)" },
  } satisfies ChartConfig;

  return (
    <div className="px-2 pt-4 pb-2 sm:px-4">
      {series.data ? (
        <ChartContainer config={config} className="aspect-auto h-64 w-full">
          <AreaChart data={series.data.points} margin={{ left: 0, right: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="bucket" tickLine={false} axisLine={false} minTickGap={32} tickFormatter={(v: string) => fmt.bucket(v, short)} />
            <YAxis tickLine={false} axisLine={false} width={48} allowDecimals={false} tickFormatter={(v: number) => fmt.number(v)} />
            <ChartTooltip content={<ChartTooltipContent labelFormatter={(v) => fmt.bucket(String(v), short, true)} />} />
            <Area dataKey="total" type="monotone" fill="var(--color-total)" fillOpacity={0.15} stroke="var(--color-total)" {...areaMotion(animate)} />
            <Area dataKey="blocked" type="monotone" fill="var(--color-blocked)" fillOpacity={0.3} stroke="var(--color-blocked)" {...areaMotion(animate)} />
            <ChartLegend content={<ChartLegendContent />} />
          </AreaChart>
        </ChartContainer>
      ) : series.error ? (
        <QueryError error={series.error} />
      ) : (
        <Skeleton className="h-64 w-full" />
      )}
    </div>
  );
}

function MoreRankings({ range, enabled }: { range: Range; enabled: boolean }) {
  const { t } = useI18n();
  const [kind, setKind] = useState<TopKind>(MORE_TOP[0]!);
  return (
    <Card size="sm">
      <Tabs value={kind} onValueChange={(v) => setKind(v as TopKind)} className="gap-3">
        {/* Six labels overflow a phone, so the strip scrolls sideways instead of wrapping */}
        <div className="overflow-x-auto overflow-y-hidden px-(--card-spacing) py-px [scrollbar-width:none]">
          <TabsList>
            {MORE_TOP.map((k) => (
              <TabsTrigger key={k} value={k}>
                {t(`overview.top.${k}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {MORE_TOP.map((k) => (
          <TabsContent key={k} value={k} className="space-y-0.5 px-(--card-spacing)">
            <TopList kind={k} range={range} enabled={enabled} />
          </TabsContent>
        ))}
      </Tabs>
    </Card>
  );
}

const areaMotion = (animate: boolean) => ({ isAnimationActive: animate, animationDuration: 400, animationEasing: "ease-out" as const });
