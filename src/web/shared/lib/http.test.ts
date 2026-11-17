import { afterEach, describe, expect, it, vi } from "vitest";
import type { Translate } from "@/shared/i18n/messages";
import { ApiError, errorMessage, jsonBody, queryString, request, SessionExpiredError } from "./http";

const t: Translate = (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key);

describe("http helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds query strings while skipping empty and undefined values", () => {
    expect(queryString({ range: "24h", search: "", device: undefined, page: 2 })).toBe("?range=24h&page=2");
    expect(queryString({ empty: "", missing: undefined })).toBe("");
  });

  it("builds JSON request init", () => {
    expect(jsonBody("POST", { ok: true })).toEqual({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"ok":true}',
    });
  });

  it("formats errors for display", () => {
    expect(errorMessage(new SessionExpiredError(), t)).toBe("errors.sessionExpired");
    expect(errorMessage(new ApiError(400, "bad input"), t)).toBe("bad input");
    expect(errorMessage(new ApiError(502), t)).toBe('errors.http:{"status":502}');
    expect(errorMessage(new Error("boom"), t)).toBe("boom");
  });

  it("parses JSON, text, 204, errors, and Access redirects in request()", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/json") return new Response(JSON.stringify({ a: 1 }), { headers: { "content-type": "application/json" } });
        if (url === "/api/text") return new Response("hello", { headers: { "content-type": "text/plain" } });
        if (url === "/api/empty") return new Response(null, { status: 204 });
        if (url === "/api/bad") return new Response(JSON.stringify({ error: "invalid" }), { status: 400, headers: { "content-type": "application/json" } });
        return { type: "opaqueredirect", status: 0 } as Response;
      }),
    );

    expect(await request<{ a: number }>("/json")).toEqual({ a: 1 });
    expect(await request<string>("/text")).toBe("hello");
    expect(await request<void>("/empty")).toBeUndefined();
    await expect(request("/bad")).rejects.toMatchObject({ status: 400, serverMessage: "invalid" });
    await expect(request("/redirect")).rejects.toBeInstanceOf(SessionExpiredError);
  });
});
