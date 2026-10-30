import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { listsApi } from "@/features/filters/api";
import { rulesApi } from "@/features/rules/api";
import { useRebuild } from "@/features/snapshot/api";
import { Download } from "@/shared/components/animate-ui/icons/download";
import { LoaderCircle } from "@/shared/components/animate-ui/icons/loader-circle";
import { Upload } from "@/shared/components/animate-ui/icons/upload";
import { ConfirmDialog } from "@/shared/components/confirm-dialog";
import { Row, Section } from "@/shared/components/form-section";
import { Button } from "@/shared/ui/button";
import { useI18n } from "@/shared/i18n";
import { errorMessage } from "@/shared/lib/http";
import { backupApi, splitBackup } from "./api";

type Busy = "export" | "import" | null;

/** Saves the whole server configuration to a file and restores it, replacing everything */
export function BackupCard({ id }: { id: string }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { rebuild } = useRebuild();
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<Busy>(null);

  const download = async () => {
    setBusy("export");
    try {
      const blob = await backupApi.export();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `edgedoh-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (err) {
      toast.error(t("backup.exportFailed"), { description: errorMessage(err, t) });
    } finally {
      setBusy(null);
    }
  };

  const restore = async (picked: File) => {
    setBusy("import");
    try {
      const { body, texts, customRules } = splitBackup(await picked.text());
      const result = await backupApi.import(body);
      // Texts and downloads go one request each, so every one stays inside its own CPU budget
      let unsaved = 0;
      for (const { id, text } of texts) await listsApi.setText(id, text).catch(() => unsaved++);
      if (customRules) await rulesApi.put(customRules).catch(() => unsaved++);
      const failed: string[] = [];
      for (const listId of result.pending) await listsApi.refresh(listId).catch(() => failed.push(listId));
      await queryClient.invalidateQueries();
      const problems = [
        ...(unsaved > 0 ? [t("backup.textsFailed", { count: unsaved })] : []),
        ...(failed.length > 0 ? [t("backup.listsFailed", { count: failed.length })] : []),
      ];
      toast.success(t("backup.imported", { count: result.devices }), {
        description: problems.length > 0 ? problems.join(" ") : t("backup.newEndpoints"),
      });
      await rebuild(t("backup.rebuildReason"));
    } catch (err) {
      toast.error(t("backup.importFailed"), { description: errorMessage(err, t) });
    } finally {
      setBusy(null);
      if (file.current) file.current.value = "";
    }
  };

  return (
    <Section id={id} title={t("settings.backup")} description={t("settings.backupDescription")}>
      <Row label={t("backup.export")} htmlFor="backup-export" inline>
        <Button id="backup-export" type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => void download()}>
          {busy === "export" ? <LoaderCircle animate /> : <Download />}
          {t("backup.exportAction")}
        </Button>
      </Row>
      <Row label={t("backup.import")} htmlFor="backup-import" inline>
        <ConfirmDialog
          title={t("backup.importConfirm")}
          description={t("backup.importConfirmDetail")}
          confirmLabel={t("backup.importAction")}
          onConfirm={() => file.current?.click()}
        >
          <Button id="backup-import" type="button" variant="outline" size="sm" disabled={busy !== null}>
            {busy === "import" ? <LoaderCircle animate /> : <Upload />}
            {t("backup.importAction")}
          </Button>
        </ConfirmDialog>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const picked = e.target.files?.[0];
            if (picked) void restore(picked);
          }}
        />
      </Row>
    </Section>
  );
}
