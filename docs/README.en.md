<p align="center">
  <img src="icon-256.png" width="104" alt="cf-dns">
</p>

# cf-dns

<p align="center">
  <a href="../README.md">简体中文</a> · <a href="README.zh-Hant.md">繁體中文</a> · <b>English</b>
</p>

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ChouChiu/cf-dns)

A personal DNS-over-HTTPS (DoH) resolver built on Cloudflare Workers Free Tier. Assigns dedicated endpoints per device, blocks ads and tracking using AdGuard and hosts filter lists, records multi-dimensional query metrics on Analytics Engine, and includes a full-featured web dashboard.

## Features

- **DoH Resolvers**: RFC 8484 compliant (GET and POST). Generates dedicated endpoints per device and provides iOS / iPadOS / macOS configuration profiles (`.mobileconfig`) for one-click setup.
- **Rule Engine**: Compatible with AdGuard DNS syntax, standard hosts files, and plain domain lists. Built-in AdGuard HostlistsRegistry catalog, custom URL imports, and interactive rule testing. Compiles snapshots into 64-bit hashed binary shards in the browser Web Worker; edge Workers query via in-memory binary search without CPU overhead from text parsing.
- **Resolution Strategy & Cache**: Sequential fallback or concurrent race (fastest response) across multiple upstreams; Cloudflare edge Cache API integration with TTL clamps (Min/Max TTL); flexible blocking answers (0.0.0.0/::, NXDOMAIN, REFUSED, NODATA, custom IP); and IPv6 fast degradation (NODATA for AAAA).
- **Per-Device Profiles**: Each device uses a profile that picks its filter lists, blocking response and upstreams. Block services from AdGuard's catalog (TikTok, Douyin, Bilibili, games and more) with one click, on a schedule by weekday and time zone, enforce Safe Search (Google / Bing / DuckDuckGo) and YouTube Restricted Mode, or pause filtering for one device for a while.
- **Split DNS & ECS**: Domain lists (dnsmasq `server=/…/` lines such as dnsmasq-china-list are understood) can be resolved through dedicated upstreams. Optionally forward the client's /24 (IPv6 /56) as EDNS Client Subnet so CDNs answer with nearby nodes; the cache is kept per subnet.
- **ECH & HTTP/3 Injection**: For names resolving to Cloudflare's IP ranges, HTTPS records get `alpn=h3` and Cloudflare's shared ECH config (read from `cloudflare-ech.com`), synthesised when the site publishes none. Queries with the DO bit are never edited.
- **Local Records & Query Origin**: Maintain A / AAAA / CNAME records (with `*.` wildcards) in the dashboard. Logs tell DoH clients apart by User-Agent (browser or system resolver), infer the service a domain belongs to, and record the source network (AS organisation). DNS requests carry no app identity, so the service is an inference.
- **Metrics & Logging**: Powered by Cloudflare Analytics Engine, capturing query counts, block ratios, average latency, and upstream distribution. Live query log with multi-attribute filtering and one-click rule creation.
- **Abuse Protection**: Durable Objects track active networks in a sliding window (IPv4 by IP, IPv6 by /64 subnet). Exceeded networks receive REFUSED, preventing unauthorized use if DoH URLs leak.
- **Zero Trust Security**: Dashboard and `/api/*` protected by Cloudflare Access JWT verification (fail-closed). DoH queries take a separate path with no authentication.
- **Web Dashboard**: Single-page application built with Vite, React, Tailwind, and shadcn/ui. Responsive layout, dark mode, and English, Simplified Chinese and Traditional Chinese.

## Quick Start

