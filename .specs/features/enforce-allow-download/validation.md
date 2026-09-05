# enforce-allow-download Validation

**Date**: 2026-09-04
**Spec**: `.specs/features/enforce-allow-download/spec.md`
**Diff range**: `main..HEAD` (branch `fix/enforce-allow-download-server-side`, 15 commits `76600f7..e63d252`)
**Verifier**: independent sub-agent (author ≠ verifier) — re-verification iteration 2 of 3
**Verdict**: PASS

Coverage was re-derived from scratch against the test files on disk; the
iteration-1 report was not used as input. Every citation below was read in
the current working tree, and every cited file was executed as part of the
gate run recorded further down.

---

## Task Completion

| Task | Status  | Notes                                                                                       |
| ---- | ------- | ------------------------------------------------------------------------------------------- |
| T1   | ✅ Done | `infra/migrations/036-create-blocked-download-attempts.sql` — append-only, no trigger       |
| T2   | ✅ Done | `types/index.ts:201-228` — `BlockedDownload*` types, `ActivityEvent` union widened          |
| T3   | ✅ Done | `models/blockedDownload.ts`, `models/shareLink.ts:156-180` + `:825-827`                     |
| T4   | ✅ Done | Shared-validator regression pin, `tests/integration/api/v1/share/[token]/index.test.ts:104` |
| T5   | ✅ Done | `models/dataRoomLink.ts:118-133` + `:580-620`                                               |
| T6   | ✅ Done | `components/data-room-viewer/DataRoomViewerPage.tsx:485-500`                                |
| T7   | ✅ Done | `models/activity.ts:67-89` (third `UNION ALL` branch)                                       |
| T8   | ✅ Done | `components/activity/ActivityFeed.tsx:49-51`, `:59-61`                                      |

All eight tasks are checked off in `tasks.md` and each has a matching commit
in the diff range.

---

## Spec-Anchored Acceptance Criteria

Shorthand for file paths used in the evidence column:

- `SF` = `tests/integration/api/v1/share/[token]/file/index.test.ts`
- `SM` = `tests/integration/api/v1/share/[token]/index.test.ts`
- `DR` = `tests/integration/api/v1/data-room-share/[token]/file/index.test.ts`
- `AC` = `tests/integration/api/v1/activity/get.test.ts`
- `E2E` = `tests/e2e/data-room-download-gate.spec.ts`

### P1: Enforce download restriction on the public share-link file endpoint

| Criterion (WHEN X THEN Y)                                                            | Spec-defined outcome                                                                                                                               | `file:line` + assertion                                                                                                                                                                                                                                                                   | Result  |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| DL-01 — non-PDF + `allow_download: false` → `403`, no file bytes                     | HTTP `403`; body carries no file bytes                                                                                                             | `SF:41` — `expect(response.status).toBe(403)`; `SF:42` — `expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8")`; `SF:55` — `expect(responseBody).toEqual({...})` (JSON error object, not bytes)                                                           | ✅ PASS |
| DL-02 — `allow_download: true` → `200` with the file bytes, regardless of mime       | HTTP `200`; response body equals the uploaded bytes                                                                                                | `SF:88` — `expect(response.status).toBe(200)`; `SF:91` — `expect(bytes.toString()).toBe("fake docx bytes")` (non-PDF, flipped `false`→`true` via PATCH at `SF:75-82`)                                                                                                                     | ✅ PASS |
| DL-03 — PDF + `allow_download: false` → `200` with the file bytes                    | HTTP `200`; inline PDF rendering unchanged                                                                                                         | `SF:98` — `expect(document.mime_type).toBe("application/pdf")`; `SF:108` — `expect(response.status).toBe(200)`; `SF:109` — content-type `application/pdf`; `SF:112` — `expect(bytes.length).toBeGreaterThan(0)`                                                                           | ✅ PASS |
| DL-04 — existing checks (invalid/inactive/expired/password/NDA/allow-list) run first | The pre-existing failure is returned, not the download `403`                                                                                       | `SF:203` — `expect(response.status).toBe(403)`; `SF:206` — `expect(responseBody).toEqual({ name: "ForbiddenError", message: "Este link foi revogado.", action: "Solicite um novo link ao proprietário do documento.", status: 403 })` on a revoked, non-PDF, `allow_download: false` link | ✅ PASS |
| DL-05 — `403` `message` and `action` in pt-BR                                        | `"O download deste arquivo não está habilitado para este link."` / `"Peça ao proprietário do documento para habilitar o download, se necessário."` | `SF:57-59` — exact string equality inside the `toEqual` at `SF:55`; re-asserted under audit failure at `SF:171-173`                                                                                                                                                                       | ✅ PASS |

