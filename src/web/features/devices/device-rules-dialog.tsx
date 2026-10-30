import { isDomain } from "#filter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { useRebuild } from "@/features/snapshot/api";
import { ActionBadge } from "@/shared/components/action-badge";
import { ListChecks } from "@/shared/components/animate-ui/icons/list-checks";
import { LoaderCircle } from "@/shared/components/animate-ui/icons/loader-circle";
import { Plus } from "@/shared/components/animate-ui/icons/plus";
import { X } from "@/shared/components/animate-ui/icons/x";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { useI18n } from "@/shared/i18n";
import { errorMessage } from "@/shared/lib/http";
import { type Device, type DeviceOverride, deviceRulesKey, devicesApi, MAX_DEVICE_RULES } from "./api";

const normalise = (name: string) => name.trim().toLowerCase().replace(/\.$/, "");

/** Allow and block overrides for one device, applied whatever its profile's lists */
export function DeviceRulesDialog({ device }: { device: Device }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { rebuild } = useRebuild();
  const [open, setOpen] = useState(false);
  const saved = useQuery({ queryKey: deviceRulesKey(device.id), queryFn: () => devicesApi.rules(device.id) });
  const [draft, setDraft] = useState<DeviceOverride[] | null>(null);
  const [name, setName] = useState("");
  const [action, setAction] = useState<DeviceOverride["action"]>("block");
  const rules = draft ?? saved.data ?? [];

  const save = useMutation({
    mutationFn: () => devicesApi.setRules(device.id, rules),
    onSuccess: async (stored) => {
      queryClient.setQueryData(deviceRulesKey(device.id), stored);
      setOpen(false);
      await rebuild(t("devices.rulesReason", { name: device.name }));
    },
    onError: (err) => toast.error(t("common.saveFailed"), { description: errorMessage(err, t) }),
  });

  const candidate = normalise(name);
  const invalid = candidate !== "" && !isDomain(candidate);
  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!candidate || invalid) return;
    setDraft([{ name: candidate, action }, ...rules.filter((r) => r.name !== candidate)]);
    setName("");
  };

  const onOpenChange = (next: boolean) => {
    // Reopening starts from the stored rules, not an abandoned draft
    if (next) setDraft(null);
    setOpen(next);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <ListChecks />
          {t("devices.rules")}
          {saved.data && saved.data.length > 0 && <span className="tabular-nums text-muted-foreground">{saved.data.length}</span>}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("devices.rulesTitle", { name: device.name })}</DialogTitle>
          <DialogDescription>{t("devices.rulesHint")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={add} className="flex gap-2">
          <Input
            aria-label={t("devices.rulesDomain")}
            placeholder="example.com"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={invalid || undefined}
            enterKeyHint="done"
            className="font-mono"
          />
          <Select value={action} onValueChange={(v) => setAction(v as DeviceOverride["action"])}>
            <SelectTrigger className="w-28 shrink-0" aria-label={t("common.actions")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="block">{t("devices.rulesBlock")}</SelectItem>
              <SelectItem value="allow">{t("devices.rulesAllow")}</SelectItem>
            </SelectContent>
          </Select>
          <Button type="submit" variant="outline" size="icon" disabled={!candidate || invalid || rules.length >= MAX_DEVICE_RULES} aria-label={t("devices.rulesAdd")}>
            <Plus />
          </Button>
        </form>
        {rules.length > 0 && (
          <ul className="max-h-72 divide-y overflow-y-auto rounded-md border">
            {rules.map((r) => (
              <li key={r.name} className="flex items-center gap-2 px-3 py-1.5">
                <ActionBadge action={r.action} />
                <code className="min-w-0 flex-1 truncate text-xs">{r.name}</code>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("common.delete")}
                  onClick={() => setDraft(rules.filter((x) => x.name !== r.name))}
                >
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button onClick={() => save.mutate()} disabled={save.isPending || draft === null}>
            {save.isPending && <LoaderCircle animate />}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
