import { useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { toast } from "sonner";
import { LISTS_KEY } from "@/features/filters/api";
import { useI18n } from "@/shared/i18n";
import { errorMessage } from "@/shared/lib/http";
import { SNAPSHOT_KEY } from "./api";
import { rebuildSnapshot, type RebuildResult, type RebuildStage } from "./rebuild";

interface RebuildContextValue {
  stage: RebuildStage | null;
  /** Recompiles and activates the snapshot, reporting progress and errors as toasts */
  rebuild: (reason?: string) => Promise<RebuildResult | undefined>;
}

const RebuildContext = createContext<RebuildContextValue | null>(null);

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
          customListName: t("rebuild.customList"),
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
        ]);
      }
    },
    [queryClient, t],
  );

  const value = useMemo(() => ({ stage, rebuild }), [stage, rebuild]);
  return <RebuildContext.Provider value={value}>{children}</RebuildContext.Provider>;
}

export function useRebuild(): RebuildContextValue {
  const value = useContext(RebuildContext);
  if (!value) throw new Error("useRebuild must be used within RebuildProvider");
  return value;
}