Supporting regression pin (not an AC, claimed by T4 and by `design.md`'s
Risks table row 1): `SM:123` — `expect(response.status).toBe(200)` and
`SM:126` — `expect(responseBody.document.mime_type).toBe(document.mime_type)`
prove the guard did not migrate into the shared `fetchAndValidateTokenRow`
validator that the metadata endpoint also uses.

**DL-04 precision note (non-blocking):** the AC enumerates six disjuncts
(invalid, inactive, expired, password-mismatched, NDA, email allow-list);
only the _inactive/revoked_ disjunct is asserted. It is the strongest single
choice available — `assertLinkIsActiveAndNotExpired` is the _first_ gate in
`models/shareLink.ts:692`, and the download gate sits after the entire
validator at `models/shareLink.ts:825`, so any relocation of the gate ahead
of the validator is caught. Mutation M5 below confirms this empirically.
Ordering against the _later_ gates (password/NDA/allow-list) is structural,
not asserted.

### P1: Data-room file endpoint parity + "Visualizar" bypass

| Criterion (WHEN X THEN Y)                                                       | Spec-defined outcome                                                        | `file:line` + assertion                                                                                                                                                                                                                                                                                                                                                 | Result  |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| DL-06 — data-room non-PDF + `allow_download: false` → `403`, no bytes           | HTTP `403`, pt-BR room-flavoured error, no bytes                            | `DR:159` — `expect(document.mime_type).not.toBe("application/pdf")`; `DR:173` — `expect(response.status).toBe(403)`; `DR:176` — `expect(responseBody).toEqual({ name: "ForbiddenError", message: "O download deste arquivo não está habilitado para este link.", action: "Peça ao proprietário da data room para habilitar o download, se necessário.", status: 403 })` | ✅ PASS |
| DL-07 — data-room `allow_download: true` → `200` with bytes, regardless of mime | HTTP `200`; body equals uploaded bytes                                      | `DR:203` — `expect(response.status).toBe(200)`; `DR:206` — `expect(bytes.toString()).toBe("fake docx bytes")`                                                                                                                                                                                                                                                           | ✅ PASS |
| DL-08 — data-room PDF + `allow_download: false` → `200` with bytes              | HTTP `200`; inline rendering unchanged                                      | `DR:213` — `expect(document.mime_type).toBe("application/pdf")`; `DR:227` — `expect(response.status).toBe(200)`; `DR:230` — `expect(bytes.length).toBeGreaterThan(0)`                                                                                                                                                                                                   | ✅ PASS |
| DL-09 — viewer presents no "Visualizar" action for non-PDF + `false`            | No "Visualizar" action capable of fetching that document's file is rendered | `E2E:53` — `await expect(page.getByRole("button", { name: /Visualizar/ })).toHaveCount(0)`; `E2E:56` — `await expect(page.getByText("Pré-visualização não disponível")).toBeVisible()`; positive control after flipping to `true`: `E2E:63` and `E2E:66` — both `Visualizar` and `Baixar` `toBeVisible()`                                                               | ✅ PASS |
| DL-10 — bypassing the client restriction still yields the server `403`          | HTTP `403` from a direct request replaying the "Visualizar" code path       | `DR:169-173` — direct `fetch` of the exact URL shape `handleOpenDocument` uses (`/api/v1/data-room-share/{token}/file?document_id=...`), `expect(response.status).toBe(403)`                                                                                                                                                                                            | ✅ PASS |
| DL-11 — invalid token / missing `document_id` / foreign document checked first  | `404` / `400` / `404` respectively, before `allow_download` is evaluated    | `DR:34` — `expect(response.status).toBe(404)` (nonexistent token); `DR:53` — `expect(response.status).toBe(400)` (missing `document_id`); `DR:71` — `expect(response.status).toBe(404)` (document not in this room)                                                                                                                                                     | ✅ PASS |

