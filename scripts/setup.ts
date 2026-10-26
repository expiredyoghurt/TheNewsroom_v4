// ONE COMMAND, from a fresh clone to a running school:   npm run setup
// Idempotent and re-runnable. It is the ONLY documented way to do a fresh deploy.
//
//   NEWSROOM_ADMIN_USERNAME   (default: admin)
//   NEWSROOM_ADMIN_PASSWORD   (default: generated and printed ONCE)
//   OPENROUTER_API_KEY, GEMINI_API_KEY_1/2, GROQ_API_KEY_1/2   (optional: set any you have)
//
// Requires `npx wrangler login` once (or CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID in CI).
import { hashPassword } from "../apps/worker/src/auth/password";
import { adminBootstrapSql } from "../apps/worker/src/bootstrap";
import { randomPassword, run, step, wrangler } from "./lib";

const TOTAL = 6;
const SECRETS = ["OPENROUTER_API_KEY", "GEMINI_API_KEY_1", "GEMINI_API_KEY_2", "GROQ_API_KEY_1", "GROQ_API_KEY_2"] as const;

step(1, TOTAL, "Checking Cloudflare login");
const who = wrangler(["whoami"], { quiet: true, allowFail: true });
if (!who.ok || /not authenticated/i.test(who.out)) { console.error("Not logged in. Run `npx wrangler login` (or set CLOUDFLARE_API_TOKEN), then re-run `npm run setup`."); process.exit(1); }

step(2, TOTAL, "Running the full test suite (nothing deploys from a red build)");
run("npm", ["run", "check"]);

step(3, TOTAL, "Building the web app");
run("npm", ["run", "build"]);

step(4, TOTAL, "Deploying the Worker (D1, KV and R2 are created automatically on first deploy)");
wrangler(["deploy"]);

step(5, TOTAL, "Applying database migrations");
wrangler(["d1", "migrations", "apply", "DB", "--remote"]);

step(6, TOTAL, "Creating the first admin and setting any AI keys you provided");
const username = process.env.NEWSROOM_ADMIN_USERNAME || "admin";
const supplied = process.env.NEWSROOM_ADMIN_PASSWORD;
const password = supplied || randomPassword();
const before = wrangler(["d1", "execute", "DB", "--remote", "--json", "--command", "SELECT COUNT(*) AS n FROM teachers WHERE role = 'admin'"], { quiet: true });
const alreadyHasAdmin = /"n":\s*[1-9]/.test(before.out);
if (alreadyHasAdmin) console.log("An admin already exists: leaving accounts untouched.");
else {
  wrangler(["d1", "execute", "DB", "--remote", "--command", adminBootstrapSql({ username, name: "School Admin", passwordHash: await hashPassword(password) })], { quiet: true });
  console.log(`\nAdmin created.\n  username: ${username}\n  password: ${supplied ? "(the one you supplied)" : password}${supplied ? "" : "\n  Save this now: it is not stored anywhere and will not be shown again."}`);
}
for (const name of SECRETS) {
  const v = process.env[name];
  if (v) { wrangler(["secret", "put", name], { input: v, quiet: true }); console.log(`Set secret ${name}`); }
}
if (!SECRETS.some((s) => process.env[s])) console.log("No AI keys provided: Workers AI (if enabled on your account) and the built-in keyword grader will be used. Re-run with keys set to add providers.");
console.log("\n✔ Done. Open the Worker URL printed above and sign in as staff.");
