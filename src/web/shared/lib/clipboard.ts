import { toast } from "sonner";
import type { Translate } from "@/shared/i18n/messages";

/** The Clipboard API rejects on insecure origins and without focus, so failures get their own toast */
export async function copyText(text: string, t: Translate, success = t("common.copied")): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(success);
  } catch {
    toast.error(t("common.copyFailed"));
  }
}