Requires [Bun](https://bun.sh) and a Cloudflare account:

```bash
bun install
cp wrangler.example.jsonc wrangler.jsonc
cp .env.example .env
echo ACCESS_DEV_BYPASS=true >> .env
bun run db:migrate:local
bun run dev
```

- `bun run dev` uses `@cloudflare/vite-plugin` to run the Worker inside workerd next to the Vite dev server, serving the API, DoH, and SPA with HMR on `http://localhost:8787` without a separate build step.
- Local D1, KV, and Durable Object state persists in `.wrangler/state`.
- `ACCESS_DEV_BYPASS=true` in `.env` only skips Access JWT validation for requests addressed to localhost / 127.0.0.1; never set this in production.
- `bun run build` emits the web client to `dist/client` and the Worker to `dist/cf_dns`. Run `bun run preview` to test the full production build locally.
- `dig` with DoH (`+https`) requires HTTP/2, whereas the local Vite dev server runs HTTP/1.1. Test local DoH queries using `curl`, test scripts, or a browser.

## Deployment

Refer to the [Deployment Guide](deploy.en.md) for full setup instructions, including Zero Trust and Cloudflare Access application rules.

- CLI Setup (Recommended): Run `bun run setup`. The script checks or creates D1 (`cf-dns`) and KV (`cf-dns-rules`), updates `wrangler.jsonc`, configures your custom domain and production secrets, runs D1 remote migrations, and deploys. Safe to rerun at any time.
- Deploy Button: Commit a `wrangler.jsonc` copied from `wrangler.example.jsonc` (IDs left empty) to your fork first, then click the Deploy to Cloudflare button above. Cloudflare provisions bindings automatically. Once deployed, set your custom domain via the `CUSTOM_DOMAIN` build variable.
- Routine Updates: Run `bun run deploy` to build, apply remote D1 migrations, and deploy to Cloudflare.

`vite.config.ts` reads `CUSTOM_DOMAIN` from environment variables or `.env.deploy`. When configured, the Worker serves only that domain and disables `*.workers.dev` (where Cache API is unavailable and mainland China connectivity is blocked). If omitted, workers.dev is used by default.

## Configuration & Secrets

Account-specific values remain outside source control: `wrangler.jsonc` is copied from `wrangler.example.jsonc` and keeps this account’s D1 and KV IDs on your machine only. It defines resource bindings and defaults, declaring required secrets in `secrets.required`:

| Variable | Scope | Description |
| --- | --- | --- |
| `ACCESS_TEAM_DOMAIN` | Worker Secret | Zero Trust team domain protecting the dashboard and `/api/*` (e.g. `myteam.cloudflareaccess.com`) |
| `ACCESS_AUD` | Worker Secret | Application Audience (AUD) tag of the self-hosted Access application |
| `CF_ACCOUNT_ID` | Worker Secret | Cloudflare Account ID used for Analytics Engine SQL API queries |
| `STATS_API_TOKEN` | Worker Secret | API Token with `Account > Account Analytics > Read` permissions; leave empty to disable stats |
| `ACCESS_DEV_BYPASS` | Local Env Var | Local development only. Bypasses Access for localhost requests; never put in `.env.production` |
| `CUSTOM_DOMAIN` | Build Env Var | Custom domain to bind; stored in `.env.deploy` or build settings, not a runtime secret |

- Template is `.env.example`. All `.env*` files are ignored by git.
- Local development reads `.env`. `wrangler dev` loads it automatically; if `.dev.vars` exists, wrangler prioritizes it, so prefer using `.env`.
- Production uses `.env.production` (without `ACCESS_DEV_BYPASS`), uploaded during `bun run setup` or manually via `bun run secrets:push` (`wrangler secret bulk .env.production`).
- `.env.deploy` is generated by `bun run setup` to store `CUSTOM_DOMAIN` and selected `CLOUDFLARE_ACCOUNT_ID` locally.
- `wrangler secret bulk` overwrites matching secrets. Leave unchanged secrets out of `.env.production` to avoid overwriting live values.
- Fail-closed design: Unconfigured Access returns 503 for management APIs. Unconfigured stats returns 503 only for analytics endpoints. DNS resolution operates independently and is never blocked by auth or stats misconfiguration.
- `BLOCKING_MODE`, `BLOCKED_TTL`, `UPSTREAMS`, and `UPSTREAM_TIMEOUT_MS` in `wrangler.jsonc` act as cold-start defaults. Dashboard changes are persisted in the D1 `settings` table, mirrored to KV, and propagated globally within 1 minute.

## Resolution Pipeline

1. Route & Device Identification: Extracts the device ID from `/dns-query/:deviceId`. Reads runtime configuration from KV, falling back to D1; returns 404 if the device does not exist.
2. Client Guard: If client limits are active, extracts the client IP (`cf-connecting-ip`) and checks active networks in the sliding window via the device's Durable Object (IPv4 by IP, IPv6 by /64 prefix). Extra networks receive REFUSED (`source: limited`). Admitted networks are cached in isolate memory for 5 minutes to avoid continuous Durable Object wakeups.
3. Local Records & IPv6 Degradation: Local records maintained in the dashboard are checked first and answered locally. Otherwise, if IPv6 resolution is disabled, AAAA queries return NODATA (NOERROR with empty answers) so clients fall back to IPv4 without delay.
4. Rule Matching: If the device's profile has filtering on and the device is not paused, the name is matched against the snapshot (only the lists and services the profile selects; scheduled services only inside their window), then against Safe Search and YouTube Restricted Mode:
   - Block: Constructs a DNS response locally according to configured mode (`null_ip` with 0.0.0.0/::, `nxdomain`, `refused`, `nodata`, or `custom_ip`).
   - Rewrite: Rewrites response locally for `$dnsrewrite` and hosts entries (recursively resolves upstream if rewritten to a CNAME).
   - Pass: Allowlisted or unmatched names go upstream; names covered by an enabled split-DNS list use that list's upstreams.
5. Edge Cache Lookup: Computes the cache key from `qclass/qtype/lowercase domain/DO/CD` and the upstream set (plus the client subnet when ECS is on) and queries Cloudflare edge Cache API. On cache hit, decrements TTL, restores client Query ID and original letter casing, and returns immediately.
6. Upstream Query: On cache miss, sends an RFC 8484 POST request to upstream DoH resolvers:
   - Fallback: Queries resolvers in configured order; fails over on network error, timeout, or SERVFAIL.
   - Parallel: Queries all resolvers concurrently, returning the first non-SERVFAIL response.
   - Returns SERVFAIL if all upstreams fail.
7. Cache Store & TTL Clamp: Clamps NOERROR and NXDOMAIN responses according to RFC 2308 and configured Min/Max TTL limits, stores them in edge Cache API, and returns to client. Profiles with ECH / HTTP/3 injection then edit HTTPS records of Cloudflare-hosted names.
8. Async Analytics: If logging is enabled, writes one data point to Analytics Engine via `ctx.waitUntil` (device, name, type, action, latency, upstream, colo, DoH client type and source network). Client IPs are not recorded, and the response is not delayed.

## Abuse Protection

- Each device is paired with a SQLite-backed Durable Object (`DeviceClients`) tracking unique networks seen in the sliding window. IPv4 counts per address; IPv6 aggregates by `/64` prefix to accommodate privacy address rotation.
- Allowed networks are cached in isolate memory for 5 minutes, adding zero latency to regular queries. If the Durable Object encounters an error, queries are permitted by default to guarantee DNS availability.
- Network limits and time windows are configured in Settings under Abuse Protection; set to 0 to disable. Device cards display current active network counts with a manual reset option.
- Without ECH / HTTP/3 injection, HTTPS records (Type 65) and the ECH config in them are forwarded unchanged.

## Rule Engine Architecture

Free-tier Cloudflare Workers have a 10ms CPU limit per request. cf-dns avoids parsing raw rule syntax at runtime by offloading all parsing and compilation to the browser (Web Worker) or CLI:

- Exact domain rules (`||example.com^`, `|example.com^`, hosts, and plain domain lines) compile into sorted 64-bit hash tables. Matching searches the domain and every parent level using binary search ($O(\log N)$).
- Snapshots are split into 32 shards in KV, referenced by `snapshot:manifest:v3`. Isolates poll the manifest pointer every 30 seconds and load only shards needed by incoming queries into memory.
- Wildcard and regex rules are stored separately (up to 5,000 rules) and indexed by required substring tokens. Evaluated on demand; wildcards use substring slicing, preventing cold-start CPU exhaustion from compiling hundreds of RegExp objects.
- Incremental Shard Uploads: Snapshot publishing checks the manifest and uploads only missing shards. Deprecated shards are pruned on subsequent commits.
- Filtering priority strictly follows AdGuard standard: `$dnsrewrite` > `@@...$important` > `...$important` > `@@...` (allowlist) > standard blocking rules.
- Supported Modifiers: `$important`, `$badfilter`, `$dnstype`, `$client` (device name, device ID, IP, or CIDR), `$denyallow`, `$dnsrewrite` (A, AAAA, CNAME, and rcode keywords). Non-empty hosts entries are treated as rewrites.
- Unsupported Rule Handling: Cosmetic rules, browser-specific modifiers (e.g. `$ctag`), and rules containing URLs or ports are stripped during compilation and reported in diagnostics; `$dnstype` matches query types only.

Benchmarked against AdGuard DNS filter (~190,000 rules): Browser Web Worker compiles in ~0.4s into a ~3 MB snapshot. Median CPU time for warm isolate DoH queries is ~1ms (12–22ms on cold isolate first request).

## Filter List Management

- When installing or updating lists, the Worker streams raw content directly into KV, reading only the first 16 KB to extract metadata (`Title`, `Description`, `Homepage`, `License`, `Version`, `Last modified`, supporting `!` and `#` comments).
- Enabling, disabling, updating, or removing lists triggers an asynchronous recompile in a Web Worker, publishing new shards and reporting active counts and syntax diagnostics. Operations are debounced to prevent concurrent race conditions.
- Deep Linking: Supports `/install?url=<URL>&title=<Name>` links to trigger an installation confirmation prompt in the dashboard.

## Query Statistics & Logs

Each query logs one data point to Analytics Engine (schema defined in `src/worker/features/stats/schema.ts`). Device ID serves as the sample key without recording client IP. Data is retained for 3 months; logging can be turned off in settings.

- Metrics are queried via the Analytics Engine SQL API and weighted by `_sample_interval`. Results are cached for 60 seconds at the local edge colo.
- Supported query parameters: `range=1h|24h|7d|30d` (default 24h), `device`, `action=pass|allow|block|rewrite`, `source=upstream|cache|local|error|limited`, and `search` (domain search with `*` wildcards).
- Parameter Sanitization: Filter parameters use strict enums; `search` allows only alphanumeric characters and `.-_*`.
- The free tier allows 100,000 data points per day, matching the Workers free tier's 100,000 requests per day.

## API Endpoints

All `/api/*` endpoints require a valid Cloudflare Access JWT. Errors return `{ "error": "…" }`：

| Endpoint | Method | Description |
| --- | --- | --- |
| `/api/health` | `GET` | Health check |
| `/api/devices` | `GET`, `POST` | List devices, create new device |
| `/api/devices/<ID>` | `PATCH`, `DELETE` | Rename a device or change its profile, delete device |
| `/api/devices/<ID>/mobileconfig` | `GET` | Download Apple mobileconfig profile |
| `/api/devices/<ID>/clients` | `GET`, `DELETE` | Query active client networks, reset records |
| `/api/devices/<ID>/pause` | `POST` | Pause a device's filtering `{ minutes }`; 0 resumes |
| `/api/rules` | `GET` | Active snapshot metadata overview |
| `/api/rules/manifest` | `GET` | List existing snapshot shards |
| `/api/rules/blobs/<hash>` | `PUT` | Upload snapshot binary shard |
| `/api/rules/commit` | `POST` | Commit and activate new snapshot version |
| `/api/rules/snapshot` | `DELETE` | Deactivate active rule snapshot |
| `/api/rules/test` | `POST` | Test domain rule matching (`name`, `type`, `deviceId`) |
| `/api/catalog` | `GET` | Retrieve HostlistsRegistry filter catalog |
| `/api/lists` | `GET`, `POST` | List installed lists, add new list |
| `/api/lists/<ID>` | `PATCH`, `DELETE` | Update list state/name, uninstall list |
| `/api/lists/<ID>/refresh` | `POST` | Fetch latest content for a list |
| `/api/lists/<ID>/text` | `GET`, `PUT` | Read raw list text from KV; replace the text of an inline list (e.g. a route list) |
| `/api/lists/reports` | `POST` | Report compilation stats and syntax diagnostics |
| `/api/custom-rules` | `GET`, `PUT` | Read and save custom rules |
| `/api/settings` | `GET`, `PATCH` | Read and update resolver settings |
| `/api/profiles` | `GET`, `POST` | List profiles, create a profile |
| `/api/profiles/<ID>` | `PATCH`, `DELETE` | Update or delete a profile (the default one cannot be deleted) |
| `/api/services/:source` | `GET` | One services catalog file (`adguard` or `community`, from [service-catalog](https://github.com/ChouChiu/service-catalog)) |
| `/api/local-records` | `GET`, `PUT` | Read or replace the local DNS records |
| `/api/stats/summary` | `GET` | Overview metrics (total, blocked, latency, etc.) |
| `/api/stats/timeseries` | `GET` | Timeseries query and block trends |
| `/api/stats/top/<kind>` | `GET` | Rankings (`domains`, `blocked`, `devices`, `rules`, `lists`, `upstreams`, `services`, `clients`, `networks`) |
| `/api/stats/logs` | `GET` | Paginated query logs (`limit` and `offset`) |

## CLI Tool

A standalone CLI is included to compile and upload snapshots without using the web dashboard. The `upload` command reads Cloudflare Access Service Token credentials from `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` (loaded automatically by Bun from `.env`):

```bash
# Compile filter lists into local binary shards
bun run cli compile adguard=https://adguardteam.github.io/HostlistsRegistry/assets/filter_1.txt -o snapshot

# Upload and activate snapshot
bun run cli upload snapshot --url https://dns.example.com
```

If the dashboard is not yet deployed, devices can also be created directly in D1 via wrangler:

```bash
bunx wrangler d1 execute DB --remote --command "INSERT INTO devices (id, name, created_at) VALUES ('<10-char alphanumeric ID>', '<Device Name>', <timestamp in ms>)"
```

## Directory Structure

Monorepo package with source code in `src`, separated by runtime environment and feature domain:

```text
src/
├── lib/
│   ├── dns/       # DNS wire format codec, zero dependencies (#dns alias)
│   ├── filter/    # Rule parser, compiler, snapshot sharding, and matcher (#filter alias)
│   └── contract/  # Limits and enums shared by the Worker API and the dashboard (#contract alias)
├── worker/        # Cloudflare Worker backend
│   ├── features/  # Domain modules (devices, doh, lists, profiles, records, rules, services, settings, stats) with store, api, and tests
│   │   └── devices/client-guard.ts  # Client limit Durable Object (DeviceClients)
│   ├── shared/    # Access JWT validation, KV runtime config, HttpError, shared validators, and SHA-256
│   └── test/      # Fake upstreams, Analytics Engine SQL mock, and helpers
├── web/           # Web dashboard (Vite + React + Tailwind + shadcn/ui, @/ alias)
│   ├── app/       # Router, navigation, and root layout
│   ├── features/  # Pages and components (devices, dns, filters, profiles, rules, settings, snapshot, stats)
│   ├── shared/    # shadcn UI components, hooks, utilities, and i18n locales
│   └── test/      # Component test setup
├── cli/           # CLI tool (main.ts) and setup script (setup.ts)
docs/              # Deployment and configuration documentation (including multilingual READMEs)
migrations/        # D1 SQL migrations
tsconfig/          # TypeScript multi-project configurations (lib, worker, web, cli, node)
```

## Development & Testing

Run tests and type checks:

```bash
bun run typecheck
bun run test
bun run build
```

- Worker unit tests execute in workerd via `@cloudflare/vitest-plugin`. Frontend and `src/lib` tests run in Node (component tests in happy-dom). Upstreams and external APIs are mocked in `src/worker/test/fake-upstream.ts`.
- API endpoints throw `HttpError` instances, caught and formatted into standard JSON by the top-level handler.
- Localization files live in `src/web/shared/i18n/locales`. `zh-Hans.ts` is the single source of truth for message keys; `zh-Hant.ts` and `en-US.ts` are kept in sync with it, keys and placeholders alike, by TypeScript and `locales.test.ts`.
- Page changes use React `<ViewTransition>` (built on the View Transitions API); route changes reset the scroll position.
- Database schema changes are versioned sequentially in `migrations/`. `bun run deploy` automatically applies pending remote migrations before deployment.

## License

[GNU AGPL v3](../LICENSE) or later. If you modify this project and let others use it over a network, you must offer those users the complete corresponding source code.
