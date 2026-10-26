import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

export const ROOT = resolve(import.meta.dirname, "..");
export const WORKER_CONFIG = resolve(ROOT, "apps/worker/wrangler.toml");

export function run(cmd: string, args: string[], opts: { input?: string; quiet?: boolean; allowFail?: boolean } = {}): { ok: boolean; out: string } {
  const r = spawnSync(cmd, args, { cwd: ROOT, input: opts.input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], env: process.env });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (!opts.quiet) process.stdout.write(out);
  if (r.status !== 0 && !opts.allowFail) {
    console.error(`\n✖ \`${cmd} ${args.join(" ")}\` failed (exit ${r.status}).`);
    process.exit(r.status ?? 1);
  }
  return { ok: r.status === 0, out };
}
export const wrangler = (args: string[], o: Parameters<typeof run>[2] = {}) => run("npx", ["wrangler", ...args, "--config", WORKER_CONFIG], o);
export const step = (n: number, total: number, msg: string) => console.log(`\n[${n}/${total}] ${msg}`);
export const randomPassword = () => randomBytes(12).toString("base64url");
