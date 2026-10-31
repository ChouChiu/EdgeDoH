import { MAX_DEVICE_NAME } from "#contract";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { LoaderCircle } from "@/shared/components/animate-ui/icons/loader-circle";
import { Pencil } from "@/shared/components/animate-ui/icons/pencil";
import { Plus } from "@/shared/components/animate-ui/icons/plus";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { useI18n } from "@/shared/i18n";
import { errorMessage } from "@/shared/lib/http";
import { DEVICES_KEY, type Device, devicesApi } from "./api";

/** Creates a device, or renames `device` when given */
export function DeviceNameDialog({ device }: { device?: Device }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(device?.name ?? "");
  const save = useMutation({
    mutationFn: () => (device ? devicesApi.rename(device.id, name.trim()) : devicesApi.create(name.trim())),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: DEVICES_KEY });
      setOpen(false);
      if (!device) setName("");
      toast.success(t(device ? "devices.renamed" : "devices.created"));
    },
    onError: (err) => toast.error(t("common.saveFailed"), { description: errorMessage(err, t) }),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) save.mutate();
  };

  const onOpenChange = (next: boolean) => {
    // Reopening a rename dialog starts from the current name, not an abandoned draft
    if (next && device) setName(device.name);
    setOpen(next);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        {device ? (
          <Button variant="ghost" size="icon-sm" aria-label={t("common.rename")} title={t("common.rename")}>
            <Pencil />
          </Button>
        ) : (
          <Button>
            <Plus />
            {t("devices.add")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t(device ? "devices.renameTitle" : "devices.add")}</DialogTitle>
            <DialogDescription>{t("devices.nameHint")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="device-name">{t("common.name")}</Label>
            <Input
              id="device-name"
              required
              autoFocus
              maxLength={MAX_DEVICE_NAME}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("devices.namePlaceholder")}
              enterKeyHint="done"
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={save.isPending || !name.trim()}>
              {save.isPending && <LoaderCircle animate />}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
