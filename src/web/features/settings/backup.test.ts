import { describe, expect, it } from "vitest";
import { splitBackup } from "./api";

describe("splitBackup", () => {
  it("takes inline texts and custom rules out of the import body", () => {
    const backup = {
      format: "edgedoh-backup",
      lists: [
        { id: "inline-a", source: "inline", text: "||a.test^\n" },
        { id: "inline-empty", source: "inline", text: "" },
        { id: "url-b", source: "url", url: "https://lists.test/b.txt" },
      ],
      customRules: "||custom.test^\n",
    };
    const { body, texts, customRules } = splitBackup(JSON.stringify(backup));
    expect(JSON.parse(body)).toEqual({
      format: "edgedoh-backup",
      lists: [
        { id: "inline-a", source: "inline" },
        { id: "inline-empty", source: "inline" },
        { id: "url-b", source: "url", url: "https://lists.test/b.txt" },
      ],
    });
    expect(texts).toEqual([{ id: "inline-a", text: "||a.test^\n" }]);
    expect(customRules).toBe("||custom.test^\n");
  });

  it("leaves files it cannot read for the Worker to reject", () => {
    for (const file of ["{", "[]", '{"lists":3}']) expect(splitBackup(file)).toEqual({ body: file, texts: [], customRules: "" });
    const odd = JSON.stringify({ lists: [{ id: "x", text: 5 }], customRules: 7 });
    expect(JSON.parse(splitBackup(odd).body)).toEqual(JSON.parse(odd));
  });
});
