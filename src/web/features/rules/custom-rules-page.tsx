import { useQuery } from "@tanstack/react-query";
import { type KeyboardEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { LoaderCircle } from "@/shared/components/animate-ui/icons/loader-circle";
import { RotateCcw } from "@/shared/components/animate-ui/icons/rotate-ccw";
import { Save } from "@/shared/components/animate-ui/icons/save";
import { PageHeader, QueryError } from "@/shared/components/page";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardFooter } from "@/shared/ui/card";
import { Skeleton } from "@/shared/ui/skeleton";
import { Textarea } from "@/shared/ui/textarea";
import { useRebuild } from "@/features/snapshot/api";
import { useI18n } from "@/shared/i18n";
import { errorMessage } from "@/shared/lib/http";
import { CUSTOM_RULES_KEY, rulesApi } from "./api";
import { RuleTester } from "./rule-tester";

export function CustomRulesPage() {
  const { t } = useI18n();
  const rules = useQuery({ queryKey: CUSTOM_RULES_KEY, queryFn: rulesApi.get });
  const [text, setText] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { rebuild } = useRebuild();

  useEffect(() => {
    if (rules.data !== undefined) setText(rules.data);
  }, [rules.data]);

  const dirty = text !== null && rules.data !== undefined && text !== rules.data;
  useUnsavedGuard(dirty);

  const ruleCount = (text ?? "").split("\n").filter((l) => l.trim() && !/^[!#]/.test(l.trim())).length;

  const save = async () => {
    if (!dirty || saving || text === null) return;
    setSaving(true);
    try {
      await rulesApi.put(text);
      await rules.refetch();
      await rebuild(t("rules.saveReason"));
    } catch (err) {
      toast.error(t("common.saveFailed"), { description: errorMessage(err, t) });
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void save();
    }
  };

  return (
    <>
      <PageHeader
        title={t("nav.rules")}
        description={t("rules.description")}
        actions={
          <Button disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? <LoaderCircle animate /> : <Save />}
            {t("rules.saveApply")}
          </Button>
        }
      />
      {rules.error ? (
        <QueryError error={rules.error} />
      ) : (
        <Card className="overflow-visible!">
          <CardContent>
            {text === null ? (
              <Skeleton className="h-80 w-full" />
            ) : (
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={t("rules.example")}
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
                aria-label={t("nav.rules")}
                className="min-h-80 font-mono text-sm"
              />
            )}
          </CardContent>
          <CardFooter className="sticky bottom-keyboard z-10 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-b-xl bg-card/95 text-xs text-muted-foreground backdrop-blur">
            <span>{t("rules.count", { count: ruleCount })}</span>
            {dirty && <span className="text-foreground">{t("common.unsaved")}</span>}
            <span className="hidden sm:inline">{t("rules.shortcut")}</span>
            {dirty && (
              <div className="ml-auto flex gap-2">
                <Button variant="ghost" size="sm" disabled={saving} onClick={() => setText(rules.data!)}>
                  <RotateCcw />
                  {t("common.reset")}
                </Button>
                <Button size="sm" className="md:hidden" disabled={saving} onClick={() => void save()}>
                  {saving ? <LoaderCircle animate /> : <Save />}
                  {t("common.save")}
                </Button>
              </div>
            )}
          </CardFooter>
        </Card>
      )}
      <RuleTester />
    </>
  );
}

/** Asks before closing or reloading the tab while there are unsaved edits */
function useUnsavedGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
}
