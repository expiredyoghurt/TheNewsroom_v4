# Architecture and decisions (v4.0)

## The two failure modes, designed out

**No tests (v3.0)** → ~77 pure-logic tests in `packages/shared` and ~115 integration tests in `apps/worker` that run against the *real* local D1 (workerd/SQLite) using the *same migration files* production applies. Nothing mocks the database. CI gates deploy. The v3 regression (a not-yet-started assignment hiding a free-practice class's article list) is a named test at both the pure level and the HTTP level. The suite was mutation-checked: deliberately re-introducing the access bug, an incrementing XP total, and a per-article query each fail specific tests.

**N+1 and duplicated rules (v3.0)** → `Db` counts round trips; every response carries `x-db-round-trips`; tests assert the hub, rankings, GOAT, parent view, progress grid and roster import are constant in the number of rows. `resolveArticleAccess` is the single implementation of the article/class/assignment merge. It returns a result and never throws; the single-article routes turn `blocked` into a 403, the hub renders it as a locked card.

## The three-layer rule (`packages/shared/src/domain/access.ts`)

* **Article loop = hard ceiling.** Nothing can switch on a stage the article has off.
* **Assignment overrides class defaults** while its window is open (inclusive boundaries).
* **Free practice:** an assignment outside its window is simply not in force (class defaults apply). **Assigned-only:** no assignment → hidden; not started / past due → locked card, new work refused.
* Read (Newsstand) is always on when the article is open; Edit requires Writing.
* "Complete" (badge + bonus) = every stage that is enabled in the pupil's *effective* rules and has a task has been passed. Zero required stages is never complete. Hub "published" and the badge use the same function.

## XP and levels

`xp_log` is the source of truth, with `UNIQUE(student_id, source_key)` so every award is idempotent. `students.xp_total` is a cache that is **recomputed from the log** in the same batch (never incremented), so a bad value self-heals on the next award. **Level is not stored**: it is `levelForXp(total)`.

## Shuffle

Seeded from `studentId : taskId : attemptNumber` (FNV-1a → mulberry32). Reopening a question gives the same order; a new attempt gets a fresh one (same as v3's per-attempt behaviour, so pupils can't just memorise "it was C"). Nothing is stored. The client sends the *position* it clicked plus the attempt number; the server maps back through the same seed. The answer key and evidence chunk are never sent before submission (v3 sent the evidence chunk id).

## AI grading

Submissions are **saved first**, graded in the background (`waitUntil`), and the pupil polls. Chain: OpenRouter (free-only) → Gemini ×2 → Groq ×2 → Workers AI → keyword fallback (same order as v3; only configured providers are tried). Each provider has a timeout and the chain has an overall deadline. Model output is validated and **clamped** (the model's own total is ignored); a claimed article connection with no verified evidence chunk is capped; unsupported claims cost accuracy marks. Pupil text is fenced as data in the prompt. Every grading execution is a row in `grading_runs` (provider, model, latency, per-provider attempt log, fallback reason). A grade stuck `pending` for 45 s is rescued by the poll with the fallback so a pupil never waits forever. Teachers can re-run AI grading; `/api/admin/grading-stats` gives "X% of gradings used the fallback".

## Artwork (retained from v3.0)

All of v3.0's images are copied **byte-for-byte** into `apps/web/public` and served by the Worker's static-assets binding: the newsroom scene, investigation corkboard, GOAT podium, published stamp, five rank-badge tiers and five section icons. They are used where v3 used them: the scene Pressroom with its six hand-aligned hotspots (and the station list that replaces it under 600 px), the corkboard on the Investigation Desk, the podium on the GOAT board, the stamp on the "My wall" cards, rank badges beside levels (pupil header, class table, GOAT, parent view), and section icons on story cards. `docs/archive/newsroom-scene-v1.png` (the retired first artwork) is kept for the record; nothing references it.

Two things changed on purpose: station badges ("3 waiting", "All done ✓") and the stories each station offers are now computed by one tested pure function (`stationArticles`) from the pupil's *effective* rules, where v3 counted from the article's loop flags and ignored assignments; and `npm run check` (so CI) fails if the UI references an image that is not in `public/`.

The Pressroom scene is shipped as **lossy WebP (quality 88): 276 KB instead of 2.2 MB (an 87% cut)** at the original 1536×1024, so the hotspot percentages are untouched. Compared 1:1 against the original, text and edges are indistinguishable. The lossless master is kept at `docs/archive/newsroom-scene-original.png` (not shipped); re-export from it with `quality=88`, never re-compress the WebP. `npm run check` fails if the scene's aspect ratio is not 3:2 (the six hotspot boxes in `Pressroom.tsx` are percentages of the image and are not tied to it in code), if it is not lossy WebP, or if it exceeds 500 KB.

Remaining weight: the other four large images (corkboard 2.3 MB, podium 1.4 MB, stamp 0.7 MB and five 0.24 MB rank badges) are still v3's unoptimised PNGs, about 5.6 MB in total (about 6 MB of artwork overall). They load on their own pages, not on the Pressroom home page, so they matter less; the same WebP treatment would apply if wanted.

## Where this differs from the brief, and why

| Brief | v4.0 | Why |
|---|---|---|
| KV for shuffle seeds | none | A deterministic seed needs no storage. |
| KV counters for rate limits | Rate Limiting binding (coarse) **plus** a D1 per-account lockout | KV is eventually consistent and non-atomic; counters can be raced. |
| `level` column | none | Derived; can't drift. |
| `ai_*` columns on the attempt | `grading_runs` table | Re-grades add history instead of overwriting it. |
| Thumbnails inline in D1 | R2 for both images | One code path; browser-resized thumbnails are a few KB. (v3 inlined them to reduce moving parts; R2 is needed for page photos anyway.) |
| "CORS from one source of truth" | no CORS | One origin. `Allow` for 405/OPTIONS is derived from the route table. |
| Pupil login "class + index + password" | **Reporter ID + press pass**, as in v3.0 | Matches the existing pupils' login. Easy to switch if you want class+index. |
| Parent sees "their own child" | Class roster by initials + surname, shared class password, as in v3.0 | Matches v3.0. A per-child parent account would need new identity design. |
| Similarity vs the article | n-gram copy fraction vs article (+ model answers on retries) | Deterministic and testable. v3 used embeddings against model answers only. Default threshold 0.5 on a different scale from v3's 0.85. |

## Fixed v3.0 gaps

* No endpoint existed to set the parent password or create a class (SQL only). Both are now in the UI/API.
* v3 had four copies of the access rule; one now.
* Article import inserted the article then compensated on failure; import and fork are now single atomic batches.
* Roster import queried per row; now 2 reads + 1 batch.
* The review queue only covered reflect attempts; it now covers writing too, and fallback-graded work.
* Unprocessed `pending` grades could be stranded; now rescued.

## Known limits (honest list)

* **Not yet deployed or run against real Cloudflare.** `scripts/setup.ts` relies on wrangler's *automatic resource provisioning*, which was in beta when this was written. If your wrangler version lacks it, create the D1/KV/R2 resources once and add their ids to `apps/worker/wrangler.toml`; everything else is unchanged.
* The Rate Limiting binding and Workers AI are not exercised by tests (faked); the per-account D1 lockout is.
* Sessions live in KV (eventually consistent). A password reset blocks new logins immediately but an existing session survives until its TTL (pupils 6 h).
* No data migration from a v3.0 D1 yet. The schema is cleaner (no `level`, `grading_runs`, R2 keys); a one-off import script is straightforward but is a separate task.
* The UI is functional, not yet styled to v3.0's design. No browser/e2e tests; the client is type-checked against the contract and builds, but has not been clicked through.
* The shared contract bundles zod into the web client (~40 KB gzip). If that matters, split route metadata from the schemas.
* PBKDF2 is capped at 100k iterations on Workers; the D1 lockout compensates.
* R2 objects are never deleted (forks share them). Add a sweeper if storage becomes a concern.
