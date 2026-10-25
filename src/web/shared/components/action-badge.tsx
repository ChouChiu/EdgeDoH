import type { FilterAction } from "@/features/stats/api";
import { Badge } from "@/shared/ui/badge";
import { useI18n } from "@/shared/i18n";

// The verdict is the thing people scan for in a log of thousands of rows, so each one gets its own colour:
// red stopped it, green let it through against a rule, blue sent it somewhere else, grey means no rule matched
const VARIANTS = { block: "destructive", pass: "secondary", allow: "success", rewrite: "info" } as const;

export function ActionBadge({ action }: { action: FilterAction }) {
  const { t } = useI18n();
  return <Badge variant={VARIANTS[action]}>{t(`action.${action}`)}</Badge>;
}
