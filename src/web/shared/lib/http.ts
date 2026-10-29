export { isHttpUrl } from "#contract";
import type { Translate } from "@/shared/i18n/messages";

/** Non-2xx API answer; `message` is the server's own English error text, when it sent one */
export class ApiError extends Error {
  readonly status: number;
  readonly serverMessage: string | undefined;

  constructor(status: number, serverMessage?: string) {
    super(serverMessage ?? `HTTP ${status}`);
    this.status = status;
    this.serverMessage = serverMessage;
  }
}

/** The Cloudflare Access session expired and the API answered with a login redirect */
export class SessionExpiredError extends ApiError {
  constructor() {
    super(401);
  }
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, { ...init, redirect: "manual" });
  if (res.type === "opaqueredirect" || res.status === 0) throw new SessionExpiredError();
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const error = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : undefined;
    throw new ApiError(res.status, error);
  }
  if (res.status === 204) return undefined as T;
  const type = res.headers.get("content-type") ?? "";
  return (type.includes("application/json") ? res.json() : res.text()) as Promise<T>;
}

export function jsonBody(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

export function queryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") search.set(k, String(v));
  const s = search.toString();
  return s ? `?${s}` : "";
}

/** User-facing text for any thrown value, localised where the client knows better than the server */
export function errorMessage(err: unknown, t: Translate): string {
  if (err instanceof SessionExpiredError) return t("errors.sessionExpired");
  if (err instanceof ApiError) return err.serverMessage ?? t("errors.http", { status: err.status });
  return err instanceof Error ? err.message : String(err);
}
