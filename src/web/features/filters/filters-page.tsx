import { useSearchParams } from "react-router";
import { PageHeader } from "@/shared/components/page";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { useI18n } from "@/shared/i18n";
import { useListAction, useLists } from "./api";
import { CatalogBrowser } from "./catalog-browser";
import { InstalledLists } from "./installed-lists";

export function FiltersPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "catalog" ? "catalog" : "installed";
  const lists = useLists();
  const actions = useListAction();

  return (
    <>
      <PageHeader title={t("nav.filters")} description={t("filters.description")} />
      <Tabs value={tab} onValueChange={(v) => setParams(v === "installed" ? {} : { tab: v }, { replace: true })}>
        <TabsList>
          <TabsTrigger value="installed">
            {t("filters.tab.installed")}
            {lists.data && <span className="text-muted-foreground tabular-nums">{lists.data.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="catalog">{t("filters.tab.catalog")}</TabsTrigger>
        </TabsList>
        <TabsContent value="installed" className="mt-3 space-y-3">
          <InstalledLists lists={lists.data} error={lists.error} actions={actions} onBrowse={() => setParams({ tab: "catalog" })} />
        </TabsContent>
        <TabsContent value="catalog" className="mt-3 space-y-3">
          <CatalogBrowser installed={lists.data ?? []} actions={actions} />
        </TabsContent>
      </Tabs>
    </>
  );
}
