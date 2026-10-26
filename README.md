# The Newsroom v4.0

A gamified English learning app for primary-school pupils, built on real newspaper articles.
Read → Find evidence → Think → Write → Edit, with each article choosing which stages it uses.

One Cloudflare Worker serves the API and the React app from a single origin. D1 holds the data, KV the sessions, R2 the images.

## Deploy (one command)

```bash
npm install
npx wrangler login                       # once
NEWSROOM_ADMIN_USERNAME=admin \
OPENROUTER_API_KEY=... GROQ_API_KEY_1=... \   # any AI keys you have (all optional)
npm run setup
```

`npm run setup` is idempotent and is the only documented way to do a fresh deploy. It checks your login, runs the full test suite (nothing deploys from a red build), builds the web app, deploys the Worker (D1/KV/R2 are provisioned automatically), applies migrations, creates the first admin (a random password is printed once if you don't supply one) and stores any AI keys as secrets.

Day to day: `npm run deploy` (tests → build → migrate → deploy). CI (`.github/workflows/ci.yml`) runs the same checks and its `deploy` job `needs` the `test` job, so deployment is unreachable from a commit that has not passed.

## Develop

```bash
npm run check          # typecheck everything, verify image references, run every test
npm test               # shared (pure logic) + worker (integration, real local D1/KV/R2)
npm run dev            # build web + wrangler dev (http://localhost:8787)
```

## Layout

| Path | What |
|---|---|
| `packages/shared` | The single source of truth: API contract (`contract.ts`), request schemas, response types, and every **pure** business rule (`domain/`). Imported by both sides; no build step. |
| `apps/worker` | Cloudflare Worker: router derived from the contract, handlers split by domain, data access, AI-grading chain, migrations, integration tests. |
| `apps/web` | React SPA, code-split so pupil, teacher and parent bundles are separate. Its API client is generated from the contract. |
| `scripts` | `setup.ts` (fresh deploy), `deploy.ts` (routine deploy). |

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the decisions (and where this deliberately differs from the brief or from v3.0) and [`docs/REVIEW_CHECKLIST.md`](docs/REVIEW_CHECKLIST.md) before merging anything.
