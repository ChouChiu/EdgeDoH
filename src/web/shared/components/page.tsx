import { AlertCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { useI18n } from "@/shared/i18n";
import { errorMessage, SessionExpiredError } from "@/shared/lib/http";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function QueryError({ error, title }: { error: unknown; title?: string }) {
  const { t } = useI18n();
  return (
    <Alert variant="destructive">
      <AlertCircle />
      <AlertTitle>{title ?? t("common.loadFailed")}</AlertTitle>
      <AlertDescription>
        {errorMessage(error, t)}
        {error instanceof SessionExpiredError && (
          <Button size="sm" variant="outline" className="mt-2" onClick={() => location.reload()}>
            {t("common.refreshPage")}
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center">
      <div className="text-muted-foreground [&_svg]:size-8">{icon}</div>
      <p className="font-medium">{title}</p>
      {children && <div className="max-w-md text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}
