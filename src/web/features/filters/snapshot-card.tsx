import { useQuery } from "@tanstack/react-query";
import { Hammer } from "@/shared/components/animate-ui/icons/hammer";
import { LoaderCircle } from "@/shared/components/animate-ui/icons/loader-circle";
import { Button } from "@/shared/ui/button";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { useI18n } from "@/shared/i18n";
import { errorMessage } from "@/shared/lib/http";
import { SNAPSHOT_KEY, snapshotApi, useRebuild } from "@/features/snapshot/api";

export function SnapshotCard() {
  const { t, fmt } = useI18n();
  const info = useQuery({ queryKey: SNAPSHOT_KEY, queryFn: snapshotApi.info });
  const { rebuild, stage } = useRebuild();
  const data = info.data;

  let summary = t("common.loading");
  let tone: string | undefined;
  if (info.error) {
    summary = errorMessage(info.error, t);
    tone = "text-destructive";
  } else if (data?.active) {
    summary = t("snapshot.summary", { entries: data.entries, complex: data.complex, size: fmt.bytes(data.bytes), time: fmt.relative(data.uploadedAt) });
  } else if (data) {
    // No snapshot means nothing is being filtered at all, so it reads as a warning rather than a detail
    summary = t("snapshot.inactive");
    tone = "text-warning";
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{t("snapshot.title")}</CardTitle>
        <CardDescription className={tone}>{summary}</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" disabled={stage !== null} onClick={() => void rebuild()}>
            {stage ? <LoaderCircle animate /> : <Hammer />}
            {t("rebuild.default")}
          </Button>
        </CardAction>
      </CardHeader>
    </Card>
  );
}
