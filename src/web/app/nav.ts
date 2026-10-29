import type { ComponentType } from "react";
import { ChartNoAxesColumn } from "@/shared/components/animate-ui/icons/chart-no-axes-column";
import { Cog } from "@/shared/components/animate-ui/icons/cog";
import { ListChecks } from "@/shared/components/animate-ui/icons/list-checks";
import { ScrollText } from "@/shared/components/animate-ui/icons/scroll-text";
import { ShieldBan } from "@/shared/components/animate-ui/icons/shield-ban";
import { Smartphone } from "@/shared/components/animate-ui/icons/smartphone";
import type { MessageKey } from "@/shared/i18n";

export interface NavItem {
  to: string;
  label: MessageKey;
  icon: ComponentType;
}

export const NAV: NavItem[] = [
  { to: "/", label: "nav.overview", icon: ChartNoAxesColumn },
  { to: "/logs", label: "nav.logs", icon: ScrollText },
  { to: "/filters", label: "nav.filters", icon: ListChecks },
  { to: "/rules", label: "nav.rules", icon: ShieldBan },
  { to: "/devices", label: "nav.devices", icon: Smartphone },
  { to: "/settings", label: "nav.settings", icon: Cog },
];

export function isActive(item: NavItem, pathname: string): boolean {
  return item.to === "/" ? pathname === "/" : pathname === item.to || pathname.startsWith(`${item.to}/`);
}

/** Header label of the current page; `/install` is reached only by deep link and has no nav entry */
export function pageLabel(pathname: string): MessageKey | undefined {
  if (pathname === "/install") return "nav.install";
  return NAV.find((item) => isActive(item, pathname))?.label;
}
