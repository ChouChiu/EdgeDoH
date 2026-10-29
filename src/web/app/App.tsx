import { LoaderCircle } from "@/shared/components/animate-ui/icons/loader-circle";
import { PageTransition } from "@/shared/components/animate-ui/components/page-transition";
import { useEffect } from "react";
import { Outlet, ScrollRestoration, useLocation } from "react-router";
import { LocaleToggle, ThemeSwitch } from "@/shared/components/header-controls";
import { useIsMobile } from "@/shared/hooks/use-mobile";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/shared/ui/sidebar";
import { useRebuild } from "@/features/snapshot/api";
import { useI18n } from "@/shared/i18n";
import { AppSidebar } from "./app-sidebar";
import { pageLabel } from "./nav";

export default function App() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const { stage } = useRebuild();
  // On phones the closing sidebar sheet already reveals the new page
  const mobile = useIsMobile();
  const label = pageLabel(pathname);
  const title = label ? t(label) : undefined;

  useEffect(() => {
    document.title = title ? `${title} · cf-dns` : "cf-dns";
  }, [title]);

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header data-vt="header" className="sticky top-0 z-10 flex h-[calc(3rem+env(safe-area-inset-top))] items-center gap-2 border-b bg-background/80 px-4 pt-[env(safe-area-inset-top)] backdrop-blur">
          <SidebarTrigger className="-ml-1" aria-label={t("nav.toggleSidebar")} />
          <div aria-hidden className="mr-1 h-4 w-px shrink-0 bg-border" />
          <span className="truncate text-sm font-medium">{title ?? "cf-dns"}</span>
          <div className="ml-auto flex items-center gap-1">
            {stage && (
              <span className="mr-2 flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
                <LoaderCircle animate className="size-3.5" />
                <span className="hidden sm:inline">{t(`rebuild.stage.${stage}`)}</span>
              </span>
            )}
            <LocaleToggle />
            <ThemeSwitch className="ml-1" />
          </div>
        </header>
        {/* SidebarInset is already the <main> landmark */}
        <div className="mx-auto w-full max-w-6xl flex-1 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:px-6 md:py-5 md:pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
          {mobile ? (
            <div className="space-y-4">
              <Outlet />
            </div>
          ) : (
            <PageTransition className="space-y-4">
              <Outlet />
            </PageTransition>
          )}
        </div>
      </SidebarInset>
      <ScrollRestoration />
    </SidebarProvider>
  );
}
