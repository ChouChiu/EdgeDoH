# Deployment Guide

<p align="center">
  <a href="deploy.md">简体中文</a> · <a href="deploy.zh-Hant.md">繁體中文</a> · <b>English</b>
</p>

cf-dns provides two deployment methods: an interactive CLI setup script (recommended) or the automated Deploy to Cloudflare button. Both share the same prerequisites. Complete the prerequisites before proceeding with deployment.

---

## Prerequisites

### 1. Account & Domain Planning

1. A Cloudflare account (the Workers Free Tier is sufficient for personal and home use).
2. A root domain hosted on this Cloudflare account (e.g. `example.com`). The DNS service will be bound to a subdomain (e.g. `dns.example.com`).
3. No pre-created DNS records required: The subdomain record is automatically configured during deployment. Delete any pre-existing records for that subdomain to prevent conflicts.
4. Workers.dev limitations: On `*.workers.dev` domains, the Cache API is disabled (every query must be forwarded upstream) and access from mainland China is blocked. A custom domain is strongly recommended.
5. Cloudflare Account ID: Copy your Account ID from the lower-right section of the Cloudflare dashboard homepage or extract it from the dashboard URL (`dash.cloudflare.com/<AccountID>`).

### 2. Initialize Zero Trust Team

The dashboard and management APIs are protected by Cloudflare Access (Zero Trust). If required credentials are missing, the Worker authentication middleware returns HTTP 503 and fails closed to prevent unauthorized access.

