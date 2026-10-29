import { useSearchParams } from "react-router";
import { useListAction } from "@/features/filters/api";
import { PageHeader } from "@/shared/components/page";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { useI18n } from "@/shared/i18n";
import { LocalRecords } from "./local-records";
import { RouteDialog, RouteLists } from "./route-lists";

const TABS = ["routes", "records"] as const;

export function DnsPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const actions = useListAction();
  const tab = (TABS as readonly string[]).includes(params.get("tab") ?? "") ? params.get("tab")! : "routes";
  return (
    <>
      <PageHeader title={t("nav.dns")} />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })}>
        {/* The active tab's add action shares the tab row instead of floating on a row of its own */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="routes">{t("dns.routes")}</TabsTrigger>
            <TabsTrigger value="records">{t("dns.records")}</TabsTrigger>
          </TabsList>
          {tab === "routes" && <RouteDialog actions={actions} />}
        </div>
        <TabsContent value="routes" className="mt-3 space-y-3">
          <RouteLists actions={actions} />
        </TabsContent>
        <TabsContent value="records" className="mt-3 space-y-3">
          <LocalRecords />
        </TabsContent>
      </Tabs>
    </>
  );
}
