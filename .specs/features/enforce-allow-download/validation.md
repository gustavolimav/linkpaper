# Enforce allow_download Server-Side Validation

## Validation: enforce-allow-download — FAIL ❌

**Date**: 2026-09-04
**Spec**: `.specs/features/enforce-allow-download/spec.md`
**Diff range**: `main..HEAD` on `fix/enforce-allow-download-server-side` (11 commits, `76600f7` … `59b0435`)
**Verifier**: independent sub-agent (author ≠ verifier), read-only over the real tree

**Verdict**: ❌ **FAIL** — 14/18 ACs fully evidenced, 1 with zero test evidence, 3 partial. The
security core of the feature is proven correct and discriminating (7/7 mutants killed, including
both PDF-regression mutants). The gaps are narrow and none of them reopens the vulnerability.

---

## Task Completion

| Task | Status  | Notes                                                                                 |
| ---- | ------- | ------------------------------------------------------------------------------------- |
| T1   | ✅ Done | `infra/migrations/036-create-blocked-download-attempts.sql` matches design Component 1 |
| T2   | ✅ Done | `types/index.ts:200-231`; `event_type` union widened; stale comment replaced           |
| T3   | ✅ Done | `models/blockedDownload.ts`, `models/shareLink.ts:38,161-179,825-827`; 5 new tests     |
| T4   | ✅ Done | Regression pin at `tests/integration/api/v1/share/[token]/index.test.ts:104-127`       |
| T5   | ✅ Done | `models/dataRoomLink.ts:28,122-133,613`; 4 new tests                                   |
| T6   | ✅ Done | `components/data-room-viewer/DataRoomViewerPage.tsx:491-519` — no test layer           |
| T7   | ✅ Done | `models/activity.ts:66-89`; 3 new tests                                                |
| T8   | ✅ Done | `components/activity/ActivityFeed.tsx:49-50,59-60` — no test layer                     |

All 8 tasks committed, one atomic commit each, Conventional Commit messages.

---

## Spec-Anchored Acceptance Criteria

Paths below are relative to the repo root. Test files:
`F` = `tests/integration/api/v1/share/[token]/file/index.test.ts`,
`D` = `tests/integration/api/v1/data-room-share/[token]/file/index.test.ts`,
`A` = `tests/integration/api/v1/activity/get.test.ts`,
`M` = `tests/integration/api/v1/share/[token]/index.test.ts`.

### P1: Share-link file endpoint enforcement

| Criterion                                                 | Spec-defined outcome                                    | `file:line` + assertion                                                                                                                                              | Result                  |
| --------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| DL-01 non-PDF + `allow_download:false` → `403`, no bytes  | `403`, no file bytes in body                            | `F:40` `expect(response.status).toBe(403)`; `F:41-43` `expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8")`; `F:54-60` exact JSON body | ✅ PASS                 |
| DL-02 `allow_download:true` → `200` + bytes, any mime     | `200` with correct bytes                                | `F:87` `expect(response.status).toBe(200)`; `F:90` `expect(bytes.toString()).toBe("fake docx bytes")`                                                                 | ✅ PASS                 |
| DL-03 PDF + `allow_download:false` → `200` + bytes        | `200`, PDF rendering unchanged                          | `F:97` `expect(document.mime_type).toBe("application/pdf")`; `F:107` `.toBe(200)`; `F:108` content-type `application/pdf`; `F:111` `bytes.length > 0`                | ✅ PASS                 |
| DL-04 existing gates apply first, in existing order       | Revoked/expired/password/NDA/allow-list error, not this `403` | No test requests `/share/[token]/file` on a revoked, expired, password-gated, NDA-gated or allow-list-gated link. Indirect only: `M:104-127` pins the guard out of the shared validator (mutant M7 killed by it) | ⚠️ Partial              |
| DL-05 `403` `message`/`action` in pt-BR                   | Exact pt-BR strings from spec/design                    | `F:54-60` `expect(responseBody).toEqual({name:"ForbiddenError", message:"O download deste arquivo não está habilitado para este link.", action:"Peça ao proprietário do documento…", status:403})` | ✅ PASS                 |

