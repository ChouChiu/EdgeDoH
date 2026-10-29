import { useQuery } from "@tanstack/react-query";
import { jsonBody, request } from "@/shared/lib/http";

export const RECORD_TYPES = ["A", "AAAA", "CNAME"] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

export interface LocalRecord {
  name: string;
  type: RecordType;
  value: string;
}

export const RECORDS_KEY = ["local-records"];

export const recordsApi = {
  list: () => request<LocalRecord[]>("/local-records"),
  replace: (records: LocalRecord[]) => request<LocalRecord[]>("/local-records", jsonBody("PUT", records)),
};

export function useLocalRecords() {
  return useQuery({ queryKey: RECORDS_KEY, queryFn: recordsApi.list });
}
