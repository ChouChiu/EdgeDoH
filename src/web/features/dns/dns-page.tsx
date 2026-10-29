import { useSearchParams } from "react-router";
import { PageHeader } from "@/shared/components/page";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { useI18n } from "@/shared/i18n";
import { LocalRecords } from "./local-records";
import { RouteLists } from "./route-lists";

const TABS = ["routes", "records"] as const;

export function DnsPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const tab = (TABS as readonly string[]).includes(params.get("tab") ?? "") ? params.get("tab")! : "routes";
  return (
    <>
      <PageHeader title={t("nav.dns")} />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })}>
        <TabsList>
          <TabsTrigger value="routes">{t("dns.routes")}</TabsTrigger>
          <TabsTrigger value="records">{t("dns.records")}</TabsTrigger>
        </TabsList>
        <TabsContent value="routes" className="mt-3 space-y-3">
          <RouteLists />
        </TabsContent>
        <TabsContent value="records" className="mt-3 space-y-3">
          <LocalRecords />
        </TabsContent>
      </Tabs>
    </>
  );
}
