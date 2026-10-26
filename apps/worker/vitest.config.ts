import path from "node:path";
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";

export default defineConfig(async () => {
  // The SAME migration files production applies. No mocked database anywhere.
  const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
  return {
    plugins: [cloudflareTest({
      wrangler: { configPath: "./wrangler.test.toml" },
      miniflare: { bindings: { TEST_MIGRATIONS: migrations, PBKDF2_ITERATIONS: "1000" } },
    })],
    test: { setupFiles: ["./test/setup.ts"], include: ["test/**/*.test.ts"], testTimeout: 20000 },
  };
});
