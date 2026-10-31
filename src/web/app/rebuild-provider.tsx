import { CUSTOM_LIST_ID, DEVICE_RULES_LIST_ID, SERVICE_LIST_PREFIX } from "#contract";
import { deviceRulesText, type FilterSource } from "#filter";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { devicesApi } from "@/features/devices/api";
import { LISTS_KEY, listsApi } from "@/features/filters/api";
import { SERVICES_KEY, servicesApi } from "@/features/profiles/api";
import { rulesApi } from "@/features/rules/api";
import { RebuildContext, SNAPSHOT_KEY } from "@/features/snapshot/api";
import { rebuildSnapshot, type RebuildSources, type RebuildStage } from "@/features/snapshot/rebuild";
import { type Translate, useI18n } from "@/shared/i18n";
import { errorMessage } from "@/shared/lib/http";

/**
 * Every enabled filter and route list, custom rules, device overrides and the blocked-services catalog.
 * Services are always compiled, unapplied, so profiles can switch them on without a rebuild and logs
 * can name the service behind each query
 */
async function loadSources(t: Translate): Promise<RebuildSources> {
  // The catalog lives on GitHub Pages, which is not always reachable; filter lists must still compile without it
  const [lists, custom, deviceRules, services] = await Promise.all([
    listsApi.list(),
    rulesApi.get(),
    devicesApi.allRules(),
    servicesApi.list({ fresh: true }).catch(() => null),
  ]);
  const enabled = lists.filter((l) => l.enabled);
  const texts = await Promise.all(enabled.map((l) => listsApi.text(l.id)));
  const sources: FilterSource[] = enabled.map((l, i) => ({ id: l.id, name: l.name, text: texts[i]!, kind: l.kind }));
  if (custom.trim()) sources.push({ id: CUSTOM_LIST_ID, name: t("rebuild.customList"), text: custom });
  if (deviceRules.length > 0) sources.push({ id: DEVICE_RULES_LIST_ID, name: t("devices.rules"), text: deviceRulesText(deviceRules) });
  for (const s of services ?? []) sources.push({ id: SERVICE_LIST_PREFIX + s.id, name: s.name, text: s.rules.join("\n"), kind: "service" });

  const installed = new Set(lists.map((l) => l.id));
  return {
    sources,
    servicesSkipped: services === null,
    report: (reports) =>
      listsApi.reports(reports.filter((r) => installed.has(r.id)).map(({ id, rules, unsupported, reasons }) => ({ id, rules, unsupported, reasons }))),
  };
}

export function RebuildProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [stage, setStage] = useState<RebuildStage | null>(null);

  const rebuild = useCallback(
    async (reason = t("rebuild.default")) => {
      const progress = (s: RebuildStage) => t("rebuild.progress", { reason, stage: t(`rebuild.stage.${s}`) });
      const id = toast.loading(progress("download"));
      try {
        const result = await rebuildSnapshot({
          load: () => loadSources(t),
          onStage: (s) => {
            setStage(s);
            toast.loading(progress(s), { id });
          },
        });
        if (result.lists === 0) toast.success(t("rebuild.cleared"), { id });
        else {
          toast.success(t("rebuild.done", { count: result.entries + result.complex }), {
            id,
            description: t("rebuild.doneDetail", { count: result.uploaded }),
          });
        }
        if (result.servicesSkipped) toast.warning(t("rebuild.servicesSkipped"));
        return result;
      } catch (err) {
        toast.error(t("rebuild.failed"), { id, description: errorMessage(err, t) });
        return undefined;
      } finally {
        setStage(null);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: LISTS_KEY }),
          queryClient.invalidateQueries({ queryKey: SNAPSHOT_KEY }),
          // The rebuild fetched the catalog past every cache; pickers and logs pick that copy up
          queryClient.invalidateQueries({ queryKey: SERVICES_KEY }),
        ]);
      }
    },
    [queryClient, t],
  );

  const value = useMemo(() => ({ stage, rebuild }), [stage, rebuild]);
  return <RebuildContext.Provider value={value}>{children}</RebuildContext.Provider>;
}
