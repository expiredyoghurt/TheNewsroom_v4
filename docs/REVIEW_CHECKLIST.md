# Review checklist / Definition of done

A change is not done when it works in manual testing. It is done when **all** of these hold.

1. **Business logic is a pure function, unit-tested.** New rules live in `packages/shared/src/domain` (or a pure module beside the handler) with tests in the same commit. No I/O in them.
2. **No N+1.** Any endpoint returning N things fetches related data in a fixed number of round trips (JOIN, correlated subquery, or one `json_each(?)` batch). Add a test that seeds few vs many rows and asserts equal `x-db-round-trips` (see `test/hub.test.ts`). Never `WHERE id IN (?, ?, ...)` with a variable number of binds (D1 caps bound parameters at ~100); bind one JSON array and use `json_each`.
3. **Writes with no data dependency are one `db.batch()`.** Attempt + progress + XP + badge land together or not at all.
4. **One implementation per rule.** If you are about to re-implement access gating, completion, XP or level logic, stop and call the shared function. Call sites differ in what they *do* with the result (throw vs display), never in how it is computed.
5. **Errors carry context.** Unexpected errors go through the router, which logs method, path, route, role, subject and request id. Never `console.error(err)`. Never log bodies, tokens, passwords or pupil names.
6. **Request/response shapes exist once**, in `packages/shared`. A new route = one entry in `contract.ts`; the Worker will not compile without a handler and the web client gets it for free.
7. **Every bug fix ships its regression test**, in the same commit.
8. **No manual deploy step is added** that is not also in `scripts/setup.ts`.
9. **Handlers stay in their domain file** (`staffClasses`, `staffArticles`, `staffAssignments`, `staffReview`, `tasks`, `hub`, `auth`). Split a file when it gains an unrelated concern.
