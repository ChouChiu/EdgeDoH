import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parseEnv } from "node:util"
import { cloudflare } from "@cloudflare/vite-plugin"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// The domain is account-specific, so it stays out of wrangler.jsonc: a build variable on Workers Builds, or
// .env.deploy (written by `bun run setup`) locally. Kept out of .env.production, which is uploaded as secrets
const deployEnvFile = resolve(import.meta.dirname, ".env.deploy")
const customDomain =
  process.env.CUSTOM_DOMAIN ||
  (existsSync(deployEnvFile) ? parseEnv(readFileSync(deployEnvFile, "utf8")).CUSTOM_DOMAIN : undefined)

export default defineConfig({
  // cloudflare() runs the Worker from wrangler.jsonc inside workerd next to the dashboard, so `vite dev` serves
  // the API, DoH and the SPA with HMR from one origin and nothing has to be built first
  plugins: [
    react(),
    tailwindcss(),
    cloudflare({
      config: customDomain
        ? { workers_dev: false, routes: [{ pattern: customDomain, custom_domain: true }] }
        : undefined,
    }),
  ],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src/web"),
    },
  },
  server: { port: 8787, strictPort: true },
  preview: { port: 8787, strictPort: true },
  environments: {
    client: {
      build: {
        rolldownOptions: {
          output: {
            // Libraries change far less often than app code, so they get long-lived chunks of their own
            codeSplitting: {
              groups: [
                { name: "react", test: /node_modules[\\/](react|react-dom|scheduler|react-router)[\\/]/ },
                { name: "radix", test: /node_modules[\\/](radix-ui|@radix-ui|@floating-ui)[\\/]/ },
                {
                  name: "charts",
                  test: /node_modules[\\/](recharts|victory-vendor|d3-[^\\/]+|internmap|@reduxjs|redux|react-redux|reselect|immer|es-toolkit|decimal\.js-light|eventemitter3)[\\/]/,
                },
              ],
            },
          },
        },
      },
    },
  },
  worker: { format: "es" },
})
