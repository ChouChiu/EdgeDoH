import { describe, expect, it } from "vitest";
import { enUS } from "./locales/en-US";
import { zhHans } from "./locales/zh-Hans";
import { zhHant } from "./locales/zh-Hant";
import type { Message, MessageKey } from "./messages";

const placeholders = (message: Message) => {
  const forms = typeof message === "string" ? [message] : [message.one, message.other];
  return forms.map((f) => [...f.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort());
};

describe("locale catalogs", () => {
  it.each([
    ["zh-Hant", zhHant],
    ["en-US", enUS],
  ])("%s uses the same placeholders as zh-Hans", (_, catalog) => {
    for (const key of Object.keys(zhHans) as MessageKey[]) {
      const expected = placeholders(zhHans[key])[0];
      for (const forms of placeholders(catalog[key])) expect({ key, forms }).toEqual({ key, forms: expected });
    }
  });
});
