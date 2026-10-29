import { describe, expect, it } from "vitest";
import { mergeCatalogs } from "./api";

describe("mergeCatalogs", () => {
  it("adds a later catalog's rules to a known service and drops invalid entries", () => {
    const adguard = { services: [{ id: "youtube", name: "YouTube", group: "streaming", icon: "<svg/>", rules: ["||youtube.com^"] }] };
    const community = {
      services: [
        { id: "youtube", name: "YouTube", group: "other", icon: "", rules: ["||youtube.com^", "||ytimg.com^"] },
        { id: "github", name: "GitHub", group: "other", icon: "", rules: ["||github.com^"] },
        { id: "Bad ID", name: "x", rules: [] },
      ],
    };
    expect(mergeCatalogs([adguard, community, null])).toEqual([
      { id: "youtube", name: "YouTube", group: "streaming", icon: "<svg/>", rules: ["||youtube.com^", "||ytimg.com^"] },
      { id: "github", name: "GitHub", group: "other", icon: "", rules: ["||github.com^"] },
    ]);
  });
});
