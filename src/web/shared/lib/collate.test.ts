import { describe, expect, it } from "vitest";
import { compareNames } from "./collate";

describe("compareNames", () => {
  it("files Chinese names under their pinyin initial among Latin names", () => {
    const names = ["Qwen", "旷视", "OpenAI", "aiXcoder", "科大讯飞", "第四范式", "Claude", "優酷", "12306", "Anthropic"];
    expect(names.sort(compareNames)).toEqual(["12306", "aiXcoder", "Anthropic", "Claude", "第四范式", "科大讯飞", "旷视", "OpenAI", "Qwen", "優酷"]);
  });
});
