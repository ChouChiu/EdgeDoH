import { ReducedMotionConfig } from "@animate-ui/react/utils/motion";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate } from "react-router";
import { RouterProvider } from "react-router/dom";

import "./index.css";
import App from "@/app/App";
import { PAGES } from "@/app/routes";
import { ThemeProvider } from "@/shared/components/theme-provider";
import { Toaster } from "@/shared/ui/sonner";
import { TooltipProvider } from "@/shared/ui/tooltip";
import { RebuildProvider } from "@/app/rebuild-provider";
import { useIsMobile } from "@/shared/hooks/use-mobile";
import { I18nProvider } from "@/shared/i18n";
import { ApiError } from "@/shared/lib/http";
import { trackVisualViewport } from "@/shared/lib/viewport";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // Only network errors and upstream hiccups (502) are worth retrying; 4xx and 503 are configuration
      retry: (count, err) => (!(err instanceof ApiError) || err.status === 502) && count < 2,
    },
  },
});

trackVisualViewport();

// A data router: it runs navigations in React transitions, which is what PageTransition animates
const router = createBrowserRouter([
  {
    element: (
      <RebuildProvider>
        <App />
      </RebuildProvider>
    ),
    children: [...PAGES.map(({ path, Page }) => ({ path, element: <Page /> })), { path: "*", element: <Navigate to="/" replace /> }],
  },
]);

/** On phones toasts drop from the top, where the on-screen keyboard cannot cover them */
function AppToaster() {
  const mobile = useIsMobile();
  return (
    <Toaster richColors position={mobile ? "top-center" : "bottom-right"} mobileOffset={{ top: "calc(env(safe-area-inset-top) + 0.5rem)" }} />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* Every motion animation (dialogs, tabs, switches, sliding numbers, icons) follows the OS reduced-motion setting */}
    <ReducedMotionConfig>
      <I18nProvider>
        <ThemeProvider>
          <QueryClientProvider client={queryClient}>
            <TooltipProvider>
              <RouterProvider router={router} />
              <AppToaster />
            </TooltipProvider>
          </QueryClientProvider>
        </ThemeProvider>
      </I18nProvider>
    </ReducedMotionConfig>
  </StrictMode>,
);
