import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Label } from "@/shared/ui/label";

export function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card size="sm" className="gap-0 pb-0">
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
