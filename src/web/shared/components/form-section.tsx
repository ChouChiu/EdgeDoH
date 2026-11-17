import { cn } from "cn";
import { type ComponentProps, type ReactNode } from "react";
import { LoaderCircle } from "@/shared/components/animate-ui/icons/loader-circle";
import { RotateCcw } from "@/shared/components/animate-ui/icons/rotate-ccw";
import { Save } from "@/shared/components/animate-ui/icons/save";
import { type UnsavedGuard, useSaveShortcut, useUnsavedGuard } from "@/shared/hooks/use-unsaved-guard";
import { useI18n } from "@/shared/i18n";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Label } from "@/shared/ui/label";
import { Textarea } from "@/shared/ui/textarea";

/** `id` makes the section a jump target; the scroll margin keeps its title clear of the sticky header */
export function Section({ id, title, description, children }: { id?: string; title: string; description?: string; children: ReactNode }) {
  return (
    <Card id={id} size="sm" className="scroll-mt-[calc(4rem+env(safe-area-inset-top))] gap-0 pb-0">
      <CardHeader className="border-b pb-3">
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription className="text-xs">{description}</CardDescription>}
      </CardHeader>
      <CardContent className="divide-y">{children}</CardContent>
    </Card>
  );
}

interface RowProps {
  label: string;
  hint?: string | undefined;
  hintError?: boolean;
  htmlFor: string;
  /** Small controls such as switches stay beside the label even on phones */
  inline?: boolean;
  children: ReactNode;
}

/** Label and hint on the left, the control on the right; wider controls stack under the label on narrow screens */
export function Row({ label, hint, hintError, htmlFor, inline, children }: RowProps) {
  return (
    <div className={inline ? "flex items-center justify-between gap-4 py-2.5" : "flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4"}>
      <div className="min-w-0 space-y-0.5">
        <Label htmlFor={htmlFor}>{label}</Label>
        {hint && <p className={hintError ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

type ListFieldProps = Omit<ComponentProps<typeof Textarea>, "id" | "value" | "onChange"> & {
  id: string;
  label: string;
  hint?: string | undefined;
  /** Replaces the hint while set */
  error?: string | undefined;
  value: string;
  onChange: (value: string) => void;
};

/** Monospace text area for entries such as URLs or domains, one per line, with its hint or error below */
export function ListField({ id, label, hint, error, value, onChange, className, ...textarea }: ListFieldProps) {
  const note = error ?? hint;
  return (
    <div className={cn("grid gap-2", className)}>
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
        aria-invalid={error !== undefined}
        aria-describedby={note ? `${id}-hint` : undefined}
        className="font-mono text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...textarea}
      />
      {note && (
        <p id={`${id}-hint`} className={error ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
          {note}
        </p>
      )}
    </div>
  );
}

export function UnsavedChangesDialog({ guard }: { guard: UnsavedGuard }) {
  const { t } = useI18n();
  return (
    <AlertDialog open={guard.blocked} onOpenChange={(open) => !open && guard.stay()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("common.leavePageTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("common.leavePageBody")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={guard.stay}>{t("common.stay")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={guard.leave}>
            {t("common.discard")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Sticky form footer with unsaved indicator, Reset and Save buttons, plus Ctrl/Cmd+S and navigation guard */
export function SaveBar({
  dirty,
  saving,
  invalid,
  onReset,
  onSave,
}: {
  dirty: boolean;
  saving: boolean;
  invalid?: boolean;
  onReset: () => void;
  onSave?: () => void;
}) {
  const { t } = useI18n();
  const guard = useUnsavedGuard(dirty);
  useSaveShortcut(dirty && !saving && !invalid, onSave);

  return (
    <>
      <UnsavedChangesDialog guard={guard} />
      <div className="sticky bottom-keyboard-float z-10 flex items-center justify-end gap-2 rounded-xl border bg-card/95 px-3 py-2 shadow-sm backdrop-blur">
        {dirty && (
          <span role="status" className="mr-auto text-xs text-muted-foreground">
            {t("common.unsaved")}
          </span>
        )}
        <Button type="button" variant="ghost" disabled={!dirty || saving} onClick={onReset}>
          <RotateCcw />
          {t("common.reset")}
        </Button>
        <Button type="submit" disabled={!dirty || saving || invalid}>
          {saving ? <LoaderCircle animate /> : <Save />}
          {t("common.save")}
        </Button>
      </div>
    </>
  );
}
