import { ChartNoAxesColumn, Cog, ListChecks, type LucideIcon, ScrollText, ShieldBan, Smartphone } from "lucide-react";
import type { MessageKey } from "@/shared/i18n";

export interface NavItem {
  to: string;
  label: MessageKey;
  icon: LucideIcon;
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
