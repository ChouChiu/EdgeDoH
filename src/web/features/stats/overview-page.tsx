import { AnimateIcon } from "@animate-ui/react/icons";
import { SlidingNumber } from "@animate-ui/react/primitives/texts/sliding-number";
import { useShouldReduceMotion } from "@animate-ui/react/utils/motion";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Activity } from "@/shared/components/animate-ui/icons/activity";
import { Ban } from "@/shared/components/animate-ui/icons/ban";
import { Database } from "@/shared/components/animate-ui/icons/database";
import { Gauge } from "@/shared/components/animate-ui/icons/gauge";
import { PageHeader, QueryError } from "@/shared/components/page";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { type ChartConfig, ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@/shared/ui/chart";
import { Skeleton } from "@/shared/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { useI18n } from "@/shared/i18n";
import { isStatsNotConfigured, parseRange, type Range, RANGES, statsApi, type TopKind } from "./api";
import { StatsNotConfigured } from "./stats-not-configured";
import { TopCard } from "./top-card";

const TOP_KINDS: TopKind[] = ["domains", "blocked", "devices", "rules", "lists", "upstreams", "services", "clients", "networks"];

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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard icon={<Activity />} tone="text-primary" label={t("overview.total")} value={data && <Count value={data.total} />} />
            <StatCard
              icon={<Ban />}
              tone="text-destructive"
              label={t("overview.blocked")}
              value={data && <Count value={data.blocked} />}
              hint={data && t("overview.share", { percent: fmt.percent(data.blockedRatio) })}
            />
            <StatCard
              icon={<Database />}
              tone="text-info"
              label={t("overview.cached")}
              value={data && <Count value={data.cached} />}
              hint={data && data.total > 0 ? t("overview.share", { percent: fmt.percent(data.cached / data.total) }) : undefined}
            />
            <StatCard
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

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {TOP_KINDS.map((kind) => (
              <TopCard key={kind} kind={kind} range={range} enabled={summary.isSuccess} />
            ))}
          </div>
        </>
      )}
    </>
  );
}

/** Digits slide to each new value (a range switch, a refetch); every locale groups thousands with a comma. Latency has one decimal */
function Count({ value }: { value: number }) {
  return <SlidingNumber number={value} thousandSeparator="," decimalPlaces={Number.isInteger(value) ? 0 : 1} />;
}

function StatCard({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value?: ReactNode;
  hint?: string | undefined;
  tone?: string | undefined;
}) {
  return (
    <AnimateIcon asChild animateOnHover>
      <Card>
        <CardHeader>
          <CardDescription className="flex items-center gap-2 [&_svg]:size-4">
            {/* The tone rides on a wrapper, not an interpolated class: Tailwind only emits classes it can see as literals */}
            <span className={tone ?? "text-muted-foreground"}>{icon}</span>
            {label}
          </CardDescription>
          <CardTitle className="text-2xl tabular-nums">{value ?? <Skeleton className="h-8 w-24" />}</CardTitle>
          <p className="h-4 text-xs text-muted-foreground">{hint}</p>
        </CardHeader>
      </Card>
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
    <Card>
      <CardHeader>
        <CardTitle>{t("overview.trend")}</CardTitle>
        <CardDescription>{t("overview.trendRange", { range: t(`range.${range}`) })}</CardDescription>
      </CardHeader>
      <CardContent>
        {series.data ? (
          <ChartContainer config={config} className="aspect-auto h-64 w-full">
            <AreaChart data={series.data.points} margin={{ left: 0, right: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="bucket" tickLine={false} axisLine={false} minTickGap={32} tickFormatter={(v: string) => fmt.bucket(v, short)} />
              <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} tickFormatter={(v: number) => fmt.number(v)} />
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
      </CardContent>
    </Card>
  );
}

const areaMotion = (animate: boolean) => ({ isAnimationActive: animate, animationDuration: 400, animationEasing: "ease-out" as const });
