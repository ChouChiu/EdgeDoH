import type { zhHans } from "./locales/zh-Hans";

export type MessageKey = keyof typeof zhHans;
/** A plain string, or plural forms picked by `Intl.PluralRules` from the `count` parameter */
export type Message = string | { one: string; other: string };
export type Messages = Record<MessageKey, Message>;
export type Params = Record<string, string | number>;
export type Translate = (key: MessageKey, params?: Params) => string;
