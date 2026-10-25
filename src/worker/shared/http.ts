import type { Context } from "hono";
import { Hono } from "hono/quick";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export type AppEnv = { Bindings: Env };

/** LinearRouter (`hono/quick`) skips the route compilation the default router does on its first request */
export function router(): Hono<AppEnv> {
  return new Hono<AppEnv>();
}

/** Thrown anywhere under `/api`; the API error handler turns it into `{ error }` with this status */
export class HttpError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    message: string,
  ) {
    super(message);
  }
}

export async function readJson(c: Context<AppEnv>): Promise<unknown> {
  try {
    return await c.req.json<unknown>();
  } catch {
    throw new HttpError(400, "invalid JSON body");
  }
}

export async function readJsonObject(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  const body = await readJson(c);
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new HttpError(400, "expected a JSON object");
  return body as Record<string, unknown>;
}

/** Reads a request body, refusing more than `max` bytes even when no content-length was sent */
export async function readBody(request: Request, max: number): Promise<Uint8Array> {
  if (Number(request.headers.get("content-length")) > max) throw new HttpError(413, `body exceeds ${max} bytes`);
  if (!request.body) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of request.body) {
    size += chunk.byteLength;
    if (size > max) throw new HttpError(413, `body exceeds ${max} bytes`);
    chunks.push(chunk);
  }
  if (chunks.length === 1) return chunks[0]!;
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export function isHttpUrl(value: string, protocols: readonly string[] = ["https:", "http:"]): boolean {
  try {
    return protocols.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
