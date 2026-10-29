import type { ListMeta } from "#filter";
import { useQuery } from "@tanstack/react-query";
import { CUSTOM_LIST_ID } from "@/features/rules/api";
import { useI18n } from "@/shared/i18n";
import { jsonBody, request } from "@/shared/lib/http";

export interface FilterList {
  id: string;
  name: string;
  /** Empty for inline lists */
  url: string;
  source: "registry" | "url" | "inline";
  /** route: a split-DNS domain list, managed on the DNS page */
  kind: "filter" | "route";
  /** Route lists only */
  upstreams: string[] | null;
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
  addRoute: (body: { name?: string; upstreams: string[] } & ({ url: string } | { text: string })) =>
    request<FilterList>("/lists", jsonBody("POST", { ...body, kind: "route" })),
  update: (id: string, patch: { enabled?: boolean; name?: string; upstreams?: string[] }) => request<FilterList>(`/lists/${id}`, jsonBody("PATCH", patch)),
  setText: (id: string, text: string) => request<FilterList>(`/lists/${id}/text`, { method: "PUT", headers: { "content-type": "text/plain" }, body: text }),
  refresh: (id: string) => request<FilterList>(`/lists/${id}/refresh`, { method: "POST" }),
  remove: (id: string) => request<void>(`/lists/${id}`, { method: "DELETE" }),
  text: (id: string) => request<string>(`/lists/${id}/text`),
  reports: (reports: CompileReport[]) => request<void>("/lists/reports", jsonBody("POST", reports)),
  catalog: () => request<Catalog>("/catalog"),
};

const filterLists = (lists: FilterList[]) => lists.filter((l) => l.kind !== "route");
const routeLists = (lists: FilterList[]) => lists.filter((l) => l.kind === "route");

/** Filter lists only; route lists share the query but live on the DNS page */
export function useLists() {
  return useQuery({ queryKey: LISTS_KEY, queryFn: listsApi.list, select: filterLists });
}

export function useRouteLists() {
  return useQuery({ queryKey: LISTS_KEY, queryFn: listsApi.list, select: routeLists });
}

/** Display name for a list ID as stored in rules and logs; unknown IDs (since uninstalled) stay as they are */
export function useListName(): (id: string) => string {
  const { t } = useI18n();
  const lists = useQuery({ queryKey: LISTS_KEY, queryFn: listsApi.list });
  return (id) => {
    if (id === CUSTOM_LIST_ID) return t("rebuild.customList");
    if (id === "safesearch") return t("profiles.safeSearch");
    if (id === "local") return t("dns.records");
    return lists.data?.find((l) => l.id === id)?.name ?? id;
  };
}
