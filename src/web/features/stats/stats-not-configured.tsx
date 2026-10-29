import { Activity } from "@/shared/components/animate-ui/icons/activity";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { useI18n } from "@/shared/i18n";

export function StatsNotConfigured() {
  const { t, rich } = useI18n();
  return (
    <Alert>
      <Activity />
      <AlertTitle>{t("stats.notConfigured.title")}</AlertTitle>
      <AlertDescription>
        <p>{rich("stats.notConfigured.body", { command: <code className="rounded bg-muted px-1">bun run secrets:push</code> })}</p>
      </AlertDescription>
    </Alert>
  );
}