### P1: Data-room file endpoint + "Visualizar" bypass

| Criterion                                                   | Spec-defined outcome                     | `file:line` + assertion                                                                              | Result       |
| ------------------------------------------------------------ | ---------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------ |
| DL-06 non-PDF + `allow_download:false` → `403`, no bytes    | `403`, no bytes, room-flavoured pt-BR     | `D:159` `expect(document.mime_type).not.toBe("application/pdf")`; `D:173` `.toBe(403)`; `D:176-183` exact JSON body with `"…proprietário da data room…"` | ✅ PASS      |
| DL-07 `allow_download:true` → `200` + bytes                 | `200` with correct bytes                 | `D:203` `.toBe(200)`; `D:206` `expect(bytes.toString()).toBe("fake docx bytes")`                     | ✅ PASS      |
| DL-08 PDF + `allow_download:false` → `200` + bytes          | `200`, inline rendering unchanged        | `D:213` `expect(document.mime_type).toBe("application/pdf")`; `D:227` `.toBe(200)`; `D:230` `bytes.length > 0` | ✅ PASS      |
| DL-09 viewer offers no "Visualizar" for non-PDF + false     | Action not rendered; muted label instead | **No test.** Code only: `components/data-room-viewer/DataRoomViewerPage.tsx:491-492` `const canPreview = doc.mime_type === "application/pdf" \|\| doc.allow_download;`, `:503` `{canPreview ? (…Visualizar…) : (…"Pré-visualização não disponível"…)}` | ❌ Not covered |
| DL-10 client-side gate bypassed → server still `403`        | `403` from the endpoint itself           | `D:151-183` is a bare `fetch` with no browser, replaying the "Visualizar" path → `D:173` `.toBe(403)` | ✅ PASS      |
| DL-11 invalid token / missing / foreign `document_id` first | `400` / `404`, unchanged                 | `D:53` `expect(response.status).toBe(400)` (missing `document_id`); `D:71` `.toBe(404)` (foreign document); `D:34` `.toBe(404)` (bad token) — all still pass with the guard in place | ✅ PASS      |

### P2: Persist + surface blocked-download events

| Criterion                                                          | Spec-defined outcome                                     | `file:line` + assertion                                                                                                    | Result       |
| ------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------ |
| DL-12 persist link id, doc id, timestamp, viewer info               | Row written with those fields                            | `A:166-175` `expect(blockedEvents).toHaveLength(1)` + `toMatchObject({document_id, document_title:"Confidential.docx", actor_name:"Blocked Visitor", actor_email:"blocked@example.com"})` — the event only surfaces if `share_link_id` and `document_id` both join correctly | ✅ PASS      |
| DL-13 persistence failure still returns `403`                       | `403` unchanged when the audit INSERT fails              | **No test induces an audit-write failure.** `F:114-137` only makes an anonymous request and asserts `F:133` `.toBe(403)` — it exercises the success path, not the failure path | ⚠️ Partial   |
| DL-14 `/activity` includes `blocked_download`, `created_at DESC`    | Event present, interleaved DESC                          | `A:166` `toHaveLength(1)`; `A:176-177` `expect(responseBody.events[0].event_type).toBe("blocked_download")` / `[1]` `.toBe("link_created")` | ✅ PASS      |
| DL-15 document title + actor fields, `NULL` for inapplicable fields | title/actors populated; `pages_viewed`/`page_count`/`time_on_page` `NULL`, `is_revisit` `false` | `A:167-175` asserts `document_title`/`actor_name`/`actor_email`. **No assertion** on `pages_viewed`, `page_count`, `time_on_page` being `null` or `is_revisit` being `false` | ⚠️ Partial   |
| DL-16 no identifiable viewer → still persisted, actors `NULL`       | Event present with `actor_name`/`actor_email` = `null`   | `A:207-212` `expect(blockedEvent).toMatchObject({document_id, actor_name: null, actor_email: null})`                        | ✅ PASS      |
| DL-17 data-room blocked attempts NOT persisted/surfaced             | No row written                                           | `D:233-261` `expect(after.rows[0]!.count).toBe(before.rows[0]!.count)` around a `403` data-room request (`D:255`)           | ✅ PASS      |
| DL-18 persisted event immutable across later `allow_download` flips | Event unchanged after flipping the link to `true`        | `A:214-259` `expect(afterEvent).toEqual(beforeEvent)` after a `PATCH … {allow_download:true}`                               | ✅ PASS      |

