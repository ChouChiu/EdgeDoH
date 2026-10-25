import { NavLink, useLocation } from "react-router";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/shared/ui/sidebar";
import { useI18n } from "@/shared/i18n";
import { isActive, NAV } from "./nav";

// A modified copy served to others has to offer them its own source, so a fork points this at its own repository
const SOURCE_URL = "https://github.com/ChouChiu/cf-dns";

export function AppSidebar() {
  const { t } = useI18n();
  const { pathname, search } = useLocation();
  const { isMobile, setOpenMobile } = useSidebar();
  // Desktop navigations cross-fade the page body; on phones the closing sheet already reveals the new page
  const viewTransition = !isMobile;
  /*
   * Clicking the page you are already on still navigates, and the cross-fade then plays over identical content:
   * the old snapshot is hidden and the new one fades back in, which reads as a flash. The link still navigates
   * so the scroll resets, it just does it without the transition. A different query string is a real change
   */
  const transitionTo = (to: string) => viewTransition && !(pathname === to && search === "");
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            {/* Same button geometry as the nav items, so the logo stays in their column when collapsed */}
            <SidebarMenuButton size="lg" asChild tooltip="cf-dns">
              <NavLink to="/" viewTransition={transitionTo("/")} onClick={() => setOpenMobile(false)}>
                {/* The favicon itself, so the tab and the sidebar never drift apart */}
                <img src="/favicon.svg" alt="" className="size-8 shrink-0" />
                <span className="font-semibold">cf-dns</span>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton asChild tooltip={t(item.label)} isActive={isActive(item, pathname)}>
                    <NavLink to={item.to} viewTransition={transitionTo(item.to)} onClick={() => setOpenMobile(false)}>
                      <item.icon />
                      <span>{t(item.label)}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="gap-1 group-data-[collapsible=icon]:hidden">
        <p className="truncate px-2 text-xs text-muted-foreground" title={location.host}>
          {location.host}
        </p>
        {/* AGPL-3.0 section 13: whoever uses this dashboard over the network can reach its source from here */}
        <a
          href={SOURCE_URL}
          target="_blank"
          rel="noreferrer"
          className="px-2 text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
        >
          AGPL-3.0 · {t("footer.source")}
        </a>
      </SidebarFooter>
    </Sidebar>
  );
}
