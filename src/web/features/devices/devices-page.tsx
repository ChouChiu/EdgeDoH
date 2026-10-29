import { ChevronDown } from "@/shared/components/animate-ui/icons/chevron-down";
import { Smartphone } from "@/shared/components/animate-ui/icons/smartphone";
import { EmptyState, PageHeader, QueryError } from "@/shared/components/page";
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
      <PageHeader title={t("nav.devices")} actions={<DeviceNameDialog />} />
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
      {/* Setup help matters before the first device exists; afterwards it folds away but stays one click from the list */}
      {devices.data && (
        <details open={devices.data.length === 0} className="group rounded-xl ring-1 ring-foreground/10">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-sm font-medium outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
            {t("guide.title")}
            <ChevronDown className="size-4 text-muted-foreground transition-transform duration-200 ease-standard group-open:rotate-180" />
          </summary>
          <div className="grid gap-3 px-3 pt-1 pb-3 text-sm text-muted-foreground md:grid-cols-2">
            {GUIDES.map((guide) => (
              <div key={guide}>
                <p className="font-medium text-foreground">{t(`guide.${guide}.title`)}</p>
                <p>{t(`guide.${guide}.body`)}</p>
              </div>
            ))}
          </div>
        </details>
      )}
    </>
  );
}
