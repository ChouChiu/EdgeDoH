import { useProbe } from "@/features/probe/api";
import { CircleAlert } from "@/shared/components/animate-ui/icons/circle-alert";
import { CircleCheck } from "@/shared/components/animate-ui/icons/circle-check";
import { RefreshCw } from "@/shared/components/animate-ui/icons/refresh-cw";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Skeleton } from "@/shared/ui/skeleton";
import { useI18n } from "@/shared/i18n";
import { errorMessage } from "@/shared/lib/http";

/** Whether the browser showing the dashboard resolves through EdgeDoH, and as which device */
export function ProbeCard() {
  const { t } = useI18n();
  const probe = useProbe();
  const device = probe.data;

  return (
    <Card size="sm" className="flex-row items-center gap-3 px-(--card-spacing)">
      {probe.isPending ? (
        <Skeleton className="h-5 w-56" />
      ) : (
        <>
          {/* The tone rides on a wrapper, not an interpolated class: Tailwind only emits classes it can see as literals */}
          <span className={device ? "text-success" : "text-muted-foreground"}>{device ? <CircleCheck /> : <CircleAlert />}</span>
          <p className="min-w-0 flex-1 truncate">
            {probe.error ? errorMessage(probe.error, t) : device ? t("probe.using", { device: device.name }) : t("probe.notUsing")}
          </p>
        </>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        className="ml-auto"
        disabled={probe.isFetching}
        onClick={() => void probe.refetch()}
        aria-label={t("probe.recheck")}
        title={t("probe.recheck")}
      >
        <RefreshCw />
      </Button>
    </Card>
  );
}
