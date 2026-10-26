// Fails the build if the UI references an image that is not in apps/web/public (a broken <img> is
// invisible to the type checker and to the API tests). Part of `npm run check`, so CI runs it too.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { LEVELS, tierForLevel } from "../packages/shared/src/domain/xp";

const SRC = resolve(import.meta.dirname, "../apps/web/src");
const PUBLIC = resolve(import.meta.dirname, "../apps/web/public");

function* walk(dir: string): Generator<string> {
  for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) yield* walk(p); else if (/\.(tsx?|css)$/.test(f)) yield p; }
}
const missing: string[] = [];
const seen = new Set<string>();
const literal = /["'`(](\/[A-Za-z0-9_\-/.]+\.(?:png|jpe?g|svg|webp|gif))["'`)]/g;
for (const file of walk(SRC)) for (const m of readFileSync(file, "utf8").matchAll(literal)) seen.add(m[1]!);
// Dynamic path in RankBadge: /rank-badges/tier-${tier}.png
for (const l of LEVELS) { const t = tierForLevel(l.level); if (t) seen.add(`/rank-badges/tier-${t}.png`); }
for (const path of seen) {
  const file = join(PUBLIC, path);
  if (!existsSync(file) || statSync(file).size === 0) missing.push(path);
}
if (missing.length) { console.error(`✖ ${missing.length} image reference(s) with no file in apps/web/public:\n  ${missing.join("\n  ")}`); process.exit(1); }
console.log(`✔ ${seen.size} image references all resolve to files in apps/web/public`);

// ---- the Pressroom scene: hotspot geometry + weight budget ----
// The six hotspots are PERCENTAGES of this image, so a re-export with a different aspect ratio would
// silently misalign every desk. The budget keeps the home page light on school Wi-Fi.
const SCENE = join(PUBLIC, "newsroom-scene.webp");
const SCENE_ASPECT = 1536 / 1024;
const SCENE_BUDGET_BYTES = 500 * 1024;
function webpSize(b: Buffer): { w: number; h: number } {
  if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WEBP") throw new Error("not a WebP file");
  const kind = b.toString("ascii", 12, 16);
  if (kind === "VP8 ") return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  if (kind === "VP8X") return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
  throw new Error(`unsupported WebP variant "${kind.trim()}" (lossless?). Export the scene as lossy WebP.`);
}
{
  const bytes = readFileSync(SCENE);
  let size: { w: number; h: number };
  try { size = webpSize(bytes); } catch (e) { console.error(`✖ newsroom-scene.webp: ${(e as Error).message}`); process.exit(1); }
  const { w, h } = size;
  const problems: string[] = [];
  if (Math.abs(w / h - SCENE_ASPECT) > 0.002) problems.push(`aspect ratio is ${w}x${h}; hotspots assume 3:2 (1536x1024). Re-check every hotspot box in Pressroom.tsx before changing this.`);
  if (bytes.length > SCENE_BUDGET_BYTES) problems.push(`${Math.round(bytes.length / 1024)} KB exceeds the ${SCENE_BUDGET_BYTES / 1024} KB budget.`);
  if (problems.length) { console.error(`✖ newsroom-scene.webp: ${problems.join(" ")}`); process.exit(1); }
  console.log(`✔ newsroom-scene.webp is ${w}x${h}, ${Math.round(bytes.length / 1024)} KB (budget ${SCENE_BUDGET_BYTES / 1024} KB)`);
}
