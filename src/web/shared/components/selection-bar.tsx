import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { X } from "@/shared/components/animate-ui/icons/x";
import { Button } from "@/shared/ui/button";
import { useI18n } from "@/shared/i18n";
import type { Selection } from "@/shared/hooks/use-selection";

/** Floats above the keyboard while something is selected, holding the batch actions */
export function SelectionBar({ selection, children }: { selection: Selection; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <AnimatePresence>
      {selection.selected.length > 0 && (
        <motion.div
          role="toolbar"
          aria-label={t("common.selected", { count: selection.selected.length })}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
          className="sticky bottom-keyboard-float z-20 flex flex-wrap items-center gap-2 rounded-xl border bg-card/95 px-3 py-2 shadow-sm backdrop-blur"
        >
          <span className="mr-auto text-sm font-medium tabular-nums">{t("common.selected", { count: selection.selected.length })}</span>
          {children}
          <Button variant="ghost" size="sm" onClick={selection.clear}>
            <X />
            {t("common.clearSelection")}
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
