// Types for the bindings declared in wrangler.test.toml + injected by vitest.config.ts.
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    SESSIONS: KVNamespace;
    MEDIA: R2Bucket;
    TEST_MIGRATIONS: unknown;
  }
}
