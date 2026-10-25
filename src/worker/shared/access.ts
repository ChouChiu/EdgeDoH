import type { MiddlewareHandler } from "hono";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AppEnv } from "./http.ts";

type JwkSet = ReturnType<typeof createRemoteJWKSet>;
const jwkSets = new Map<string, JwkSet>();

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Verifies the Cloudflare Access JWT on every request. Fails closed when Access is not configured.
 * `ACCESS_DEV_BYPASS` is honoured only for requests addressed to localhost
 */
export const requireAccess: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.env.ACCESS_DEV_BYPASS === "true" && LOCAL_HOSTS.has(new URL(c.req.url).hostname)) {
    return next();
  }

  const team = c.env.ACCESS_TEAM_DOMAIN;
  const audience = c.env.ACCESS_AUD;
  if (!team || !audience) return c.json({ error: "Cloudflare Access is not configured" }, 503);

  const token = c.req.header("cf-access-jwt-assertion");
  if (!token) return c.json({ error: "missing Access token" }, 401);

  try {
    await jwtVerify(token, jwkSet(team), { issuer: `https://${team}`, audience });
  } catch {
    return c.json({ error: "invalid Access token" }, 403);
  }
  return next();
};

function jwkSet(team: string): JwkSet {
  let set = jwkSets.get(team);
  if (!set) {
    set = createRemoteJWKSet(new URL(`https://${team}/cdn-cgi/access/certs`));
    jwkSets.set(team, set);
  }
  return set;
}
