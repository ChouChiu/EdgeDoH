import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useRebuild } from "@/features/snapshot/rebuild-provider";
import { useI18n } from "@/shared/i18n";
import { errorMessage } from "@/shared/lib/http";
import { LISTS_KEY } from "./api";

export type ListActions = ReturnType<typeof useListAction>;

/** Runs list changes followed by one rebuild, tracking a progress label per busy key (a list ID or a dialog) */
export function useListAction() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { rebuild } = useRebuild();
  const [busy, setBusy] = useState<Record<string, string>>({});

  const label = (keys: string[], text: string) => setBusy((b) => ({ ...b, ...Object.fromEntries(keys.map((k) => [k, text])) }));

  const run = async (key: string | string[], firstStep: string, action: (progress: (step: string) => void) => Promise<unknown>, reason: string) => {
    const keys = typeof key === "string" ? [key] : key;
    label(keys, firstStep);
    try {
      await action((step) => label(keys, step));
      await queryClient.invalidateQueries({ queryKey: LISTS_KEY });
      label(keys, t("rebuild.stage.compile"));
      return await rebuild(reason);
    } catch (err) {
      toast.error(t("filters.actionFailed", { reason }), { description: errorMessage(err, t) });
      return undefined;
    } finally {
      setBusy((b) => Object.fromEntries(Object.entries(b).filter(([k]) => !keys.includes(k))));
    }
  };

  /**
   * Applies `each` to every key one after another, then rebuilds once. A failing item does not stop the
   * rest: whatever succeeded still gets compiled, and the failures are reported together
   */
  const runEach = (keys: string[], step: string, each: (key: string) => Promise<unknown>, reason: string) =>
    run(
      keys,
      step,
      async (progress) => {
        const failures: string[] = [];
        for (const [i, key] of keys.entries()) {
          progress(t("filters.step.progress", { step, done: i + 1, total: keys.length }));
          try {
            await each(key);
          } catch (err) {
            failures.push(errorMessage(err, t));
          }
        }
        if (failures.length === keys.length) throw new Error(failures[0]);
        if (failures.length > 0) toast.error(t("filters.actionFailed", { reason }), { description: failures.join("\n") });
      },
      reason,
    );

  return { busy, run, runEach, anyBusy: Object.keys(busy).length > 0 };
}
