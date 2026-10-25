import type { ComponentType } from "react";
import { DevicesPage } from "@/features/devices/devices-page";
import { FiltersPage } from "@/features/filters/filters-page";
import { InstallPage } from "@/features/filters/install-page";
import { CustomRulesPage } from "@/features/rules/custom-rules-page";
import { SettingsPage } from "@/features/settings/settings-page";
import { LogsPage } from "@/features/stats/logs-page";
import { OverviewPage } from "@/features/stats/overview-page";

/**
 * Every page ships in the main bundle, so a navigation renders synchronously: no loading fallback flashes between
 * pages and the page cross-fade captures the new page itself
 */
export const PAGES: { path: string; Page: ComponentType }[] = [
  { path: "/", Page: OverviewPage },
  { path: "/logs", Page: LogsPage },
  { path: "/filters", Page: FiltersPage },
  { path: "/install", Page: InstallPage },
  { path: "/rules", Page: CustomRulesPage },
  { path: "/devices", Page: DevicesPage },
  { path: "/settings", Page: SettingsPage },
];
