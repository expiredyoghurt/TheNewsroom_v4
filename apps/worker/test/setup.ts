import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { setPbkdf2IterationsForTests } from "../src/auth/password";
// Runs once per test file: a fresh, fully migrated database (the SAME migrations production applies).
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS as never);
setPbkdf2IterationsForTests(1000);
// Per-request access logs are useful in production; in tests they only add noise. console.error/warn stay visible.
console.log = () => {};
