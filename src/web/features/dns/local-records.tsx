import { RECORD_TYPES, type RecordType } from "#contract";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus } from "@/shared/components/animate-ui/icons/plus";
import { X } from "@/shared/components/animate-ui/icons/x";
import { SaveBar } from "@/shared/components/form-section";
import { QueryError } from "@/shared/components/page";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Skeleton } from "@/shared/ui/skeleton";
import { useI18n } from "@/shared/i18n";
import { errorMessage } from "@/shared/lib/http";
import { type LocalRecord, RECORDS_KEY, recordsApi, useLocalRecords } from "./api";

const PLACEHOLDER: Record<RecordType, string> = { A: "192.168.1.20", AAAA: "fd00::20", CNAME: "nas.lan" };

/** Edited as one table and saved as a whole, like the server stores it */
export function LocalRecords() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const records = useLocalRecords();
  const [draft, setDraft] = useState<LocalRecord[] | null>(null);
  useEffect(() => {
    if (records.data) setDraft(records.data);
  }, [records.data]);

  const save = useMutation({
    mutationFn: (next: LocalRecord[]) => recordsApi.replace(next.filter((r) => r.name.trim() || r.value.trim())),
    onSuccess: (data) => {
      queryClient.setQueryData(RECORDS_KEY, data);
      toast.success(t("settings.saved"), { description: t("settings.savedDetail") });
    },
    onError: (err) => toast.error(t("common.saveFailed"), { description: errorMessage(err, t) }),
  });

  if (records.error) return <QueryError error={records.error} onRetry={() => void records.refetch()} />;
  if (!draft || !records.data) return <Skeleton className="h-40 w-full" />;

  const update = (i: number, patch: Partial<LocalRecord>) => setDraft(draft.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const dirty = JSON.stringify(draft) !== JSON.stringify(records.data);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(draft);
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <Card size="sm">
        <CardContent className="space-y-2">
          {draft.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">{t("dns.recordsEmpty")}</p>}
          {draft.map((r, i) => (
            <div key={i} className="grid grid-cols-[6rem_minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,2fr)_6rem_minmax(0,2fr)_auto]">
              <Input
                aria-label={t("dns.recordName")}
                className="col-span-3 font-mono text-sm sm:col-span-1"
                placeholder="nas.lan / *.home.lan"
                autoCapitalize="none"
                spellCheck={false}
                value={r.name}
                onChange={(e) => update(i, { name: e.target.value })}
              />
              <Select value={r.type} onValueChange={(v) => update(i, { type: v as RecordType })}>
                <SelectTrigger aria-label={t("dns.recordType")} className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RECORD_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                aria-label={t("dns.recordValue")}
                className="font-mono text-sm"
                placeholder={PLACEHOLDER[r.type]}
                autoCapitalize="none"
                spellCheck={false}
                value={r.value}
                onChange={(e) => update(i, { value: e.target.value })}
              />
              <Button type="button" variant="ghost" size="icon" aria-label={t("common.delete")} title={t("common.delete")} onClick={() => setDraft(draft.filter((_, j) => j !== i))}>
                <X />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => setDraft([...draft, { name: "", type: "A", value: "" }])}>
            <Plus />
            {t("dns.addRecord")}
          </Button>
        </CardContent>
      </Card>
      <SaveBar
        dirty={dirty}
        saving={save.isPending}
        onReset={() => setDraft(records.data)}
        onSave={() => dirty && !save.isPending && save.mutate(draft)}
      />
    </form>
  );
}
