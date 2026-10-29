import { useQuery } from "@tanstack/react-query";
import { Hammer } from "@/shared/components/animate-ui/icons/hammer";
import { LoaderCircle } from "@/shared/components/animate-ui/icons/loader-circle";
import { Button } from "@/shared/ui/button";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { useI18n } from "@/shared/i18n";
import { SNAPSHOT_KEY, snapshotApi } from "./api";
import { useRebuild } from "./rebuild-provider";

export function SnapshotCard() {
  const { t, fmt } = useI18n();
  const info = useQuery({ queryKey: SNAPSHOT_KEY, queryFn: snapshotApi.info });
  const { rebuild, stage } = useRebuild();
  const data = info.data;
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{t("snapshot.title")}</CardTitle>
        {/* No snapshot means nothing is being filtered at all, so it reads as a warning rather than a detail */}
        <CardDescription className={data && !data.active ? "text-warning" : undefined}>
          {data?.active
            ? t("snapshot.summary", {
                entries: data.entries,
                complex: data.complex,
                size: fmt.bytes(data.bytes),
                time: fmt.relative(data.uploadedAt),
              })
            : data
              ? t("snapshot.inactive")
              : t("common.loading")}
        </CardDescription>
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