**Status**: ❌ Gaps present — 14/18 fully evidenced, DL-09 uncovered, DL-04 / DL-13 / DL-15 partial.

---

## Edge Cases

- [x] Repeated blocked attempts persist one row each, no dedup — structurally true (`models/shareLink.ts:825-827` calls `denyDownload` unconditionally on the deny branch; nothing dedups). Not asserted by a test.
- [x] Soft-deleted document behaves as existing event types do — `models/activity.ts:66-89` adds no `d.deleted_at` filter, matching both existing branches.
- [ ] **Inactive link + non-PDF + `allow_download:false` returns the inactive-link error, not the download `403`** — no test. Both are `403`, so only the `message` distinguishes them; nothing asserts which one wins. Same gap as DL-04.
- [x] Toggling `allow_download` to `true` takes effect immediately, previously persisted events unchanged — `A:214-259` (immutability half); the live-read half follows from `F:63-91` re-requesting after a `PATCH`.

---

## Discrimination Sensor

Isolated scratch: `git worktree add /tmp/verify-scratch-ead fix/enforce-allow-download-server-side --detach`
(plus a second `main` worktree at `/tmp/verify-main-ead` for the pre-existence control). No `git stash`
was used. Both worktrees removed with `git worktree remove --force`; the real tree's
`git status --porcelain` was byte-identical to the pre-sensor baseline (`?? open-pr.sh`) afterwards.

| #   | File:line                    | Mutation                                                                    | Killed by                                                                              | Result    |
| --- | ---------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------- |
| M1  | `models/shareLink.ts:825`    | Flipped `!row.allow_download` → `row.allow_download`                        | `F` — 3 tests (`403` case, `200`-after-flip case, anonymous-`403` case)                 | ✅ Killed |
| M2  | `models/shareLink.ts:825`    | **Removed the PDF exception** (`&& row.mime_type !== PDF_MIME_TYPE`)        | `F:93-112` "A PDF document with allow_download false still returns 200 with the file bytes" | ✅ Killed |
| M3  | `models/dataRoomLink.ts:126` | **Removed the PDF exception** in `assertDownloadAllowed`                     | `D:209-231` "A PDF document with allow_download false still returns 200 with the file bytes" | ✅ Killed |
| M4  | `models/shareLink.ts:171`    | Dropped the `blockedDownload.record(...)` side effect from `denyDownload`   | `A` — all 3 `blocked_download` tests                                                    | ✅ Killed |
| M5  | `models/activity.ts:71`      | `bda.viewer_name AS actor_name` → `NULL::varchar AS actor_name`             | `A:167-175` `toMatchObject({actor_name:"Blocked Visitor", …})`                           | ✅ Killed |
| M6  | `models/shareLink.ts:175`    | Changed the pt-BR `message` to `"Download blocked."`                        | `F:54-60` exact-body assertion                                                          | ✅ Killed |
| M7  | `models/shareLink.ts:765`    | Migrated the guard into the shared `fetchAndValidateTokenRow` validator     | `M:104-127` "A non-PDF, allow_download: false link still returns 200"                    | ✅ Killed |

**Sensor depth**: P0-expanded (7 mutations — security/data-integrity path).
**Sensor result**: 7/7 mutations killed, 0 survived. ✅ Tests are discriminating for every behavior mutated.

**Critical-regression confirmation (M2/M3)**: the exact regression the Design phase identified — a
guard that also blocks PDFs and therefore breaks in-browser viewing on every "view-only" PDF link —
is caught by a real, non-vacuous assertion on **both** endpoints. Each of those tests asserts the
document's `mime_type` really is `application/pdf` (`F:97`, `D:213`) before asserting `200` and
non-empty bytes, so it cannot pass vacuously.

