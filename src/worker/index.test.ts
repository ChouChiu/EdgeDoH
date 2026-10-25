import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { api } from "./test/helpers.ts";

describe("API shell", () => {
  it("fails closed when Access is not configured and the host is not local", async () => {
    const res = await exports.default.fetch("https://dns.example.com/api/health");
    expect(res.status).toBe(503);
  });

  it("returns JSON errors for unknown routes and malformed bodies", async () => {
    const missing = await api("/nope");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "not found" });

    const malformed = await api("/settings", { method: "PATCH", body: "{" });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: "invalid JSON body" });
  });
});
