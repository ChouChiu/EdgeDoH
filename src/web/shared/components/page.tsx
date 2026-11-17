import { AnimateIcon } from "@animate-ui/react/icons";
import type { ReactNode } from "react";
import { useNavigate, useRouteError } from "react-router";
import { CircleAlert } from "@/shared/components/animate-ui/icons/circle-alert";
import { LoaderCircle } from "@/shared/components/animate-ui/icons/loader-circle";
import { RefreshCw } from "@/shared/components/animate-ui/icons/refresh-cw";
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

export function QueryError({ error, title, onRetry }: { error: unknown; title?: string; onRetry?: () => void }) {
  const { t } = useI18n();
  const expired = error instanceof SessionExpiredError;
  return (
    <Alert variant="destructive">
      <CircleAlert animate />
      <AlertTitle>{title ?? t("common.loadFailed")}</AlertTitle>
      <AlertDescription>
        <p>{errorMessage(error, t)}</p>
        {(expired || onRetry) && (
          <Button size="sm" variant="outline" className="mt-2" onClick={expired ? () => location.reload() : onRetry}>
            {!expired && <RefreshCw />}
            {t(expired ? "common.refreshPage" : "common.retry")}
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

/** Fallback for uncaught route/render errors so React Router never shows an unstyled English error page */
export function RouteErrorFallback() {
  const { t } = useI18n();
  const error = useRouteError();
  const navigate = useNavigate();
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-4 p-6">
      <Alert variant="destructive">
        <CircleAlert animate />
        <AlertTitle>{t("errors.routeTitle")}</AlertTitle>
        <AlertDescription>
          <p>{errorMessage(error, t)}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => location.reload()}>
              <RefreshCw />
              {t("common.refreshPage")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void navigate("/", { replace: true })}>
              {t("errors.routeBack")}
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    </div>
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

/** Spinner and the step an item is busy with, e.g. in a card footer */
export function BusyStatus({ children }: { children: ReactNode }) {
  return (
    <span className="mr-1 flex items-center gap-1" role="status">
      <LoaderCircle animate className="size-3.5" />
      {children}
    </span>
  );
}
