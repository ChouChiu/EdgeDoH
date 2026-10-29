# Agent Directives & Repository Standards

## 1. Eight Core Directives
1. Honor source inspection; shun API guessing. Inspect declarations, types, and documentation before calling or authoring interfaces. Never extrapolate parameters or return types.
2. Honor requirement alignment; shun ambiguous execution. Clarify underspecified instructions with the user before committing to non-trivial or irreversible actions.
3. Honor human confirmation; shun assumed business logic. Never invent domain constraints, policy rules, or user workflows without explicit confirmation.
4. Honor component reuse; shun interface sprawl. Reuse existing utilities, schemas, and abstractions in src/lib, src/worker/shared, and src/web/shared before writing new ones.
5. Honor proactive verification; shun skipped testing. Validate every change with automated tests, type checks, and builds before reporting completion.
6. Honor architectural boundaries; shun convention breaking. Maintain strict separation between Worker runtime (src/worker), Web client (src/web), and shared logic (src/lib). Respect feature-driven modularity.
7. Honor intellectual honesty; shun feigned competence. Explicitly state missing context, unknowns, and uncertainties instead of fabricating answers.
8. Honor surgical refactoring; shun reckless broad modifications. Keep diffs focused, minimal, and traceable. Avoid widespread search-and-replace edits.

## 2. Operational Rules

### First-Principles Reasoning
Deconstruct requests to fundamental objectives, real-world constraints, and measurable success criteria. Never adopt conventions, boilerplate patterns, or habitual workflows without validating their utility against the primary goal.

### Communication Protocol
- Simple inquiries: Return direct, concise answers with zero conversational overhead.
- Complex tasks & designs: Use answer-me-with-html to present structured breakdowns, interactive UI controls, comparative tables, and architecture diagrams.

### Pitfall Tracking via HANDOFF.md
- Pre-task: Read HANDOFF.md before executing any task to prevent repeating documented traps.
- Post-task: Immediately record non-obvious failure modes, platform quirks, and workarounds into HANDOFF.md upon discovery.

### Production & Performance Budgets
Every task touching deployment, builds, or production code must define and verify performance acceptance criteria:
- Worker CPU budget: DoH hot path (/dns-query) must execute well under the 10 ms free-tier CPU limit; bypass router overhead and keep parsing zero-alloc where feasible.
- Memory & cold start: Keep worker bundle lean; avoid dynamic module bloat in request paths.
- Asset bundle size: Web SPA assets must tree-shake effectively via Vite and Tailwind CSS v4.
- Cloudflare binding limits: Respect rate, size, and subrequest quotas across D1, KV (RULES), Durable Objects (DEVICE_CLIENTS), and Analytics Engine (QUERY_LOG).

### UI Design Philosophy
Avoid unnecessary secondary labels and descriptions. Let the layout do the explaining. Leverage visual hierarchy, whitespace, grouping, and standard affordances to convey structure and intent.

## 3. Architecture & Feature-Driven Modularity

### Directory Structure & Responsibilities
- src/lib: Platform-agnostic algorithms and codecs. Subpath aliases #dns (DNS wireformat codec), #filter (rule compilation & matching engine) and #contract (limits and enums shared by the Worker API and the dashboard). No dependency on Cloudflare or browser APIs.
- src/worker: Cloudflare Worker backend. Main entry at src/worker/index.ts. Hono router handles /api/*; DoH endpoint (/dns-query/:id) bypasses Hono routing to maximize raw throughput and conserve CPU time.
- src/web: React 19 SPA dashboard using Vite, Tailwind CSS v4, Radix UI primitives, and TanStack Query.
- src/cli: Bun scripts for local setup, seeding, and management tasks.

### Feature-Driven Rules
Code is strictly organized by domain under src/worker/features/<name> and src/web/features/<name>:
- Worker features co-locate api.ts (Hono sub-router), store.ts (database/KV logic), and *.test.ts.
- Web features co-locate pages, dialogs, cards, hooks, api.ts (query/mutation hooks), and tests.
- Avoid cross-feature imports. Shared primitives belong in src/web/shared/ui (shadcn components), src/web/shared/hooks, or src/worker/shared.

### Storage & State Management
- D1 Database (DB): Relational source of truth for devices, lists, settings, and custom rules.
- KV Namespace (RULES): Compiled binary rule snapshots compiled via Web Worker (compile.worker.ts) and served to DoH handlers.
- Durable Objects (DEVICE_CLIENTS): Tracks active client IP subnets per device and enforces device quota limits.
- Analytics Engine (QUERY_LOG): Writes structured DNS query telemetry without blocking request resolution.

### Migrations & Schema Evolution
- D1 migrations reside in migrations/ named with sequential prefixes (e.g. 0001_devices.sql).
- Never modify existing applied migrations; append new migration files for schema changes.
- Apply locally via bun run db:migrate:local; apply remotely via bun run db:migrate:remote.

### Internationalization (i18n)
All user-facing text in src/web must support all three locales in src/web/shared/i18n/locales:
- en-US (English)
- zh-Hans (Simplified Chinese)
- zh-Hant (Traditional Chinese)
Never hardcode raw UI strings inside web feature components.

## 4. Verification Toolchain

Run full verification before marking any task as complete:
- Type check: bun run typecheck (validates worker-configuration.d.ts and runs tsc -b)
- Unit tests: bun run test (executes Vitest suite for lib, web, and worker environments)
- Production build: bun run build (verifies TypeScript build and Vite client assets)
- Local dev server: bun run dev
- Local setup & test runner: bun run setup / bun run cli
