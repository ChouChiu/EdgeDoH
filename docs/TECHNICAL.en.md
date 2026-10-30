# Technical Architecture & Implementation

<div align="center">

[简体中文](TECHNICAL.md) · [繁體中文](TECHNICAL.zh-Hant.md) · **English**

</div>

This document details the system architecture, resolution pipeline, rule engine design, API specifications, and development conventions of EdgeDoH.

## Architecture Overview

EdgeDoH runs in the Cloudflare Workers serverless runtime, utilizing edge storage and compute primitives:

- **Cloudflare Worker (`src/worker`)**: Core execution environment. The DoH endpoint (`/dns-query/:deviceId`) processes binary DNS messages directly without routing framework overhead. The management API (`/api/*`) runs on Hono and is protected by Cloudflare Access JWT validation.
- **D1 Database (`DB`)**: Relational storage for devices, filter lists, profiles, local DNS records, and global settings.
- **KV Namespace (`RULES`)**: Stores compiled binary rule shards, raw filter list texts, and cached runtime configurations.
- **Durable Objects (`DEVICE_CLIENTS`)**: SQLite-backed per-device actors tracking active source networks within a sliding time window (IPv4 by single IP, IPv6 by `/64` prefix) for abuse mitigation.
- **Analytics Engine (`QUERY_LOG`)**: Asynchronously ingests multidimensional DNS telemetry points without delaying query answers.
- **Web Dashboard (`src/web`)**: Single-page application built with Vite, React 19, Tailwind CSS v4, and shadcn/ui. Snapshots are compiled asynchronously inside browser Web Workers.
- **Platform-Agnostic Core (`src/lib`)**: Zero-dependency DNS wireformat codec (`#dns`), rule compilation and matching engine (`#filter`), and shared contract limits/enums (`#contract`).

## Resolution Pipeline

The DoH handler (`/dns-query/:deviceId`) evaluates incoming DNS queries through the following pipeline:

1. **Device Identification & Config Resolution**: Extracts the device ID from the URL path. Reads runtime configuration from the KV mirror (`config:v2`), falling back to D1. Returns HTTP 404 if the device does not exist.
2. **Client Guard**: If network limits are active, checks the client IP (`cf-connecting-ip`). Admitted networks are cached in Worker isolate memory for 5 minutes. New networks query the device's Durable Object to verify total active networks within the sliding window. Exceeded networks receive `REFUSED` (`source: limited`). If the Durable Object encounters an error, queries are permitted by default to ensure DNS availability.
3. **Local Records & IPv6 Degradation**:
   - Matches local A / AAAA / CNAME records maintained in the dashboard; answers immediately on hit.
   - If "Disable IPv6" is enabled on the device profile, AAAA queries immediately return `NODATA` (NOERROR with empty answers), causing dual-stack clients to fall back to IPv4.
4. **Rule Matching & Blocked Services**: When filtering is active and the device is not paused, matches the queried domain against the compiled snapshot using binary search (enforcing only selected lists and services):
   - **Block**: Synthesizes a DNS response locally according to the configured mode (`null_ip` with 0.0.0.0/::, `nxdomain`, `refused`, `nodata`, or `custom_ip`).
   - **Rewrite**: Synthesizes an answer for `$dnsrewrite` or hosts rules; recursively queries upstream if rewritten to a CNAME.
   - **Pass**: Allowlisted domains or unmatched queries proceed to upstream resolution.
   - Applies Safe Search (Google / Bing / DuckDuckGo) and YouTube Restricted Mode rewrites.
5. **Edge Cache Lookup**: Generates a cache key from `qclass/qtype/lowercase domain/DO/CD`, the active upstream set, and the client subnet (when ECS is active). Checks the Cloudflare edge Cache API. On hit, decrements TTL, restores the original Query ID and case, and returns immediately.
6. **Upstream DoH Query**: On cache miss, dispatches an RFC 8484 POST query to configured upstreams:
   - **Fallback**: Queries upstreams in order; fails over on network error, timeout, or SERVFAIL.
   - **Parallel**: Queries all upstreams concurrently and selects the fastest non-SERVFAIL response.
   - Returns `SERVFAIL` if all upstreams fail.
7. **Cache Store & TTL Clamping**:
   - Clamps valid responses (NOERROR and NXDOMAIN) to configured Min/Max TTL limits per RFC 2308, writes them to edge Cache API, and responds to the client.
   - If profile enables DNS rebinding protection, A / AAAA answers (cache hits included) holding a loopback, RFC 1918, link-local or IPv6 ULA address get the blocking response and are logged as blocked (list `rebinding`). Split-DNS queries and allowlisted names are not checked; carrier-grade NAT (`100.64.0.0/10`) is out of scope.
   - If profile enables ECH or HTTP/3 injection, injects `alpn=h3` and public Cloudflare ECH parameters into HTTPS records of Cloudflare-proxied sites (skipped for queries with DO bit).
