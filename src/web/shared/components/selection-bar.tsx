import type { ReactNode } from "react";
import { X } from "@/shared/components/animate-ui/icons/x";
import { Button } from "@/shared/ui/button";
import { useI18n } from "@/shared/i18n";
import type { Selection } from "@/shared/hooks/use-selection";

/** Floats above the keyboard while something is selected, holding the batch actions */
export function SelectionBar({ selection, children }: { selection: Selection; children: ReactNode }) {
  const { t } = useI18n();
  if (selection.selected.length === 0) return null;
  return (
    <div
      role="toolbar"
      aria-label={t("common.selected", { count: selection.selected.length })}
      className="sticky bottom-keyboard-float z-20 flex flex-wrap items-center gap-2 rounded-xl border bg-card/95 px-3 py-2 shadow-sm backdrop-blur"
    >
      <span className="mr-auto text-sm font-medium tabular-nums">{t("common.selected", { count: selection.selected.length })}</span>
      {children}
      <Button variant="ghost" size="sm" onClick={selection.clear}>
        <X />
        {t("common.clearSelection")}
      </Button>
    </div>
  );
}