---

## Gate Check

The real tree is read-only for this Verifier, so `npm run sf` (which runs `prettier --write`) was
replaced by its non-mutating equivalent, `npm run lint:prettier:check && npm run lint:eslint:check`
— the same two checks, without writing to the working tree.

| Gate                        | Command                                                                      | Result                       |
| --------------------------- | ---------------------------------------------------------------------------- | ---------------------------- |
| Formatting (Prettier)       | `npm run lint:prettier:check`                                                | ✅ exit 0 — all files clean   |
| Lint (ESLint)               | `npm run lint:eslint:check`                                                  | ✅ exit 0 — no warnings/errors |
| Types                       | `npx tsc --noEmit`                                                           | ✅ exit 0                     |
| Tests (project scope)       | `npx jest --runInBand --testPathIgnorePatterns "/node_modules/" "/tests/e2e/" "/\.claude/worktrees/"` against a locally started `next dev` | ⚠️ 396 passed, **6 failed**, 402 total across 59 suites |

- **Test count**: 389 on `main` → 402 on this branch. **Delta +13** new tests (5 in `F`, 4 in `D`, 3 in `A`, 1 in `M`).
- **Test integrity**: `git diff main...HEAD --numstat -- tests/` shows **0 deleted lines** across all four test files. Nothing was removed or weakened.
- **Skipped tests**: none.

### The 6 failures — independently traced, unrelated to this feature

All 6 are Stripe billing/webhook tests
(`tests/integration/api/v1/webhooks/stripe/index.test.ts` ×4,
`…/workspaces/[id]/billing/checkout/index.test.ts` ×1, `…/billing/portal/index.test.ts` ×1).
The implementer's claim that they are pre-existing and out of scope is **confirmed**, but the stated
reason was not the actual one. Traced to root cause:

1. Full suite on a clean `main` worktree, using only the committed `.env.development`:
   **58 suites, 389 tests, all passed.**
2. Same 3 Stripe files against a `main`-code server **with the developer's gitignored
   `.env.development.local` copied in**: **the same 6 tests fail, identically.**
3. Root cause: `.env.development.local` (untracked, developer-local) sets a real `STRIPE_SECRET_KEY`
   and different `STRIPE_PRICE_ID_PRO`/`_BUSINESS`. Next.js loads it at higher precedence than
   `.env.development`, so the "Stripe **not** configured → 503" tests get a real Stripe call
   (`400`) instead, and the webhook tests' `price_test_pro`/`price_test_business` literals no longer
   match the configured price IDs (plan resolves to `free`).

The failures are therefore an artifact of this machine's local env file — reproducible on `main`,
independent of every file this branch touches. **Not caused by this feature.**

### The `.claude/worktrees/` jest-scope issue — confirmed pre-existing

`jest.config.js` is byte-identical to `main` on this branch (`git diff main...HEAD -- jest.config.js`
is empty). Its `testPathIgnorePatterns` covers `node_modules` and `<rootDir>/tests/e2e/` only, so
`npx jest --listTests` from the repo root returns **148** files — 89 of them stale copies under
`.claude/worktrees/frosty-montalcini/` and `…/unruffled-chebyshev/` (including Playwright `.spec.ts`
files, which Jest cannot run). Confirmed pre-existing and unrelated; the run above was scoped with an
explicit `--testPathIgnorePatterns` to the repo's real 59 suites. Worth a separate fix task.

---

## Code Quality

