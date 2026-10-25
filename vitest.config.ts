import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { fakeUpstream } from "./src/worker/test/fake-upstream.ts";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    test: {
      projects: [
        // Shared libraries and dashboard code run in plain Node
        { test: { name: "node", include: ["src/lib/**/*.test.ts", "src/web/**/*.test.ts"] } },
        {
          plugins: [
            cloudflareTest({
              wrangler: { configPath: "./wrangler.jsonc" },
              miniflare: {
                bindings: {
                  TEST_MIGRATIONS: migrations,
                  UPSTREAMS: "https://primary.test/dns-query,https://backup.test/dns-query",
                  ACCESS_DEV_BYPASS: "true",
                  // Tests must not depend on the production Access application in wrangler.jsonc
                  ACCESS_TEAM_DOMAIN: "",
                  ACCESS_AUD: "",
                  CF_ACCOUNT_ID: "test-account",
                  STATS_API_TOKEN: "test-token",
                },
                outboundService: fakeUpstream,
              },
            }),
          ],
          test: {
            name: "worker",
            include: ["src/worker/**/*.test.ts"],
            setupFiles: ["./src/worker/test/apply-migrations.ts"],
          },
        },
      ],
    },
  };
});
