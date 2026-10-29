import type { ComponentType } from "react";
import { ChartNoAxesColumn } from "@/shared/components/animate-ui/icons/chart-no-axes-column";
import { Cog } from "@/shared/components/animate-ui/icons/cog";
import { ListChecks } from "@/shared/components/animate-ui/icons/list-checks";
import { Network } from "@/shared/components/animate-ui/icons/network";
import { ScrollText } from "@/shared/components/animate-ui/icons/scroll-text";
import { ShieldBan } from "@/shared/components/animate-ui/icons/shield-ban";
import { Smartphone } from "@/shared/components/animate-ui/icons/smartphone";
import { Users } from "@/shared/components/animate-ui/icons/users";
import type { MessageKey } from "@/shared/i18n";

export interface NavItem {
  to: string;
  label: MessageKey;
  icon: ComponentType;
}

export interface NavGroup {
  label: MessageKey;
  items: NavItem[];
}

/**
 * Every page is one click away; the groups separate what you watch (traffic), what decides an answer (filtering) and
 * where answers go (resolution and devices). Settings sits apart at the foot of the sidebar
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "nav.group.traffic",
    items: [
      { to: "/", label: "nav.overview", icon: ChartNoAxesColumn },
      { to: "/logs", label: "nav.logs", icon: ScrollText },
    ],
  },
  {
    label: "nav.group.filtering",
    items: [
      { to: "/filters", label: "nav.filters", icon: ListChecks },
      { to: "/rules", label: "nav.rules", icon: ShieldBan },
      { to: "/profiles", label: "nav.profiles", icon: Users },
    ],
  },
  {
    label: "nav.group.network",
    items: [
      { to: "/dns", label: "nav.dns", icon: Network },
      { to: "/devices", label: "nav.devices", icon: Smartphone },
    ],
  },
];

export const SETTINGS_NAV: NavItem = { to: "/settings", label: "nav.settings", icon: Cog };

const NAV: NavItem[] = [...NAV_GROUPS.flatMap((group) => group.items), SETTINGS_NAV];

export function isActive(item: NavItem, pathname: string): boolean {
  return item.to === "/" ? pathname === "/" : pathname === item.to || pathname.startsWith(`${item.to}/`);
}

/** Header label of the current page; `/install` is reached only by deep link and has no nav entry */
export function pageLabel(pathname: string): MessageKey | undefined {
  if (pathname === "/install") return "nav.install";
  return NAV.find((item) => isActive(item, pathname))?.label;
}