| Principle                                                              | Status                                                                                 |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Minimum code                                                           | ✅ Both `/file` routes untouched; no signature or response-shape changes                |
| Surgical changes                                                       | ✅ 8 production files, each change matching `design.md` verbatim                        |
| No scope creep                                                         | ✅ No data-room audit write (AD-004 honored, pinned by `D:233-261`)                     |
| Matches patterns                                                       | ✅ `ForbiddenError`, `assertLinkIsActiveAndNotExpired` naming family, `NULL::type` casts, parameterized SQL, pt-BR errors, default-exported typed model |
| Spec-anchored outcome check (asserted values match spec)               | ✅ for the 14 fully covered ACs; ⚠️ for DL-04 / DL-13 / DL-15; ❌ for DL-09              |
| Per-layer Coverage Expectation met                                     | ⚠️ Domain layer is 1:1 for 14/18 ACs; the frontend layer (DL-09) has no test of any kind |
| Every test maps to a spec requirement — no unclaimed tests             | ✅ All 13 new tests trace to a DL requirement                                            |
| Documented guidelines followed                                         | ✅ `CLAUDE.md` (layering, raw parameterized SQL, migration naming, pt-BR errors, no `console.log`, Conventional Commits) + `tasks.md` Test Coverage Matrix |

**On the `toStrictEqual` → `toEqual` question (independently verified):** the claim holds. Re-running
`F` in the scratch worktree with `toStrictEqual` substituted back in produces
`Expected: {…} / Received: serializes to the same string` — a prototype-identity mismatch on the
`response.json()` object, not a content mismatch. The substitution loses nothing here: a JSON body
cannot carry `undefined`-valued keys, which is the only difference `toEqual` ignores, and all four
keys and values are still asserted exactly. The repo's only three `toStrictEqual` uses
(`…/migrations/post.test.ts:34`, `…/status/get.test.ts:30,34,37`) are all on `Object.keys(...)`
arrays, never on a parsed body — so the stated convention is real. And no assertion anywhere in the
diff was loosened: the four test files have **zero deleted lines**.

---

## Fix Plans

### Fix 1 — DL-09 has no test evidence at any layer (Major)

- **Root cause**: `tasks.md`'s Test Coverage Matrix marks the frontend layer `none` because there is
  no component-test layer. But the repo *does* have a real-browser Playwright suite (`tests/e2e/`,
  `npm run test:e2e`) that already drives public viewer pages, so DL-09 is testable today — it was
  scoped out, not blocked.
- **Fix task**: add a Playwright spec that loads a public data-room-share page containing a non-PDF
  document with `allow_download: false` and asserts no "Visualizar" control is present and the muted
  "Pré-visualização não disponível" label is, then flips `allow_download` to `true` and asserts both
  "Visualizar" and "Baixar" appear. Reuse `tests/e2e/helpers.ts` + `tests/orchestrator.ts` fixtures.
- **Priority**: Major (the server-side backstop DL-10 is verified, so the vulnerability itself is
  closed; this is the UX half of the story going unverified).

### Fix 2 — DL-13's failure path is never exercised (Major)

- **Root cause**: T3's "Done when" treats an anonymous request as evidence for DL-13, but
  `F:114-137` only proves the *success* path returns `403`. Nothing forces `blockedDownload.record`
  to reject, so the `.catch(() => undefined)` at `models/shareLink.ts:171-178` is untested.
- **Fix task**: within a test, make the INSERT fail deterministically and assert `403` is still
  returned with the same body — e.g. `ALTER TABLE blocked_download_attempts RENAME TO …` (or drop
  the `document_id` FK target row) via `infra/database` before the request, restoring it after; the
  file already imports `database` in the sibling data-room suite (`D:2`), so the pattern exists.
- **Priority**: Major (a silent regression here would make every blocked download return `500`).

### Fix 3 — DL-04 / the tie-break edge case is unasserted on `/file` (Minor)

- **Root cause**: the new `F` suite has no revoked / expired / password / NDA / allow-list case, so
  nothing pins that those gates fire before the `allow_download` guard. `M:104-127` pins a related
  but different property (the guard staying out of the shared validator).
- **Fix task**: add one test to `F` — revoked link + non-PDF document + `allow_download: false` →
  `403` with `message === "Este link foi revogado."` (not the download-blocked message). One test
  covers both DL-04 and the spec's third Edge Case.
- **Priority**: Minor (ordering is structurally guaranteed by the guard's placement, and M7 shows
  the placement is pinned from the other direction).

### Fix 4 — DL-15's `NULL` columns are unasserted (Minor)