8. **Async Telemetry Ingestion**: If logging is enabled, writes a structured telemetry point to Analytics Engine via `ctx.waitUntil` (device, domain, type, action, latency, upstream, data center, client type, source network). Client IP addresses are not stored, and response time is not delayed.

## Rule Engine & Snapshot Sharding

Cloudflare Workers Free Tier limits CPU execution to 10ms per request. EdgeDoH avoids parsing text rules at the edge; compilation runs entirely inside browser Web Workers or via the CLI:

### Sharded Storage Architecture
- **Exact & Suffix Rules**: Stored in a sorted 64-bit hash table. Queries match domains and successive parent domains via binary search in $O(\log N)$ time.
- **Snapshot Shards**: Rules are partitioned across 32 binary shards. The pointer key `snapshot:manifest:v3` tracks the current version. Workers poll this pointer every 30 seconds and only fetch missing shards into memory on demand.
- **Complex Rules**: Wildcards and regular expressions are capped at 5000 rules and indexed by required substring tokens to prevent cold-start RegExp construction overhead.
- **Incremental Sync**: Updates upload only newly generated shard hashes to KV; stale shards are cleaned up when the manifest updates.

### Syntax Compatibility & Precedence
- Evaluation precedence matches AdGuard DNS rules: `$dnsrewrite` > `@@...$important` > `...$important` > `@@...` (allowlist) > standard blocking rules.
- Supported modifiers: `$important`, `$badfilter`, `$dnstype`, `$client` (device name, device ID, IP, or CIDR), `$denyallow`, `$dnsrewrite`.
- Discarded syntax: Cosmetic filter rules, browser modifiers, and rules containing URL paths or ports are stripped during compilation and logged in diagnostic reports.

## Client Guard (Abuse Protection)

- Each device is paired with a SQLite-backed Durable Object (`DeviceClients`) tracking active network origins.
- IPv4 counts per IP address; IPv6 clusters by `/64` subnet to handle SLAAC privacy address changes.
- Admitted origins are cached in Worker isolate memory for 5 minutes, avoiding unnecessary storage calls.
- Thresholds and sliding windows are configured in Settings > Abuse Protection (set to 0 to disable); device cards provide live counters and manual reset controls.

## Configuration & Secrets

Configuration defaults and bindings are declared in `wrangler.jsonc`. Sensitive credentials are managed as Worker Secrets:

| Variable | Scope | Description |
| --- | --- | --- |
| `ACCESS_TEAM_DOMAIN` | Worker Secret | Zero Trust team domain securing the dashboard and `/api/*` (e.g. `myteam.cloudflareaccess.com`) |
| `ACCESS_AUD` | Worker Secret | Application Audience (AUD) identifier of the self-hosted Access application |
| `CF_ACCOUNT_ID` | Worker Secret | Cloudflare Account ID used for Analytics Engine SQL API queries |
| `STATS_API_TOKEN` | Worker Secret | API Token with `Account > Account Analytics > Read` permissions; leave empty to disable analytics |
| `ACCESS_DEV_BYPASS` | Local Env Var | Local development only. Bypasses Access for localhost requests; never use in production |
| `CUSTOM_DOMAIN` | Build Env Var | Bound custom domain configured in `.env.deploy` or build settings, not a runtime secret |

Changes made in the web dashboard are written to the D1 `settings` table and synced to KV, propagating to edge nodes within 1 minute.

## API Reference

All `/api/*` endpoints require a valid Cloudflare Access JWT. Errors return `{ "error": "..." }`:

### Health & Devices
- `GET /api/health`: Health check.
- `GET /api/devices`: List all devices.
- `POST /api/devices`: Create a device (`{ name, profileId? }`).
- `PATCH /api/devices/:id`: Update device name or profile.
- `DELETE /api/devices/:id`: Delete a device.
- `GET /api/devices/:id/mobileconfig`: Download Apple configuration profile.
- `GET /api/devices/:id/clients`: List active source networks for a device.
- `DELETE /api/devices/:id/clients`: Reset active source networks for a device.
- `POST /api/devices/:id/pause`: Pause device filtering (`{ minutes }`, 0 resumes).

