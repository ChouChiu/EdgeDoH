import { AnimateIcon } from "@animate-ui/react/icons";
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
import { isActive, NAV_GROUPS, type NavItem, SETTINGS_NAV } from "./nav";

// A modified copy served to others has to offer them its own source, so a fork points this at its own repository
const SOURCE_URL = "https://github.com/ChouChiu/cf-dns";

export function AppSidebar() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const { setOpenMobile } = useSidebar();
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            {/* Same button geometry as the nav items, so the logo stays in their column when collapsed */}
            <SidebarMenuButton size="lg" asChild tooltip="cf-dns">
              <NavLink to="/" onClick={() => setOpenMobile(false)}>
                {/* The favicon itself, so the tab and the sidebar never drift apart */}
                <img src="/favicon.svg" alt="" className="size-8 shrink-0" />
                <span className="font-semibold">cf-dns</span>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent className="gap-0">
        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group[0]!.to} className="py-1.5">
            <SidebarGroupContent>
              <SidebarMenu>
                {group.map((item) => (
                  <NavEntry key={item.to} item={item} pathname={pathname} onNavigate={() => setOpenMobile(false)} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="gap-1">
        <SidebarMenu>
          <NavEntry item={SETTINGS_NAV} pathname={pathname} onNavigate={() => setOpenMobile(false)} />
        </SidebarMenu>
        <div className="flex flex-col gap-1 pt-1 group-data-[collapsible=icon]:hidden">
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
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

function NavEntry({ item, pathname, onNavigate }: { item: NavItem; pathname: string; onNavigate: () => void }) {
  const { t } = useI18n();
  return (
    <SidebarMenuItem>
      <AnimateIcon asChild animateOnHover>
        <SidebarMenuButton asChild tooltip={t(item.label)} isActive={isActive(item, pathname)}>
          <NavLink to={item.to} onClick={onNavigate}>
            <item.icon />
            <span>{t(item.label)}</span>
          </NavLink>
        </SidebarMenuButton>
      </AnimateIcon>
    </SidebarMenuItem>
  );
}
