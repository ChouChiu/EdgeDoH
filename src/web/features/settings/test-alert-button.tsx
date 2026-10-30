import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { LoaderCircle } from "@/shared/components/animate-ui/icons/loader-circle";
import { Button } from "@/shared/ui/button";
import { useI18n } from "@/shared/i18n";
import { errorMessage } from "@/shared/lib/http";
import { alertsApi } from "./api";

/** Posts a sample message to the saved webhook; an unsaved URL has to be saved first */
export function TestAlertButton({ disabled }: { disabled: boolean }) {
  const { t } = useI18n();
  const send = useMutation({
    mutationFn: alertsApi.test,
    onSuccess: () => toast.success(t("settings.alertTestSent")),
    onError: (err) => toast.error(t("settings.alertTestFailed"), { description: errorMessage(err, t) }),
  });
  return (
    <Button type="button" variant="outline" className="shrink-0" disabled={disabled || send.isPending} onClick={() => send.mutate()}>
      {send.isPending && <LoaderCircle animate />}
      {t("settings.alertTest")}
    </Button>
  );
}
