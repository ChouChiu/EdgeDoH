import { FlaskConical, Loader2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { ActionBadge } from "@/shared/components/action-badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { useDevices } from "@/features/devices/api";
import { useI18n } from "@/shared/i18n";
import { errorMessage } from "@/shared/lib/http";
import { Rcode } from "#dns";
import { useListName } from "@/features/filters/api";
import { rulesApi } from "./api";

const QUERY_TYPES = ["A", "AAAA", "CNAME", "HTTPS", "TXT", "MX"];
const ANY_DEVICE = "any";
const RCODE_NAMES = Object.fromEntries(Object.entries(Rcode).map(([name, code]) => [code, name]));

export function RuleTester() {
  const { t, rich } = useI18n();
  const devices = useDevices();
  const listName = useListName();
  const [name, setName] = useState("");
  const [type, setType] = useState("A");
  const [device, setDevice] = useState(ANY_DEVICE);
  const [result, setResult] = useState<Awaited<ReturnType<typeof rulesApi.test>> | null>(null);
  const [testing, setTesting] = useState(false);

  const test = async (e: FormEvent) => {
    e.preventDefault();
    setTesting(true);
    try {
      setResult(await rulesApi.test(name.trim(), type, device === ANY_DEVICE ? undefined : device));
    } catch (err) {
      toast.error(t("tester.failed"), { description: errorMessage(err, t) });
    } finally {
      setTesting(false);
    }
  };

  const verdict = result?.verdict;
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{t("tester.title")}</CardTitle>
        <CardDescription>{t("tester.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form onSubmit={test} className="flex flex-wrap gap-2">
          <Input
            required
            className="min-w-48 flex-1"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("tester.placeholder")}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="url"
            enterKeyHint="go"
            aria-label={t("logs.col.name")}
          />
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="w-24" aria-label={t("tester.type")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {QUERY_TYPES.map((q) => (
                <SelectItem key={q} value={q}>
                  {q}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={device} onValueChange={setDevice}>
            <SelectTrigger className="w-36" aria-label={t("logs.col.device")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_DEVICE}>{t("tester.anyDevice")}</SelectItem>
              {devices.data?.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="submit" variant="outline" disabled={testing}>
            {testing ? <Loader2 className="animate-spin" /> : <FlaskConical />}
            {t("tester.run")}
          </Button>
        </form>
        {verdict && (
          <div className="space-y-2 rounded-lg border p-3 text-sm" aria-live="polite">
            <div className="flex items-center gap-2">
              <span className="font-medium">{result.name}</span>
              <span className="text-muted-foreground">{result.type}</span>
              <ActionBadge action={verdict.action} />
            </div>
            {"rule" in verdict && (
              <p className="text-muted-foreground">
                {rich("tester.matched", {
                  rule: <code className="rounded bg-muted px-1 text-foreground">{verdict.rule.text}</code>,
                  source: t("logs.ruleSource", {
                    list: listName(verdict.rule.listId),
                    line: verdict.rule.line,
                  }),
                })}
              </p>
            )}
            {verdict.action === "rewrite" && (
              <p className="text-muted-foreground">
                {t("tester.answer", {
                  value:
                    verdict.records.length > 0
                      ? verdict.records.map((r) => r.value).join(t("common.listSeparator"))
                      : t("tester.noRecords", { rcode: RCODE_NAMES[verdict.rcode] ?? String(verdict.rcode) }),
                })}
              </p>
            )}
            {verdict.action === "pass" && <p className="text-muted-foreground">{t("tester.passed")}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
