import { MAX_LIST_NAME } from "#contract";
import { type FormEvent, useState } from "react";
import { LoaderCircle } from "@/shared/components/animate-ui/icons/loader-circle";
import { Plus } from "@/shared/components/animate-ui/icons/plus";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { useI18n } from "@/shared/i18n";
import { type ListActions, listsApi } from "./api";

const BUSY_KEY = "new-url";

export function AddUrlDialog({ actions }: { actions: ListActions }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const busy = actions.busy[BUSY_KEY];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const result = await actions.run(
      BUSY_KEY,
      t("filters.step.downloading"),
      () => listsApi.installUrl(url.trim(), name.trim() || undefined),
      t("filters.reason.add"),
    );
    if (result) {
      setOpen(false);
      setUrl("");
      setName("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus />
          {t("filters.addUrl")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("filters.addTitle")}</DialogTitle>
            <DialogDescription>{t("filters.addDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="list-url">{t("filters.url")}</Label>
            <Input
              id="list-url"
              type="url"
              required
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/filter.txt"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="next"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="list-name">{t("filters.nameOptional")}</Label>
            <Input id="list-name" maxLength={MAX_LIST_NAME} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("filters.namePlaceholder")} enterKeyHint="done" />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy !== undefined}>
              {busy && <LoaderCircle animate />}
              {busy ?? t("common.install")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
