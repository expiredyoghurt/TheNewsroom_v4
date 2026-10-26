// Day-to-day deploy:   npm run deploy      (tests -> build -> migrate -> deploy)
// CI runs the same steps, and only after the test job has passed.
import { run, step, wrangler } from "./lib";
step(1, 4, "Tests + typecheck"); run("npm", ["run", "check"]);
step(2, 4, "Build"); run("npm", ["run", "build"]);
step(3, 4, "Migrate (additive migrations run before the new code goes live)"); wrangler(["d1", "migrations", "apply", "DB", "--remote"]);
step(4, 4, "Deploy"); wrangler(["deploy"]);
console.log("\n✔ Deployed.");