### P2: Persist blocked-download attempts and surface them in the Activity Feed

| Criterion (WHEN X THEN Y)                                                     | Spec-defined outcome                                                                                                                         | `file:line` + assertion                                                                                                                                                                                                                                                                      | Result  |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| DL-12 — persist link id, document id, timestamp, viewer identity              | A record exists carrying those fields                                                                                                        | `AC:166` — `expect(blockedEvents).toHaveLength(1)`; `AC:168-171` — `document_id: document.id`, `document_title: "Confidential.docx"`, `actor_name: "Blocked Visitor"`, `actor_email: "blocked@example.com"`; timestamp exercised by the `created_at DESC` ordering assertion at `AC:180-181` | ✅ PASS |
| DL-13 — persistence failure SHALL NOT change the client response              | Still HTTP `403` with the identical error body                                                                                               | `SF:157-159` — the target table is renamed away, forcing the audit `INSERT` to fail; `SF:166` — `expect(response.status).toBe(403)`; `SF:169-175` — `expect(responseBody).toEqual({...403 ForbiddenError body...})`                                                                          | ✅ PASS |
| DL-14 — `GET /api/v1/activity` includes `blocked_download`, `created_at DESC` | Interleaved with existing event types, newest first                                                                                          | `AC:180` — `expect(responseBody.events[0].event_type).toBe("blocked_download")`; `AC:181` — `expect(responseBody.events[1].event_type).toBe("link_created")` (blocked attempt happened after link creation)                                                                                  | ✅ PASS |
| DL-15 — populate title + actor, `NULL` for inapplicable fields                | `document_title` set, actor set, `pages_viewed`/`page_count`/`time_on_page` `NULL`, `is_revisit` per the `link_created` convention (`false`) | `AC:169-175` — `document_title: "Confidential.docx"`, `pages_viewed: null`, `page_count: null`, `time_on_page: null`, `is_revisit: false`                                                                                                                                                    | ✅ PASS |
| DL-16 — anonymous attempt still persisted/surfaced with `NULL` actor fields   | Event present; `actor_name` and `actor_email` are `null`                                                                                     | `AC:200` — `expect(fileResponse.status).toBe(403)` with `headers: {}`; `AC:211-215` — `expect(blockedEvent).toMatchObject({ document_id: document.id, actor_name: null, actor_email: null })`                                                                                                | ✅ PASS |
| DL-17 — data-room blocked attempts NOT persisted/surfaced this increment      | No `blocked_download_attempts` row is written for a data-room block                                                                          | `DR:255` — `expect(response.status).toBe(403)`; `DR:261` — `expect(after.rows[0]!.count).toBe(before.rows[0]!.count)` around the blocked data-room request                                                                                                                                   | ✅ PASS |
| DL-18 — persisted event is immutable history                                  | A later `allow_download` change alters/removes nothing                                                                                       | `AC:241` — `expect(beforeEvent).toBeDefined()`; PATCH to `allow_download: true` at `AC:243-250`; `AC:262` — `expect(afterEvent).toEqual(beforeEvent)`                                                                                                                                        | ✅ PASS |

**Status**: ✅ All 18 ACs covered with `file:line` evidence; 18/18 asserted
values match the spec-defined outcome. 0 spec-precision gaps. 2 non-blocking
precision notes recorded (DL-04 disjunct coverage above; DL-12 link-id note
below).

**DL-12 precision note (non-blocking):** the AC names "the share link's id"
among the persisted fields. No test reads `blocked_download_attempts.share_link_id`
directly; it is asserted indirectly — the column is `NOT NULL REFERENCES
share_links(id)` (`infra/migrations/036-create-blocked-download-attempts.sql:24`)
and `models/activity.ts:85` inner-joins through it, so a wrong or absent
value makes the event vanish and fails `AC:166`.

