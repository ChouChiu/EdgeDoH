import { AnimateIcon } from "@animate-ui/react/icons";
import type { ReactNode } from "react";
import { CircleAlert } from "@/shared/components/animate-ui/icons/circle-alert";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { useI18n } from "@/shared/i18n";
import { errorMessage, SessionExpiredError } from "@/shared/lib/http";

/** A page names itself and, only when there is something to say, states its live status in one line under the title */
export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="type-title">{title}</h1>
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
      <CircleAlert animate />
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
      {/* Plays once when the empty state shows, and again on hover */}
      <AnimateIcon animateOnView animateOnViewOnce animateOnHover className="text-muted-foreground [&_svg]:size-8">
        {icon}
      </AnimateIcon>
      <p className="type-subtitle">{title}</p>
      {children && <div className="max-w-md text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}