- **Root cause**: `A:167-175` uses `toMatchObject` on the populated fields only.
- **Fix task**: extend that assertion to `pages_viewed: null, page_count: null, time_on_page: null,
  is_revisit: false`.
- **Priority**: Minor.

### Fix 5 — `jest.config.js` runs stale `.claude/worktrees/` suites (Minor, pre-existing)

- **Root cause**: `testPathIgnorePatterns` lacks `<rootDir>/.claude/`. `npx jest --listTests` returns
  148 files instead of 59, including Playwright specs Jest cannot execute.
- **Fix task**: add `"<rootDir>/.claude/"` to `testPathIgnorePatterns`. Out of scope for this
  feature; file as separate tech debt.
- **Priority**: Minor (pre-existing; makes a bare `npm test` unusable from the repo root).

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status                          |
| ----------- | --------------- | ----------------------------------- |
| DL-01       | Implementing    | ✅ Verified                          |
| DL-02       | Implementing    | ✅ Verified                          |
| DL-03       | Implementing    | ✅ Verified                          |
| DL-04       | Implementing    | ⚠️ Partial — needs Fix 3            |
| DL-05       | Implementing    | ✅ Verified                          |
| DL-06       | Implementing    | ✅ Verified                          |
| DL-07       | Implementing    | ✅ Verified                          |
| DL-08       | Implementing    | ✅ Verified                          |
| DL-09       | Implementing    | ❌ Needs Fix 1 — no test evidence   |
| DL-10       | Implementing    | ✅ Verified                          |
| DL-11       | Implementing    | ✅ Verified                          |
| DL-12       | Implementing    | ✅ Verified                          |
| DL-13       | Implementing    | ⚠️ Partial — needs Fix 2            |
| DL-14       | Implementing    | ✅ Verified                          |
| DL-15       | Implementing    | ⚠️ Partial — needs Fix 4            |
| DL-16       | Implementing    | ✅ Verified                          |
| DL-17       | Implementing    | ✅ Verified                          |
| DL-18       | Implementing    | ✅ Verified                          |

---

## Summary

**Overall**: ⚠️ Issues — not ready to close without Fixes 1 and 2.

**Spec-anchored check**: 14/18 ACs matched the spec-defined outcome; 1 uncovered (DL-09), 3 partial (DL-04, DL-13, DL-15).
**Sensor**: 7/7 mutations killed.
**Gate**: Prettier ✅, ESLint ✅, `tsc --noEmit` ✅; tests 396 passed / 6 failed — all 6 traced to the machine's untracked `.env.development.local` and reproduced identically on `main`.

**What works**:

- The original vulnerability is closed on both endpoints, verified by direct non-browser requests
  returning `403` with zero file bytes and exact pt-BR copy (`F:40-60`, `D:173-183`).
- The critical PDF regression the Design phase was built to avoid is *empirically* prevented: mutants
  M2 and M3, which remove the PDF exception, are both killed by non-vacuous tests that first assert
  the fixture really is a PDF.
- The "Visualizar" bypass has a verified server-side backstop (DL-10) even though its UI half is untested.
- The audit trail is real and correctly scoped: written for share links (M4, M5 killed), never for
  data rooms (`D:233-261`), immutable across `allow_download` flips (`A:214-259`), and anonymous
  attempts still surface with `NULL` actors (`A:207-212`).
- Zero test deletions; +13 tests; no assertion loosened — the one `toStrictEqual` → `toEqual` change
  was independently reproduced and is correct and lossless.

**Issues found**: Fix 1 (DL-09, no test at any layer — add a Playwright spec), Fix 2 (DL-13's
failure path never exercised), Fix 3 (DL-04 ordering unasserted on `/file`), Fix 4 (DL-15 `NULL`
columns unasserted), Fix 5 (pre-existing `jest.config.js` worktree scope — separate tech debt).

**Next steps**: route Fixes 1 and 2 to an implementer, then re-verify. Fixes 3 and 4 are one-line
test additions that can ride along. Fix 5 and the `.env.development.local` gate interference belong
in separate tech-debt items, not this feature.