---

## Discrimination Sensor

Scratch: `git worktree add --detach <scratchpad>/verify-scratch-eallowdl HEAD`
(never `git stash`), `node_modules` symlinked in, `next dev` served from the
scratch tree. Real-tree baseline captured before any sensor work:
`?? open-pr.sh`.

| #   | File:line                                                | Description                                                                                                                                                                               | Test run                                                        | Killed?                                                                                                                                         |
| --- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | `models/shareLink.ts:825`                                | Flipped the mime guard `row.mime_type !== PDF_MIME_TYPE` → `=== PDF_MIME_TYPE` (blocks PDFs, leaks non-PDFs)                                                                              | `SF` + `DR`                                                     | ✅ Killed — 4 failures (DL-01, DL-03, DL-05)                                                                                                    |
| M2  | `models/shareLink.ts:173`                                | Dropped the best-effort `.catch(() => undefined)` on the audit write                                                                                                                      | `SF` + `DR`                                                     | ✅ Killed — exactly 1 failure, the DL-13 test: `Expected: 403 / Received: 503`                                                                  |
| M3  | `models/activity.ts:80`                                  | `false AS is_revisit` → `true AS is_revisit` in the `blocked_download` branch                                                                                                             | `AC`                                                            | ✅ Killed — DL-15 test: `- "is_revisit": false / + "is_revisit": true`                                                                          |
| M4  | `components/data-room-viewer/DataRoomViewerPage.tsx:492` | `canPreview` forced to `true` (reverts the "Visualizar" gate)                                                                                                                             | `npx playwright test tests/e2e/data-room-download-gate.spec.ts` | ✅ Killed — DL-09 e2e failed on all 3 attempts (retries exhausted) at `E2E:53`                                                                  |
| M5  | `models/shareLink.ts:692` / `:779`                       | Ordering fault: moved `assertLinkIsActiveAndNotExpired(row)` out of the shared validator into `getByToken` only, so the file endpoint evaluates `allow_download` before the revoked check | `SF` + `DR`                                                     | ✅ Killed — exactly 1 failure, the DL-04 test: `- "Este link foi revogado." / + "O download deste arquivo não está habilitado para este link."` |

**Sensor depth**: P0-full (5 mutations — this is an access-control fix, so the
critical-path tier applies).
**Result**: 5/5 killed — PASS ✅

Each of the four areas repaired since iteration 1 was targeted directly (M5 →
DL-04, M4 → DL-09, M2 → DL-13, M3 → DL-15) and each of those mutants was
killed by _exactly the newly added assertion_, not by unrelated collateral
failures. The new tests are genuine discriminators, not restatements.

**Isolation verified**: scratch worktree removed
(`git worktree remove --force`, then `git worktree prune`); `git worktree list`
shows only the real tree plus the two pre-existing `.claude/worktrees/*`
entries; real-tree `git status --porcelain` is `?? open-pr.sh`, byte-identical
to the pre-sensor baseline.

---

## Code Quality

| Principle                                                                    | Status                                                                                                                                                                           |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Minimum code                                                                 | ✅ 4 production files touched + 1 new model + 1 migration                                                                                                                        |
| Surgical changes                                                             | ✅ the check is a single `if` per model; no protocol/header changes                                                                                                              |
| No scope creep                                                               | ✅ data-room blocked attempts deliberately not persisted (AD-004), matching the spec's Out of Scope and asserted at `DR:261`                                                     |
| Matches patterns                                                             | ✅ `ForbiddenError` from `infra/errors.ts`, parameterized SQL, pt-BR messages, default-exported typed model object, `NNN-*.sql` migration naming                                 |
| Spec-anchored outcome check (asserted values match spec)                     | ✅ 18/18                                                                                                                                                                         |
| Per-layer Coverage Expectation met (domain 1:1 ACs; routes happy+edge+error) | ✅ every route in scope has happy path (`SF:88`, `DR:203`), edge (`DR:34`, `DR:53`, `DR:71`, `SF:203`) and error (`SF:41`, `SF:166`, `DR:173`) coverage                          |
| Every test maps to a spec requirement — no unclaimed tests                   | ✅ all 15 new Jest tests + 1 Playwright test map to DL-01..DL-18 or to T4's documented regression pin (`SM:104`) / the mime-fixture sanity check (`SF:14`)                       |
| Documented guidelines followed                                               | ✅ `CLAUDE.md` (error classes, pt-BR messages, raw parameterized SQL, integration-only tests, `tests/e2e/` Playwright suite), `.specs/features/enforce-allow-download/design.md` |

