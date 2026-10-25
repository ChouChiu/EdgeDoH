# HANDOFF.md

This document records traps, pitfalls, edge cases, and lessons learned across development, deployment, and configuration tasks.

> **Rule for Agents:**  
> 1. Check this file **before starting any new task** to avoid repeating past mistakes.  
> 2. Append new findings and pitfalls encountered during tasks immediately.

---

## Pitfall Log & Lessons Learned

| Date | Category | Issue / Trap Encountered | Root Cause & Solution |
| :--- | :--- | :--- | :--- |
| *(Initial)* | Setup | Placeholder | Document issues here as they are resolved. |
| 2026-10-25 | Tooling | `wrangler types` and `tsconfig` layout | `wrangler types [path]` supports explicit output path (`src/worker/worker-configuration.d.ts`), which automatically shortens module imports to `./index`. Sub-tsconfigs placed in `tsconfig/` must resolve relative paths (`../src/*`) while keeping `@/*` alias in root `tsconfig.json` for shadcn CLI. |
| 2026-10-25 | Config | `wrangler.example.jsonc` placeholders | Wrangler rejects an empty string id (`"kv_namespaces[0]" bindings should have a string "id" field`), so the example config must use non-empty placeholders (`<kv-namespace-id>`). The local D1/KV state in `.wrangler/state` is keyed by that string, so tests and `bun run dev` work with placeholders unchanged. |
| 2026-10-25 | Deployment | Untracked `wrangler.jsonc` breaks the Deploy button | `wrangler.jsonc` holds account resource IDs and is now gitignored (template: `wrangler.example.jsonc`, created automatically by `bun run setup`). The Deploy to Cloudflare flow reads the wrangler config from the forked repository, so that path requires committing a copy of the example to your own fork and pointing the button's `url` at it. |