1. Open the [Zero Trust Dashboard](https://one.dash.cloudflare.com/). On first visit, choose a team name and select the Free plan.
2. Go to Settings → Custom Pages, and note your Team domain (formatted as `your-team.cloudflareaccess.com`), which maps to `ACCESS_TEAM_DOMAIN`.
3. Go to Settings → Authentication, and verify that at least one login method is enabled (the default one-time PIN via email works out of the box).

### 3. Configure Access Applications

Navigate to Access → Applications → Add an application → Self-hosted. Create two applications for `dns.example.com`:

| Application | Path | Policy | Purpose |
| --- | --- | --- | --- |
| `cf-dns Dashboard` | Leave empty (protects root) | Action: `Allow`<br>Include: `Emails` (your email) | Restricts dashboard and `/api/*` access to authorized users |
| `cf-dns DoH` | `dns-query` | Action: `Bypass`<br>Include: `Everyone` | Allows DoH clients to resolve queries without authentication |

Cloudflare Access follows longest-prefix matching. By creating a Bypass policy specifically for `dns-query`, all incoming DoH requests to `/dns-query` and `/dns-query/*` bypass login redirects, allowing devices to resolve DNS normally.

After creating the dashboard application, open its Overview tab and copy the Application Audience (AUD) tag. This value maps to `ACCESS_AUD`.

### 4. Create Analytics Engine Token (Optional)

To enable dashboard charts, query metrics, and log inspection, create an API token to query the Analytics Engine SQL API:

1. In the Cloudflare dashboard, go to My Profile → API Tokens → Create Token → Create Custom Token.
2. Add permission: `Account → Account Analytics → Read`.
3. Account Resources: `Include → Specific account` (or All accounts).
4. Create and copy the generated token string. This maps to `STATS_API_TOKEN`.

If you do not need query analytics, this token can be left blank. Only the dashboard statistics pages will be unavailable; core DoH resolution and filtering functions remain fully operational.

### 5. Summary of Credentials

Confirm you have the following 4 credentials before deploying:

| Variable | Source |
| --- | --- |
| `ACCESS_TEAM_DOMAIN` | Zero Trust team domain (Step 2) |
| `ACCESS_AUD` | Dashboard Access Application AUD tag (Step 3) |
| `CF_ACCOUNT_ID` | Cloudflare Account ID (Step 1; auto-detected by CLI setup) |
| `STATS_API_TOKEN` | API Token with Account Analytics Read (Step 4, optional) |

---

## Method 1: Local Interactive Setup (Recommended)

Requires [Bun](https://bun.sh) and `git` on your local machine.

```bash
git clone https://github.com/ChouChiu/cf-dns.git
cd cf-dns
bun install
bun run setup
```

The interactive script executes the following steps:

1. Authenticates wrangler, opening a browser login if not authenticated, and prompts for account selection if multiple accounts exist.
2. Prompts for your custom domain (e.g. `dns.example.com`), writing it to `.env.deploy`.
3. Verifies or provisions the D1 database (`cf-dns`) and KV namespace (`cf-dns-rules`), writing their IDs back to `wrangler.jsonc` (which is not in version control; the first run creates it from `wrangler.example.jsonc`).
4. Prompts for missing required secrets, writing them to `.env.production`.
5. Compiles client assets and Worker, executes remote D1 migrations, and uploads secrets to deploy the Worker.

- Safe to rerun: Existing resources and saved values are reused on subsequent runs.
- Custom regions: To place your D1 database in a specific location, create it beforehand via `bunx wrangler d1 create cf-dns --location apac`; the setup script will link to the existing database automatically.
- Future updates:
  ```bash
  git pull && bun install && bun run deploy
  ```

---

## Method 2: Deploy to Cloudflare Button

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ChouChiu/cf-dns)

> `wrangler.jsonc` holds the account's resource IDs and is not in version control. Before using the button, fork this repository, commit a `wrangler.jsonc` copied from `wrangler.example.jsonc` (D1 and KV IDs left empty, filled in by Cloudflare), and point the button's `url` at your own fork.

1. Click the button above to begin the deployment flow. Authorize Cloudflare to fork the repository into your GitHub account.
2. Cloudflare will automatically detect and list the required D1, KV, and Durable Object bindings. Leave names at their defaults.
3. Fill in the 4 environment secrets gathered during the prerequisites (`CF_ACCOUNT_ID` must be entered manually).
4. Build and deploy commands are pre-configured (including remote D1 migrations). Keep them unchanged and click Deploy.
5. Bind custom domain:
   - Navigate to Worker Settings → Build → Variables and Secrets;
   - Add a build variable named `CUSTOM_DOMAIN` with the value of your domain (e.g. `dns.example.com`);
   - Go to Deployments and trigger a rebuild (Retry deployment) to attach the domain.
6. Pushing future commits to `main` in your GitHub repository will automatically trigger CI builds and redeployments.

Bind custom domains using the `CUSTOM_DOMAIN` build variable rather than adding routes manually in Domains & Routes. Manually assigned routes are not stored in the build configuration and can be lost on subsequent deployments.

---

## Post-Deployment Setup & Verification

1. Access Dashboard: Open `https://dns.example.com` in your browser and log in via Cloudflare Access email verification.
2. Add Device: In the Devices page, click Add Device to generate a dedicated DoH endpoint URL (`https://dns.example.com/dns-query/<DeviceID>`). Apple users can download the `.mobileconfig` profile directly.
3. Install Filter Lists: In Filter Lists, open the Catalog tab and install desired rulesets (such as AdGuard DNS filter). The browser Web Worker will compile the rules locally and upload binary shards to edge nodes.
4. Verify Resolution: Run a command-line query to verify that the endpoint returns binary DNS responses:

```bash
curl -s -H 'accept: application/dns-message' \
  'https://dns.example.com/dns-query/<DeviceID>?dns=q80BAAABAAAAAAAAB2V4YW1wbGUDY29tAAABAAE' | xxd | head
```

---

## Troubleshooting

### 1. `required secrets have not been set`
Missing required environment variables on initial deploy. Verify that `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are filled in `.env.production`, then rerun `bun run setup` or `bun run secrets:push`.

### 2. Error 10053 or `secret with the same name already exists`
`ACCESS_DEV_BYPASS` is declared as a plain variable in `wrangler.jsonc`. Cloudflare prohibits variables and secrets with the same name. Never add `ACCESS_DEV_BYPASS` to `.env.production` or production Worker secrets.

### 3. Dashboard or API returns HTTP 503
Indicates missing `ACCESS_TEAM_DOMAIN` or `ACCESS_AUD` secrets. Update `.env.production` and execute `bun run secrets:push`. If only analytics pages return 503, `STATS_API_TOKEN` is unset or lacks required permissions.

### 4. API returns HTTP 401
The request did not include a valid Cloudflare Access JWT. This typically occurs when accessing via a hostname not covered by your Access application.

### 5. API returns HTTP 403
Access JWT verification failed. Ensure `ACCESS_AUD` matches the AUD tag of the Access application protecting the hostname, and verify `ACCESS_TEAM_DOMAIN` spelling.

### 6. Client cannot resolve DNS or receives HTML responses
The bypass rule for `dns-query` is missing, causing DNS queries to be redirected to the Access login page. Verify the two Access applications in Step 3 of Prerequisites.

### 7. Custom domain fails to bind
Confirm the root domain is active in your Cloudflare account, and verify that no conflicting A/AAAA/CNAME records exist for the chosen subdomain.

### 8. Analytics page shows no data or fails
- Newly deployed instances require live DNS traffic before Analytics Engine captures metrics.
- Verify `STATS_API_TOKEN` has `Account > Account Analytics > Read` permissions and that `CF_ACCOUNT_ID` matches the token account.
