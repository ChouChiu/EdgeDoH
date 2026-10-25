import type { ListMeta } from "#filter";
import { useQuery } from "@tanstack/react-query";
import { CUSTOM_LIST_ID } from "@/features/rules/api";
import { useI18n } from "@/shared/i18n";
import { jsonBody, request } from "@/shared/lib/http";

export interface FilterList {
  id: string;
  name: string;
  url: string;
  source: "registry" | "url";
  registryId: number | null;
  enabled: boolean;
  rules: number | null;
  unsupported: number | null;
  reasons: Record<string, number> | null;
  meta: ListMeta | null;
  fetchedAt: number | null;
  compiledAt: number | null;
  createdAt: number;
}

export interface CompileReport {
  id: string;
  rules: number;
  unsupported: number;
  reasons: Record<string, number>;
}

export interface CatalogFilter {
  filterId: number;
  filterKey: string;
  groupId: number;
  name: string;
  description: string;
  homepage?: string;
  downloadUrl: string;
  tags: number[];
  languages: string[];
  timeUpdated?: string;
  deprecated?: boolean;
  displayNumber: number;
}

export interface Catalog {
  filters: CatalogFilter[];
  groups: { groupId: number; groupName: string; displayNumber: number }[];
  tags: { tagId: number; keyword: string }[];
}

export const LISTS_KEY = ["lists"];

export const listsApi = {
  list: () => request<FilterList[]>("/lists"),
  installRegistry: (registryId: number) => request<FilterList>("/lists", jsonBody("POST", { registryId })),
  installUrl: (url: string, name?: string) => request<FilterList>("/lists", jsonBody("POST", { url, name })),
  update: (id: string, patch: { enabled?: boolean; name?: string }) => request<FilterList>(`/lists/${id}`, jsonBody("PATCH", patch)),
  refresh: (id: string) => request<FilterList>(`/lists/${id}/refresh`, { method: "POST" }),
  remove: (id: string) => request<void>(`/lists/${id}`, { method: "DELETE" }),
  text: (id: string) => request<string>(`/lists/${id}/text`),
  reports: (reports: CompileReport[]) => request<void>("/lists/reports", jsonBody("POST", reports)),
  catalog: () => request<Catalog>("/catalog"),
};

export function useLists() {
  return useQuery({ queryKey: LISTS_KEY, queryFn: listsApi.list });
}

/** Display name for a list ID as stored in rules and logs; unknown IDs (since uninstalled) stay as they are */
export function useListName(): (id: string) => string {
  const { t } = useI18n();
  const lists = useLists();
  return (id) => (id === CUSTOM_LIST_ID ? t("rebuild.customList") : (lists.data?.find((l) => l.id === id)?.name ?? id));
}