---

## Edge Cases

- [x] Repeated retries persist one event per attempt, no dedup — no dedup
      code path exists: `models/blockedDownload.ts#record` is an unconditional
      `INSERT`, called once per refused request from
      `models/shareLink.ts:167`. Single-attempt counting is asserted at
      `AC:166` (`toHaveLength(1)`). ⚠️ A two-attempt → two-event assertion is
      not present; correct by construction, but unpinned. Non-blocking
      (no AC covers it; the spec lists it only as an Edge Case).
- [x] Soft-deleted document behind a blocked attempt — the spec requires "no
      new filtering behavior"; the `blocked_download` branch
      (`models/activity.ts:82-89`) adds no `deleted_at` predicate, exactly
      like the existing `view`/`link_created` branches. Verified by reading;
      no behavior change to test.
- [x] Inactive link + non-PDF + `allow_download: false` returns the
      pre-existing failure, not `403`-download — `SF:206` asserts the revoked
      body verbatim.
- [x] Toggling `allow_download` false→true takes effect immediately with no
      caching, leaving persisted events unchanged — share-link endpoint:
      `SF:88`/`SF:91` after a PATCH; data-room viewer: `E2E:60-66` after a
      PATCH; immutability of prior events: `AC:262`. ⚠️ The data-room `/file`
      endpoint specifically is not re-requested after a false→true toggle
      (`DR:185-207` creates the link already allowing download). Non-blocking:
      the check is a pure read of the row on every request, and the UI half of
      the same toggle is covered end-to-end.

---

## Gate Check

Docker (`papershare-dev-db`, `papershare-dev-storage`) was already up. Each
command below was run by the Verifier; exact invocations recorded.

| Gate                    | Command                                                                      | Result                                                                                                                               |
| ----------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------- | -------------------------------- |
| Formatting (Prettier)   | `npm run lint:prettier:check` (non-mutating equivalent of `npm run sf`)      | ✅ only `.specs/features/enforce-allow-download/validation.md` (this report, iteration-1 copy) flagged; every source/test file clean |
| Lint (ESLint)           | `npm run lint:eslint:check`                                                  | ✅ "No ESLint warnings or errors"                                                                                                    |
| Types                   | `npx tsc --noEmit`                                                           | ✅ exit 0                                                                                                                            |
| Tests (feature scope)   | `npx jest --runInBand --roots '<rootDir>/tests' --testPathPattern '...(share | data-room-share                                                                                                                      | activity)...'` | ✅ 4 suites, 54 tests, 54 passed |
| Tests (full suite)      | `npx jest --runInBand --roots '<rootDir>/tests'`                             | ⚠️ 59 suites, 404 tests, 398 passed / 6 failed — all 6 environmental, see below                                                      |
| Tests (full, clean env) | same command, run inside the scratch worktree (no `.env.development.local`)  | ✅ 59 suites, 404 tests, **404 passed, 0 failed**                                                                                    |
| E2E                     | `npx playwright test tests/e2e/data-room-download-gate.spec.ts`              | ✅ 1 passed                                                                                                                          |

`--roots '<rootDir>/tests'` scopes Jest to the real test tree. Without it,
Jest's default `testMatch` also picks up ~400 `*.test.ts` files under
`.claude/worktrees/*` (two stale sibling worktrees), because
`jest.config.js:18`'s `testPathIgnorePatterns` lists only `node_modules/` and
`tests/e2e/`. Confirmed pre-existing and unrelated: `jest.config.js` is
untouched by this feature's diff, and the sibling worktrees are checked out at
`5793549` / `1588a62`, both outside this branch.

