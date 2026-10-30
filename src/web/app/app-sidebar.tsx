import { AnimateIcon } from "@animate-ui/react/icons";
import { NavLink, useLocation } from "react-router";
import { ExternalLink } from "@/shared/components/animate-ui/icons/external-link";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/shared/ui/sidebar";
import { useI18n } from "@/shared/i18n";
import { isActive, NAV_GROUPS, type NavItem, SETTINGS_NAV } from "./nav";

// A modified copy served to others has to offer them its own source, so a fork points this at its own repository
const SOURCE_URL = "https://github.com/ChouChiu/EdgeDoH";

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
            <SidebarMenuButton size="lg" asChild tooltip="EdgeDoH">
              <NavLink to="/" onClick={() => setOpenMobile(false)}>
                {/* The favicon itself, so the tab and the sidebar never drift apart */}
                <img src="/favicon.svg" alt="" className="size-8 shrink-0" />
                <span className="font-semibold">EdgeDoH</span>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent className="gap-0">
        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.label} className="py-1">
            {/* Collapsed to icons, the label fades out and the gap between groups is what remains */}
            <SidebarGroupLabel>{t(group.label)}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
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
        {/* Where this dashboard runs and where its source is, as one quiet line under the last entry */}
        <div className="mx-2 flex items-center justify-between gap-2 border-t border-sidebar-border pt-2.5 pb-0.5 group-data-[collapsible=icon]:hidden">
          <span className="type-meta truncate" title={location.host}>
            {location.host}
          </span>
          {/* AGPL-3.0 section 13: whoever uses this dashboard over the network can reach its source from here */}
          <AnimateIcon asChild animateOnHover>
            <a
              href={SOURCE_URL}
              target="_blank"
              rel="noreferrer"
              title={`AGPL-3.0 · ${t("footer.source")}`}
              aria-label={`AGPL-3.0 · ${t("footer.source")}`}
              className="type-meta flex shrink-0 items-center gap-1 rounded-sm outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            >
              AGPL-3.0
              <ExternalLink className="size-3" />
            </a>
          </AnimateIcon>
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
