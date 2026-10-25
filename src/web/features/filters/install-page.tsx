import { Loader2, PackagePlus } from "lucide-react";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { PageHeader } from "@/shared/components/page";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { useI18n } from "@/shared/i18n";
import { listsApi } from "./api";
import { isHttpUrl } from "@/shared/lib/http";
import { useListAction } from "./use-list-action";

const BUSY_KEY = "deeplink";

/** Deep link `/install?url=…&title=…` for sharing a list from elsewhere; always asks before installing */
export function InstallPage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const actions = useListAction();
  const url = params.get("url") ?? "";
  const [name, setName] = useState(params.get("title") ?? "");
  const busy = actions.busy[BUSY_KEY];
  const valid = isHttpUrl(url);

  const install = async () => {
    const result = await actions.run(
      BUSY_KEY,
      t("filters.step.downloading"),
      () => listsApi.installUrl(url, name.trim() || undefined),
      t("filters.reason.add"),
    );
    if (result) navigate("/filters");
  };

  return (
    <>
      <PageHeader title={t("nav.install")} description={t("install.description")} />
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PackagePlus className="size-5" />
            {valid ? t("install.confirm") : t("install.invalid")}
          </CardTitle>
          <CardDescription className="break-all">{url || t("install.missingUrl")}</CardDescription>
        </CardHeader>
        {valid && (
          <CardContent className="space-y-2">
            <Label htmlFor="install-name">{t("common.name")}</Label>
            <Input id="install-name" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder={new URL(url).hostname} />
          </CardContent>
        )}
        <CardFooter className="justify-end gap-2">
          <Button variant="ghost" onClick={() => navigate("/filters")}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!valid || busy !== undefined} onClick={() => void install()}>
            {busy && <Loader2 className="animate-spin" />}
            {busy ?? t("common.install")}
          </Button>
        </CardFooter>
      </Card>
    </>
  );
}