**Environmental failures (independently reproduced, not this feature's):** the
6 failures are `billing/checkout`, `billing/portal` ("Stripe not configured →
503") and 4 `webhooks/stripe` plan-resolution tests. Cause verified rather than
assumed: this machine carries an untracked `.env.development.local` setting a
real `STRIPE_SECRET_KEY=sk_test…` plus real `STRIPE_PRICE_ID_PRO/BUSINESS=price_1…`,
which override `.env.development`'s dummy `price_t…` values that the webhook
fixtures send. Proof: the scratch worktree has no `.env.development.local`
(its `next dev` logged `Optional environment variables not set … STRIPE_SECRET_KEY`),
and there the same 3 suites pass 20/20 and the full suite passes 404/404. None
of the 6 failing files appear in `main..HEAD`.

- **Test count before feature**: 389 Jest tests
- **Test count after feature**: 404 Jest tests (+15) plus 1 new Playwright spec
- **Delta**: +15 Jest (`SF` +7 new file, `SM` +1, `DR` +4, `AC` +3), +1 e2e
- **Skipped tests**: none
- **Failures**: none attributable to this feature

---

## Requirement Traceability Update

| Requirement | Previous Status                  | New Status  |
| ----------- | -------------------------------- | ----------- |
| DL-01       | Implementing                     | ✅ Verified |
| DL-02       | Implementing                     | ✅ Verified |
| DL-03       | Implementing                     | ✅ Verified |
| DL-04       | Verified (iteration-1 gap fixed) | ✅ Verified |
| DL-05       | Implementing                     | ✅ Verified |
| DL-06       | Implementing                     | ✅ Verified |
| DL-07       | Implementing                     | ✅ Verified |
| DL-08       | Implementing                     | ✅ Verified |
| DL-09       | Verified (iteration-1 gap fixed) | ✅ Verified |
| DL-10       | Implementing                     | ✅ Verified |
| DL-11       | Implementing                     | ✅ Verified |
| DL-12       | Implementing                     | ✅ Verified |
| DL-13       | Verified (iteration-1 gap fixed) | ✅ Verified |
| DL-14       | Implementing                     | ✅ Verified |
| DL-15       | Verified (iteration-1 gap fixed) | ✅ Verified |
| DL-16       | Implementing                     | ✅ Verified |
| DL-17       | Implementing                     | ✅ Verified |
| DL-18       | Implementing                     | ✅ Verified |

---

## Summary

**Overall**: ✅ Ready

**Spec-anchored check**: 18/18 ACs matched the spec-defined outcome, 0
spec-precision gaps (2 non-blocking precision notes: DL-04 disjunct breadth,
DL-12 indirect link-id evidence)
**Sensor**: 5/5 mutations killed (P0-full depth)
**Gate**: 404/404 Jest tests pass in a clean environment; Prettier, ESLint and
`tsc --noEmit` clean; the DL-09 Playwright spec passes

**What works**

- `GET /api/v1/share/[token]/file` returns `403` with a pt-BR `ForbiddenError`
  body and zero file bytes for non-PDF documents on `allow_download: false`
  links, and still `200`s for PDFs and for `allow_download: true`.
- `GET /api/v1/data-room-share/[token]/file` enforces the identical rule per
  document, with a room-flavoured `action` string.
- The data-room viewer no longer renders a "Visualizar" action for a non-PDF,
  download-disabled document, and the server-side check still fires if that
  code path is replayed directly.
- Every blocked share-link attempt is persisted append-only and surfaces as a
  `blocked_download` event in `GET /api/v1/activity`, correctly ordered,
  correctly `NULL`-padded, immutable, and never blocking the `403` when the
  audit write itself fails.

**Issues found**: none blocking. Two optional follow-ups, both outside the
spec's ACs:

1. Add a two-attempts → two-events assertion to pin the "no dedup" edge case
   (currently correct by construction only).
2. Pre-existing, out of scope for this feature: `jest.config.js:18` should add
   `<rootDir>/.claude/worktrees/` to `testPathIgnorePatterns` so a bare
   `npm test` does not collect stale sibling-worktree suites.

**Next steps**: feature is done. Merge `fix/enforce-allow-download-server-side`.
