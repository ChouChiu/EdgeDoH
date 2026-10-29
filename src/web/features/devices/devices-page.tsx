import { Smartphone } from "@/shared/components/animate-ui/icons/smartphone";
import { EmptyState, PageHeader, QueryError } from "@/shared/components/page";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Skeleton } from "@/shared/ui/skeleton";
import { useI18n } from "@/shared/i18n";
import { useDevices } from "./api";
import { DeviceCard } from "./device-card";
import { DeviceNameDialog } from "./device-name-dialog";

const GUIDES = ["apple", "windows", "browser", "android"] as const;

export function DevicesPage() {
  const { t } = useI18n();
  const devices = useDevices();
  return (
    <>
      <PageHeader title={t("nav.devices")} description={t("devices.description")} actions={<DeviceNameDialog />} />
      {devices.error && <QueryError error={devices.error} />}
      {devices.isPending && <Skeleton className="h-32 w-full" />}
      {devices.data?.length === 0 && (
        <EmptyState icon={<Smartphone />} title={t("devices.empty")}>
          {t("devices.emptyHint")}
        </EmptyState>
      )}
      <div className="grid gap-2">
        {devices.data?.map((d) => <DeviceCard key={d.id} device={d} />)}
      </div>
      <Card size="sm">
        <CardHeader>
          <CardTitle>{t("guide.title")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm text-muted-foreground md:grid-cols-2">
          {GUIDES.map((guide) => (
            <div key={guide}>
              <p className="font-medium text-foreground">{t(`guide.${guide}.title`)}</p>
              <p>{t(`guide.${guide}.body`)}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
