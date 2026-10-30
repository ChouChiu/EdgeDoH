#!/usr/bin/env bun
// One-click deployment: `bun run setup` finds or creates every Cloudflare resource wrangler.jsonc binds, writes their
// IDs back, collects the secrets, applies the D1 migrations and deploys. Safe to run again: existing resources and
// answers saved in .env.deploy / .env.production are reused, so a second run is just a deploy
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseEnv } from "node:util";

const ROOT = resolve(import.meta.dirname, "../..");
const WRANGLER_CONFIG = join(ROOT, "wrangler.jsonc");
const WRANGLER_EXAMPLE = join(ROOT, "wrangler.example.jsonc");
const DEPLOY_ENV = join(ROOT, ".env.deploy");
const SECRETS_ENV = join(ROOT, ".env.production");
const SECRET_KEYS = ["ACCESS_TEAM_DOMAIN", "ACCESS_AUD", "CF_ACCOUNT_ID", "STATS_API_TOKEN"] as const;

const childEnv: Record<string, string | undefined> = { ...process.env };
// bun loads .env for local development into every script; none of it belongs in the deployment
delete childEnv.ACCESS_DEV_BYPASS;

try {
  await main();
} catch (err) {
  console.error(`\nerror: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

async function main() {
  // wrangler.jsonc holds the account's resource IDs and is not in version control; a fresh clone starts from the example
  if (!existsSync(WRANGLER_CONFIG)) {
    writeFileSync(WRANGLER_CONFIG, readFileSync(WRANGLER_EXAMPLE, "utf8"));
    console.log("Created wrangler.jsonc from wrangler.example.jsonc");
  }
  const deployEnv = readEnvFile(DEPLOY_ENV);

  step("Cloudflare login");
  let whoami = wranglerJson<WhoAmI>(["whoami", "--json"]);
  if (!whoami.loggedIn) {
    run(["bunx", "wrangler", "login"]);
    whoami = wranglerJson<WhoAmI>(["whoami", "--json"]);
    if (!whoami.loggedIn) throw new Error("wrangler login did not complete");
  }
  const accountId = pickAccount(whoami.accounts ?? [], deployEnv.CLOUDFLARE_ACCOUNT_ID);
  childEnv.CLOUDFLARE_ACCOUNT_ID = accountId;
  deployEnv.CLOUDFLARE_ACCOUNT_ID = accountId;

  step("Domain");
  if (deployEnv.CUSTOM_DOMAIN === undefined) {
    console.log("A domain on this Cloudflare account, e.g. dns.example.com. Leave empty to use workers.dev,");
    console.log("where the edge cache does not work and which mainland China cannot reach");
    deployEnv.CUSTOM_DOMAIN = (prompt("Custom domain:") ?? "").trim().toLowerCase();
  }
  // vite.config.ts reads CUSTOM_DOMAIN from here on every build, so later `bun run deploy` keeps the domain
  writeEnvFile(DEPLOY_ENV, deployEnv, "Written by `bun run setup`; read by vite.config.ts and the setup script, never uploaded");
  console.log(deployEnv.CUSTOM_DOMAIN ? `Serving on https://${deployEnv.CUSTOM_DOMAIN}` : "Serving on workers.dev");

  step("D1 database and KV namespace");
  let config = readFileSync(WRANGLER_CONFIG, "utf8");
  const workerName = match(config, /"name":\s*"([^"]+)"/, "worker name");
  const databaseName = match(config, /"database_name":\s*"([^"]+)"/, "D1 database_name");
  const kvTitle = `${workerName}-rules`;

  let database = wranglerJson<D1Database[]>(["d1", "list", "--json"]).find((db) => db.name === databaseName);
  if (!database) {
    console.log(`Creating D1 database ${databaseName}`);
    wrangler(["d1", "create", databaseName]);
    database = wranglerJson<D1Database[]>(["d1", "list", "--json"]).find((db) => db.name === databaseName);
    if (!database) throw new Error(`D1 database ${databaseName} was not found after creating it`);
  }
  console.log(`D1 ${databaseName}: ${database.uuid}`);

  let namespace = wranglerJson<KvNamespace[]>(["kv", "namespace", "list"]).find((ns) => ns.title === kvTitle);
  if (!namespace) {
    console.log(`Creating KV namespace ${kvTitle}`);
    wrangler(["kv", "namespace", "create", kvTitle]);
    namespace = wranglerJson<KvNamespace[]>(["kv", "namespace", "list"]).find((ns) => ns.title === kvTitle);
    if (!namespace) throw new Error(`KV namespace ${kvTitle} was not found after creating it`);
  }
  console.log(`KV ${kvTitle}: ${namespace.id}`);

  const patched = config
    .replace(/("database_id":\s*")[^"]*(")/, `$1${database.uuid}$2`)
    .replace(/("binding":\s*"RULES",\s*"id":\s*")[^"]*(")/, `$1${namespace.id}$2`);
  if (patched !== config) {
    writeFileSync(WRANGLER_CONFIG, patched);
    config = patched;
    console.log("Updated the IDs in wrangler.jsonc");
  }

  step("Secrets");
  // Fails until the first deploy, when the Worker does not exist yet
  const onWorker = new Set(
    wranglerJsonOrNull<{ name: string }[]>(["secret", "list", "--format", "json"])?.map((s) => s.name),
  );
  const secrets = readEnvFile(SECRETS_ENV);
  let asked = false;
  for (const key of SECRET_KEYS) {
    // A key written empty on purpose, or missing but already set on the Worker, is left alone
    if (secrets[key] || key in secrets || onWorker.has(key)) continue;
    secrets[key] = key === "CF_ACCOUNT_ID" ? accountId : (prompt(`${SECRET_HINTS[key]}\n${key}:`) ?? "").trim();
    asked = true;
  }
  for (const key of ["ACCESS_TEAM_DOMAIN", "ACCESS_AUD"] as const) {
    if (!secrets[key] && !onWorker.has(key)) {
      throw new Error(`${key} is required; docs/deploy.md describes creating the Access application`);
    }
  }
  if (asked) {
    // Only non-empty values: `secrets:push` overwrites whatever this file lists, empty values included
    const filled = Object.fromEntries(SECRET_KEYS.filter((k) => secrets[k]).map((k) => [k, secrets[k]!]));
    writeEnvFile(SECRETS_ENV, filled, "Worker secrets uploaded by `bun run setup` and `bun run secrets:push`");
  }

  // Empty values would overwrite secrets already on the Worker, so they are only sent for required secrets the
  // Worker does not have yet: a first deploy fails without them, and an empty STATS_API_TOKEN disables the stats API
  const upload = Object.fromEntries(
    SECRET_KEYS.filter((k) => secrets[k] || !onWorker.has(k)).map((k) => [k, secrets[k] ?? ""]),
  );
  const tmp = mkdtempSync(join(tmpdir(), "edgedoh-setup-"));
  const secretsFile = join(tmp, "secrets.json");
  writeFileSync(secretsFile, JSON.stringify(upload), { mode: 0o600 });

  try {
    step("Build");
    run(["bun", "run", "build"]);

    step("D1 migrations");
    // CI skips wrangler's confirmation prompt; the migrations only ever add tables and columns
    run(["bunx", "wrangler", "d1", "migrations", "apply", "DB", "--remote"], { CI: "true" });

    step("Deploy");
    run(["bunx", "wrangler", "deploy", "--secrets-file", secretsFile]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  step("Done");
  const url = deployEnv.CUSTOM_DOMAIN ? `https://${deployEnv.CUSTOM_DOMAIN}` : "the workers.dev URL printed above";
  console.log(`Dashboard: ${url}`);
  console.log("Next: check that the Access applications cover this hostname, then add a device in the dashboard");
  console.log("Later updates only need `bun run deploy`; run `bun run setup` again after changing domains or accounts");
}

const SECRET_HINTS: Record<(typeof SECRET_KEYS)[number], string> = {
  ACCESS_TEAM_DOMAIN: "Zero Trust team domain, e.g. myteam.cloudflareaccess.com",
  ACCESS_AUD: "Application Audience (AUD) tag of the Access application protecting the dashboard",
  CF_ACCOUNT_ID: "Cloudflare account ID",
  STATS_API_TOKEN: "API token with Account Analytics Read (empty disables the stats pages)",
};

interface WhoAmI {
  loggedIn: boolean;
  accounts?: { id: string; name: string }[];
}
interface D1Database {
  uuid: string;
  name: string;
}
interface KvNamespace {
  id: string;
  title: string;
}

function pickAccount(accounts: { id: string; name: string }[], saved: string | undefined): string {
  if (saved && accounts.some((a) => a.id === saved)) return saved;
  if (accounts.length === 0) throw new Error("this login has no Cloudflare account");
  if (accounts.length === 1) return accounts[0]!.id;
  accounts.forEach((a, i) => console.log(`  ${i + 1}. ${a.name} (${a.id})`));
  const chosen = accounts[Number(prompt("Account number:")) - 1];
  if (!chosen) throw new Error("no account selected");
  return chosen.id;
}

function step(title: string) {
  console.log(`\n== ${title}`);
}

function match(text: string, pattern: RegExp, what: string): string {
  const found = pattern.exec(text)?.[1];
  if (!found) throw new Error(`could not find the ${what} in wrangler.jsonc`);
  return found;
}


function readEnvFile(path: string): Record<string, string> {
  return existsSync(path) ? ({ ...parseEnv(readFileSync(path, "utf8")) } as Record<string, string>) : {};
}

function writeEnvFile(path: string, values: Record<string, string>, comment: string) {
  const lines = Object.entries(values).map(([k, v]) => `${k}=${v}`);
  writeFileSync(path, `# ${comment}\n${lines.join("\n")}\n`, { mode: 0o600 });
}

/** Runs a command with the terminal attached, so wrangler can prompt and show progress */
function run(cmd: string[], env: Record<string, string> = {}) {
  const proc = Bun.spawnSync(cmd, { cwd: ROOT, env: { ...childEnv, ...env }, stdio: ["inherit", "inherit", "inherit"] });
  if (proc.exitCode !== 0) throw new Error(`${cmd.join(" ")} exited with ${proc.exitCode}`);
}

function wrangler(args: string[]): string {
  const proc = Bun.spawnSync(["bunx", "wrangler", ...args], { cwd: ROOT, env: childEnv, stdin: "ignore" });
  if (proc.exitCode !== 0) {
    throw new Error(`wrangler ${args.join(" ")} failed:\n${proc.stderr.toString()}${proc.stdout.toString()}`);
  }
  return proc.stdout.toString();
}

function wranglerJson<T>(args: string[]): T {
  const out = wrangler(args);
  // Warnings such as the proxy notice can precede the JSON on stdout
  const start = out.search(/^[[{]/m);
  return JSON.parse(start >= 0 ? out.slice(start) : out) as T;
}

function wranglerJsonOrNull<T>(args: string[]): T | null {
  try {
    return wranglerJson<T>(args);
  } catch {
    return null;
  }
}