### Rule Snapshots & Testing
- `GET /api/rules`: Get current snapshot metadata.
- `GET /api/rules/manifest`: List existing shard hashes.
- `PUT /api/rules/blobs/:hash`: Upload an incremental shard.
- `POST /api/rules/commit`: Commit and activate a new snapshot version.
- `DELETE /api/rules/snapshot`: Deactivate the current snapshot.
- `POST /api/rules/test`: Simulate domain matching (`{ name, type, deviceId? }`).
- `GET /api/catalog`: Fetch HostlistsRegistry catalog.

### Filter Lists & Custom Rules
- `GET /api/lists`: List installed filter lists.
- `POST /api/lists`: Install a list (`{ url, name? }`).
- `PATCH /api/lists/:id`: Toggle or rename a list.
- `DELETE /api/lists/:id`: Uninstall a list.
- `POST /api/lists/:id/refresh`: Refresh list content from remote URL.
- `GET /api/lists/:id/text`: Read raw list content.
- `PUT /api/lists/:id/text`: Update inline list content (e.g. split-DNS domains).
- `POST /api/lists/reports`: Report rule compilation diagnostic metrics.
- `GET /api/custom-rules`: Read custom rules text.
- `PUT /api/custom-rules`: Update custom rules text.

### Profiles, Services & Split DNS
- `GET /api/profiles`: List profiles.
- `POST /api/profiles`: Create a profile.
- `PATCH /api/profiles/:id`: Update profile configuration.
- `DELETE /api/profiles/:id`: Delete a profile (default profile cannot be deleted).
- `GET /api/services/:source`: Fetch service catalog (`adguard` or `community`).
- `GET /api/local-records`: List local DNS records.
- `PUT /api/local-records`: Replace all local DNS records.
- `GET /api/settings`: Read global settings.
- `PATCH /api/settings`: Update global settings.
- `GET /api/backup`: Export a configuration backup (settings, profiles, devices, lists, custom rules, local records; device IDs and downloaded list contents are left out).
- `PUT /api/backup`: Replace the whole configuration with a backup; devices get new IDs. Returns the downloaded lists to fetch again as `pending`.

### Query Analytics & Logs
- `GET /api/stats/summary`: Aggregate metrics (totals, block rate, latency).
- `GET /api/stats/timeseries`: Time-series query volume and block counts.
- `GET /api/stats/top/:kind`: Top ranking stats (`domains`, `blocked`, `devices`, `rules`, `lists`, `upstreams`, `services`, `clients`, `networks`).
- `GET /api/stats/logs`: Paginated query log with filters (`limit`, `offset`, `search`, `range`, `device`, `action`, `source`).

## CLI Tool

A standalone CLI tool in `src/cli` allows offline rule compilation and snapshot management:

```bash
# Compile rules to local binary snapshot
bun run cli compile adguard=https://adguardteam.github.io/HostlistsRegistry/assets/filter_1.txt -o snapshot

# Upload and activate snapshot (uses Access Service Token from .env)
bun run cli upload snapshot --url https://dns.example.com
```

Devices can also be directly inserted into D1 without the dashboard:

```bash
bunx wrangler d1 execute DB --remote --command "INSERT INTO devices (id, name, created_at) VALUES ('<10-char-id>', '<device-name>', <timestamp>)"
```

## Directory Structure

```text
src/
├── lib/           # Platform-agnostic algorithms and codecs
│   ├── dns/       # Standard DNS wireformat codec (#dns)
│   ├── filter/    # Rule compiler, shard format, and matching engine (#filter)
│   └── contract/  # Shared limits, enums, and types (#contract)
├── worker/        # Cloudflare Worker backend
│   ├── features/  # Domain features (devices, doh, lists, profiles, records, rules, services, settings, stats)
│   ├── shared/    # Auth middleware, config sync, error model, validators
│   └── test/      # Upstream mocks and test helpers
├── web/           # React dashboard (Vite + React 19 + Tailwind CSS v4 + shadcn/ui)
│   ├── app/       # Router and global layout
│   ├── features/  # Feature page components
│   ├── shared/    # UI primitives, common hooks, utilities, and i18n
│   └── test/      # Component test setup
├── cli/           # CLI tool and interactive setup script
docs/              # Documentation and deployment guides
migrations/        # D1 relational database migration scripts
tsconfig/          # Tiered TypeScript configurations
```

## Verification & Testing Conventions

Run the verification toolchain before submitting changes:

```bash
bun run typecheck
bun run test
bun run build
```

- **Type Check**: `bun run typecheck` validates `worker-configuration.d.ts` and runs project-wide `tsc -b`.
- **Automated Tests**: Worker tests run inside workerd via `@cloudflare/vitest-plugin`; library and frontend tests run in Node / happy-dom.
- **Production Build**: `bun run build` verifies client asset compilation and Worker bundling.
