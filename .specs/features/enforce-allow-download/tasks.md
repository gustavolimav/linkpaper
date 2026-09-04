# Enforce allow_download Server-Side Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/enforce-allow-download/design.md`
**Status**: Draft

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: `CLAUDE.md` ("Testing" section - confirms all tests are Jest integration tests hitting `http://localhost:3000` + a real Postgres DB via `tests/orchestrator.ts` fixtures, plus a separate Playwright e2e suite scoped to plan-gating; there is no unit-test layer for `models/**` and no component/e2e-test layer for `components/**` beyond the plan-gating Playwright specs already in `tests/e2e/`). Sampled 5 existing files: `tests/integration/api/v1/share/[token]/index.test.ts`, `tests/integration/api/v1/data-room-share/[token]/file/index.test.ts`, `tests/integration/api/v1/data-room-share/[token]/index.test.ts`, `tests/integration/api/v1/activity/get.test.ts`, `tests/orchestrator.ts` (fixtures: `createUserSession`, `uploadDocument`, `createShareLink`, `createDataRoom`, `createDataRoomLink`).

| Code Layer                                                                                                                                                       | Required Test Type | Coverage Expectation                                                                                                                                                                                                                                                                                                                                                                                         | Location Pattern                        | Run Command                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- | -------------------------------- |
| Domain/business logic (`models/shareLink.ts`, `models/dataRoomLink.ts`, `models/blockedDownload.ts`, `models/activity.ts`), exercised only through its API route | integration        | 1:1 with every applicable spec AC (DL-01..DL-18); every listed edge case in `spec.md`'s "Edge Cases" section that is in scope for this task has an assertion                                                                                                                                                                                                                                                 | `tests/integration/api/v1/**/*.test.ts` | `npm test`                       |
| Route/controller (`pages/api/v1/share/[token]/file`, `pages/api/v1/data-room-share/[token]/file`, `pages/api/v1/activity`)                                       | integration        | Happy path + every edge case (bad token, wrong password, revoked link, missing/foreign `document_id`, PDF vs non-PDF, `allow_download` true/false) + error/failure paths already covered by existing tests in the same file                                                                                                                                                                                  | `tests/integration/api/v1/**/*.test.ts` | `npm test`                       |
| Database migration/schema (`infra/migrations/036-create-blocked-download-attempts.sql`)                                                                          | none               | Verified structurally: every integration test's `beforeAll` calls `orchestrator.runPendingMigrations()`, so a broken migration fails the whole suite; no dedicated migration test exists anywhere in this repo                                                                                                                                                                                               | -                                       | build gate only                  |
| TypeScript types (`types/index.ts`)                                                                                                                              | none               | Compile-time only; `npx tsc --noEmit` (`exactOptionalPropertyTypes: true`) is the only gate                                                                                                                                                                                                                                                                                                                  | -                                       | build gate only                  |
| Frontend/UI component (`components/data-room-viewer/DataRoomViewerPage.tsx`, `components/activity/ActivityFeed.tsx`)                                             | none               | No component-test layer exists in this repo, and `design.md`'s own "Test Surface" table lists no frontend test file for DL-09/DL-14's rendering branches (the server-side check, tested at the model layer, is the actual guarantee - see `design.md`'s Risks table, row 1, and DL-10's traceability entry). Verified by `npm run sf` + `npx tsc --noEmit` and manual review against the design's exact JSX. | -                                       | `npm run sf && npx tsc --noEmit` |

## Gate Check Commands

> Generated from codebase - confirm before Execute.

| Gate Level | When to Use                                                                                             | Command                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Quick      | After a types-only or migration-only task with no test changes                                          | `npx tsc --noEmit`                                                                                                             |
| Full       | After any task that adds or extends integration tests                                                   | `npm test` (starts Docker via its own `services:up` step and `next dev`; Docker Desktop must be running first per `CLAUDE.md`) |
| Build      | After phase completion, and always before the feature's final commit (`CLAUDE.md`'s Definition of Done) | `npm run sf && npx tsc --noEmit && npm test`                                                                                   |

---

## Execution Plan

Phases are ordered and run sequentially - each phase completes before the next begins, and tasks within a phase execute in order.

### Phase 1: Foundation - schema and types

```
T1 → T2
```

### Phase 2: Share-link enforcement and audit trail

```
T3 → T4
```

### Phase 3: Data-room enforcement and Visualizar bypass

```
T5 → T6
```

### Phase 4: Activity Feed surfacing

```
T7 → T8
```

---

## Task Breakdown

### Phase 1: Foundation - schema and types

### T1: Create `blocked_download_attempts` migration

**What**: Add `infra/migrations/036-create-blocked-download-attempts.sql` creating the append-only `blocked_download_attempts` table (`id`, `share_link_id` FK → `share_links` `ON DELETE CASCADE`, `document_id` FK → `documents` no-cascade, `viewer_email VARCHAR(254)`, `viewer_name VARCHAR(255)`, `created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())`) plus its two indexes (`share_link_id`, `created_at`). No `updated_at`, no `set_updated_at()` trigger - append-only by construction (DL-18).
**Where**: `infra/migrations/036-create-blocked-download-attempts.sql`
**Depends on**: None
**Reuses**: `infra/migrations/007-*.sql` (`link_views`) column/index conventions; `infra/migrations/033-create-rate-limit-log.sql` append-only shape (no trigger). Exact SQL given verbatim in `design.md`, Component 1.
**Requirement**: DL-12, DL-16, DL-18

**Tools**:

- MCP: NONE
- Skill: `new-migration`

**Done when**:

- [x] File named `036-create-blocked-download-attempts.sql` exists in `infra/migrations/`, next in sequence after `035-data-room-link-parity.sql`
- [x] Table, both FKs (correct cascade behavior per design), both indexes, and the append-only shape (no `updated_at` column, no trigger) match `design.md` Component 1 exactly
- [x] `npm run sf` and `npx tsc --noEmit` both exit 0
- [x] `npm test` still exits 0 (migration applies cleanly via every test file's `orchestrator.runPendingMigrations()`)

**Tests**: none
**Gate**: build

**Commit**: `feat(share-link): add blocked_download_attempts migration`

---

### T2: Add `BlockedDownload*` types, widen `ActivityEvent`, fix stale comments

**What**: In `types/index.ts`, add `BlockedDownloadAttempt`, `BlockedDownloadCreateInput`, `BlockedDownloadModel` interfaces (exact shapes in `design.md` Component 6); widen `ActivityEvent.event_type` from `"view" | "link_created"` to `"view" | "link_created" | "blocked_download"`; replace the stale comment above `ActivityEvent` (currently: "NDA acceptance and blocked-download attempts aren't recorded anywhere yet") with wording that reflects the new persisted event type.
**Where**: `types/index.ts`
**Depends on**: T1
**Reuses**: Existing `ActivityEvent`/`ActivityListResponse` shape at `types/index.ts:200-226`; existing model-interface convention (e.g. `ShareLinkModel`).
**Requirement**: DL-14, DL-15, DL-16

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `BlockedDownloadAttempt`, `BlockedDownloadCreateInput`, `BlockedDownloadModel` added, matching `design.md` Component 6 field-for-field (including nullable `viewer_email`/`viewer_name` on the persisted record, optional on the create input)
- [x] `ActivityEvent.event_type` union includes `"blocked_download"`; no other `ActivityEvent` field changed (per design: every other field is already nullable or already meaningful for this type)
- [x] Stale comment above `ActivityEvent` (`types/index.ts:200-203`) updated to state blocked-download attempts are now persisted
- [x] `npm run sf` and `npx tsc --noEmit` both exit 0

**Tests**: none
**Gate**: build

**Commit**: `feat(types): add BlockedDownload types and widen ActivityEvent`

---

### Phase 2: Share-link enforcement and audit trail

### T3: Persist and enforce blocked downloads on the share-link file endpoint

**What**: Create `models/blockedDownload.ts` (single `record(input): Promise<BlockedDownloadAttempt>` function, parameterized `INSERT ... RETURNING`, default-exported typed object per `CLAUDE.md`). Wire it into `models/shareLink.ts`: add the `PDF_MIME_TYPE` constant, add the `denyDownload(row, providedEmail?, providedName?): Promise<never>` helper (awaits `blockedDownload.record(...).catch(() => undefined)`, then throws `ForbiddenError` with the pt-BR message/action from `design.md`), and call it from `getFileByToken` right after `fetchAndValidateTokenRow` returns, guarded by `!row.allow_download && row.mime_type !== PDF_MIME_TYPE`. No signature or return-shape change to `getFileByToken`; the route (`pages/api/v1/share/[token]/file/index.ts`) is untouched. Add the new integration test file covering DL-01, DL-02, DL-03, DL-05, DL-13.
**Where**: `models/blockedDownload.ts` (new), `models/shareLink.ts` (modify), `tests/integration/api/v1/share/[token]/file/index.test.ts` (new)
**Depends on**: T1, T2
**Reuses**: `models/linkView.ts#insertView`'s INSERT-with-`RETURNING` shape and `COLUMNS` constant convention; `assertLinkIsActiveAndNotExpired` naming family (`models/shareLink.ts:131`) for `denyDownload`'s placement; the `.catch(() => undefined)` best-effort idiom already used at `pages/api/v1/documents/index.ts:102` and `pages/api/v1/share/[token]/view/index.ts:71`; `orchestrator.uploadDocument(cookie, { mimeType, filename, buffer })` for the non-PDF fixture (no binary needed - page-count extraction is skipped for non-PDF); `orchestrator.createShareLink(cookie, document.id, { allow_download })`.
**Requirement**: DL-01, DL-02, DL-03, DL-05, DL-12, DL-13, DL-16

**Tools**:

- MCP: NONE
- Skill: `test-endpoint`

**Done when**:

- [x] `models/blockedDownload.ts` exports a default `blockedDownload` object with `record`, matching `design.md` Component 2 exactly
- [x] `models/shareLink.ts#getFileByToken` returns `403` (via `denyDownload`) when `!allow_download && mime_type !== "application/pdf"`, and falls through to the existing return otherwise; `denyDownload` awaits the audit write with `.catch(() => undefined)` before throwing (AD-007)
- [x] New test file `tests/integration/api/v1/share/[token]/file/index.test.ts` asserts, using `orchestrator.uploadDocument(cookie, { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", filename: "a.docx", buffer: Buffer.from("fake docx bytes") })`:
  - the uploaded document's `mime_type` really is the non-PDF value (guards against the test passing vacuously)
  - a link with `allow_download: false` on that document → `GET .../file` returns `403`, response body has no file bytes, `message`/`action` are in pt-BR (DL-01, DL-05)
  - the same link with `allow_download: true` → `GET .../file` returns `200` with the file bytes (DL-02)
  - a PDF document (default `orchestrator.uploadDocument` fixture) with `allow_download: false` → `GET .../file` returns `200` with the file bytes (DL-03)
  - a blocked attempt is persisted even when the audit write path is exercised via a normal request (no `X-Viewer-Email`/`X-Viewer-Name` headers) - the `403` still returns (DL-13, DL-16 covered here at the enforcement layer; full persistence/surfacing assertion happens in T7)
- [x] Gate check passes: `npm test`
- [x] Test count: existing suite count + at least 5 new tests in the new file, all passing (no silent deletions)

**Tests**: integration
**Gate**: full

**Commit**: `feat(share-link): enforce allow_download on the file endpoint and record blocked attempts`

---

### T4: Pin the share-link metadata endpoint against the shared-validator regression

**What**: Add a regression test to the existing `tests/integration/api/v1/share/[token]/index.test.ts` asserting that `GET /api/v1/share/[token]` (the metadata/viewer-page endpoint, backed by `getByToken`, not `getFileByToken`) still returns `200` for an otherwise-valid, non-PDF, `allow_download: false` link. This is the regression pin `design.md`'s Risks table (row 1) and the spec's Assumptions/Decision 2 explicitly call for: it guards against the `allow_download` guard ever migrating into the shared `fetchAndValidateTokenRow` validator, which would break page load for every "view-only" non-PDF link.
**Where**: `tests/integration/api/v1/share/[token]/index.test.ts`
**Depends on**: T3
**Reuses**: The file's existing `"With no password set"` test (already uses `allow_download: false` with a PDF document) as the structural template; `orchestrator.uploadDocument(cookie, { mimeType, filename, buffer })` for the non-PDF fixture.
**Requirement**: DL-04

**Tools**:

- MCP: NONE
- Skill: `test-endpoint`

**Done when**:

- [x] New test in `tests/integration/api/v1/share/[token]/index.test.ts` uploads a non-PDF document (asserts `document.mime_type !== "application/pdf"`), creates a link with `allow_download: false`, and asserts `GET /api/v1/share/[token]` returns `200` (not `403`) with the document's non-PDF `mime_type` present in the response body
- [x] Gate check passes: `npm test`
- [x] Test count: existing file's test count + 1, all passing (no silent deletions)

**Tests**: integration
**Gate**: full

**Commit**: `test(share-link): pin metadata endpoint against allow_download shared-validator regression`

---

### Phase 3: Data-room enforcement and Visualizar bypass

### T5: Enforce parity on the data-room file endpoint

**What**: In `models/dataRoomLink.ts`, add `documents.mime_type`... already selected, plus add the missing `data_room_documents.allow_download` column to `getFileByToken`'s existing `SELECT`; widen its row type to `{ storage_key: string; mime_type: string; allow_download: boolean }`; add the module-level `PDF_MIME_TYPE` constant and `assertDownloadAllowed(row)` guard (throw-only, no audit call, per AD-004/DL-17) mirroring `shareLink.ts`'s guard; call it after the not-found check, before returning. No signature/return-shape change; the route (`pages/api/v1/data-room-share/[token]/file/index.ts`) is untouched. Extend the existing file's integration tests to cover DL-06, DL-07, DL-08, DL-10, DL-11, DL-17.
**Where**: `models/dataRoomLink.ts` (modify), `tests/integration/api/v1/data-room-share/[token]/file/index.test.ts` (extend)
**Depends on**: None
**Reuses**: `models/shareLink.ts`'s `denyDownload`/`PDF_MIME_TYPE` pattern from T3 (duplicated per AD-006 - this repo already duplicates `assertLinkIsActiveAndNotExpired`, `replaceAllowedEmails`, `getAllowedEmails`, `toResponse`, `findLinkRow` between these two files); `orchestrator.createDataRoom(cookie, workspaceId, { document_ids })` + `orchestrator.createDataRoomLink(cookie, room.id)`; existing test file's `"A document not in this room returns 404"` and `"A revoked link returns 403"` tests as structural templates for DL-11.
**Requirement**: DL-06, DL-07, DL-08, DL-10, DL-11, DL-17

**Tools**:

- MCP: NONE
- Skill: `test-endpoint`

**Done when**:

- [x] `getFileByToken`'s `SELECT` in `models/dataRoomLink.ts` includes `data_room_documents.allow_download`; `assertDownloadAllowed` throws `ForbiddenError` (pt-BR, room-flavoured `action` text) when `!allow_download && mime_type !== "application/pdf"`, called after the not-found check and before the function returns
- [x] Extended tests in `tests/integration/api/v1/data-room-share/[token]/file/index.test.ts`, using a non-PDF document upload (asserting its `mime_type` is really non-PDF) added to a data room via `document_ids`:
  - `allow_download: false` on that document → `GET .../file?document_id=...` returns `403`, no file bytes (DL-06)
  - `allow_download: true` → `200` with bytes (DL-07)
  - a PDF document with `allow_download: false` → `200` with bytes (DL-08)
  - existing missing/foreign `document_id` tests in this file still pass unmodified, confirming those checks still run before the new guard (DL-11)
  - no row is written to `blocked_download_attempts` for a data-room blocked attempt (DL-17) - a query via `database` (or a follow-on `GET /api/v1/activity` call for that workspace showing zero `blocked_download` events) confirms this
- [x] Gate check passes: `npm test`
- [x] Test count: existing file's test count + at least 4 new tests, all passing (no silent deletions)

**Tests**: integration
**Gate**: full

**Commit**: `feat(data-room): enforce allow_download parity on the room file endpoint`

---

### T6: Close the data-room "Visualizar" bypass

**What**: In `components/data-room-viewer/DataRoomViewerPage.tsx` (around the document-row action buttons, currently `~485-521`), derive `canPreview = doc.mime_type === "application/pdf" || doc.allow_download` per document row; render the existing "Visualizar" button only when `canPreview` is true, otherwise render the muted `"Pré-visualização não disponível"` label (verbatim string reused from `ViewerPage.tsx:420-428`'s convention) instead. `handleOpenDocument` itself is unchanged - it becomes unreachable from the UI for this combination; the server-side guard from T5 is the actual security backstop (DL-10).
**Where**: `components/data-room-viewer/DataRoomViewerPage.tsx`
**Depends on**: T5
**Reuses**: `ViewerPage.tsx:420-428`'s exact non-PDF gating convention (hide-not-disable, muted label, no new copy string introduced).
**Requirement**: DL-09

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `canPreview` computed per row exactly as specified; "Visualizar" button only renders when `canPreview` is true
- [x] When `canPreview` is false, the row shows the muted `"Pré-visualização não disponível"` label instead of an empty gap (matches `ViewerPage.tsx`'s wording verbatim)
- [x] The existing "Baixar" button's `doc.allow_download &&` condition is unchanged
- [x] `npm run sf` and `npx tsc --noEmit` both exit 0
- [x] Manual verification against `design.md` Component 7's exact JSX (no automated test exists for this layer per the Test Coverage Matrix - the server-side check added in T5 is DL-10's actual guarantee)

**Tests**: none
**Gate**: build

**Commit**: `fix(data-room): hide Visualizar for non-PDF documents with download disabled`

---

### Phase 4: Activity Feed surfacing

### T7: Surface blocked-download attempts in the Activity Feed

**What**: In `models/activity.ts`, add a third `UNION ALL` branch to `ACTIVITY_UNION` for `'blocked_download'` events, joining `blocked_download_attempts` → `share_links` → `documents`, matching the existing two branches' 12-column shape and `NULL::type` cast convention exactly (per `design.md` Component 5's SQL). No change needed to `findAllByWorkspaceId` itself (the outer `ORDER BY created_at DESC` already interleaves the new rows). Update the stale comment at the top of the file (`models/activity.ts:9-14`) that currently states blocked-download events "aren't persisted anywhere today." Extend `tests/integration/api/v1/activity/get.test.ts` to cover DL-14, DL-15, DL-16, DL-18.
**Where**: `models/activity.ts` (modify), `tests/integration/api/v1/activity/get.test.ts` (extend)
**Depends on**: T2, T3
**Reuses**: The exact 12-column shape and `NULL::int`/`NULL::varchar` cast convention of the existing `view`/`link_created` branches; the existing test file's `"A link-created event appears with the owner as actor"` test as the structural template.
**Requirement**: DL-14, DL-15, DL-16, DL-18

**Tools**:

- MCP: NONE
- Skill: `test-endpoint`

**Done when**:

- [ ] `ACTIVITY_UNION`'s new branch matches `design.md` Component 5's SQL exactly (column list, casts, `false AS is_revisit` literal, JOIN path to `d.workspace_id`)
- [ ] Stale comment at `models/activity.ts:9-14` no longer claims blocked-download events aren't persisted
- [ ] Extended tests in `tests/integration/api/v1/activity/get.test.ts`:
  - trigger a blocked share-link download (non-PDF, `allow_download: false`, per T3's pattern) with `X-Viewer-Email`/`X-Viewer-Name` headers set, then `GET /api/v1/activity` for that workspace → response includes one `blocked_download` event with `document_id`, `document_title`, `actor_name`, `actor_email` populated and interleaved correctly by `created_at DESC` among any other events (DL-14, DL-15)
  - repeat with no `X-Viewer-Email`/`X-Viewer-Name` headers → the `blocked_download` event still appears, with `actor_name`/`actor_email` both `null` (DL-16)
  - flipping the link's `allow_download` to `true` after the blocked attempt does not remove or alter the already-persisted event on a subsequent `GET /api/v1/activity` (DL-18)
- [ ] Gate check passes: `npm test`
- [ ] Test count: existing file's test count + at least 3 new tests, all passing (no silent deletions)

**Tests**: integration
**Gate**: full

**Commit**: `feat(activity): surface blocked_download events in the workspace Activity Feed`

---

### T8: Render the `blocked_download` event in `ActivityFeed.tsx`

**What**: In `components/activity/ActivityFeed.tsx`, add a `blocked_download` branch to `actionTextFor` (returns `"teve um download bloqueado em"`) and to `detailFor` (returns `"Download não permitido neste link"`), placed before the existing fallback so a blocked attempt is never rendered as `"visualizou"`/`"revisitou"`. `actorNameFor` already falls back to `"Um visitante"` when both actor fields are `null` - no change needed there.
**Where**: `components/activity/ActivityFeed.tsx`
**Depends on**: T7
**Reuses**: The existing `link_created`-branch pattern in both functions (`components/activity/ActivityFeed.tsx:45-68`) as the structural template.
**Requirement**: DL-14

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `actionTextFor` returns `"teve um download bloqueado em"` for `event.event_type === "blocked_download"`, checked before the generic fallback
- [ ] `detailFor` returns `"Download não permitido neste link"` for the same event type, checked before the generic fallback
- [ ] `npm run sf` and `npx tsc --noEmit` both exit 0
- [ ] Manual verification against `design.md` Component 8's exact code (no automated test exists for this layer per the Test Coverage Matrix - T7's integration test already asserts the underlying `event_type` value the component switches on)

**Tests**: none
**Gate**: build

**Commit**: `fix(activity): render blocked_download events instead of mislabeling them as views`

---

## Phase Execution Map

Visual representation of task ordering. Phases run in sequence, and tasks within a phase run in order:

```
Phase 1 → Phase 2 → Phase 3 → Phase 4

Phase 1:  T1 ------→ T2
Phase 2:  T3 ------→ T4
Phase 3:  T5 ------→ T6
Phase 4:  T7 ------→ T8
```

Cross-phase dependencies (not drawn above - they point backward across phase boundaries, which the diagram-definition cross-check treats as out of scope for arrow parity, per the validator's intra-phase-only rule):

- T3 depends on T1, T2 (needs the migrated table and the new types)
- T7 depends on T2, T3 (needs the widened `ActivityEvent` type and a working blocked-download audit write to test against)

Execution is strictly sequential - there is no intra-phase parallelism. A single agent (or batch worker) works one task at a time, in order.

**Batching**: 8 tasks total, 4 phases - fits a single ~8-task batch. No sub-agent delegation is needed; execute inline in the main window.

---

## Task Granularity Check

| Task                                              | Scope                                                                | Status                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1: Create migration                              | 1 file                                                               | ✅ Granular                                                                                                                                                                                                                                                                                                                   |
| T2: Add types                                     | 1 file                                                               | ✅ Granular                                                                                                                                                                                                                                                                                                                   |
| T3: Persist + enforce on share-link file endpoint | 2 production files (1 new model, 1 modified model) + 1 new test file | ⚠️ 2-3 related things - OK: cohesive single deliverable (audit model + its only call site), required by the co-location rule since `blockedDownload.ts` alone is not reachable/testable via any route until wired into `shareLink.ts` (a "resolving compilation dependencies" merge-forward, per the skill's Tasks reference) |
| T4: Regression test on metadata endpoint          | 1 file (test only, no production code)                               | ✅ Granular                                                                                                                                                                                                                                                                                                                   |
| T5: Enforce parity on data-room file endpoint     | 1 production file + 1 extended test file                             | ✅ Granular - one model, one co-located test extension                                                                                                                                                                                                                                                                        |
| T6: Close Visualizar bypass                       | 1 component file                                                     | ✅ Granular                                                                                                                                                                                                                                                                                                                   |
| T7: Surface blocked_download in Activity Feed     | 1 production file + 1 extended test file                             | ✅ Granular - one model, one co-located test extension                                                                                                                                                                                                                                                                        |
| T8: Render blocked_download in ActivityFeed.tsx   | 1 component file                                                     | ✅ Granular                                                                                                                                                                                                                                                                                                                   |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows                                                            | Status   |
| ---- | ---------------------- | ------------------------------------------------------------------------ | -------- |
| T1   | None                   | (start of Phase 1 chain)                                                 | ✅ Match |
| T2   | T1                     | T1 → T2                                                                  | ✅ Match |
| T3   | T1, T2 (cross-phase)   | (start of Phase 2 chain; cross-phase deps listed in prose below diagram) | ✅ Match |
| T4   | T3                     | T3 → T4                                                                  | ✅ Match |
| T5   | None                   | (start of Phase 3 chain)                                                 | ✅ Match |
| T6   | T5                     | T5 → T6                                                                  | ✅ Match |
| T7   | T2, T3 (cross-phase)   | (start of Phase 4 chain; cross-phase deps listed in prose below diagram) | ✅ Match |
| T8   | T7                     | T7 → T8                                                                  | ✅ Match |

No task depends on a task in a later phase.

---

## Test Co-location Validation

| Task                               | Code Layer Created/Modified                                                              | Matrix Requires | Task Says   | Status |
| ---------------------------------- | ---------------------------------------------------------------------------------------- | --------------- | ----------- | ------ |
| T1: Create migration               | Database migration/schema                                                                | none            | none        | ✅ OK  |
| T2: Add types                      | TypeScript types                                                                         | none            | none        | ✅ OK  |
| T3: Persist + enforce (share-link) | Domain/business logic (`models/blockedDownload.ts`, `models/shareLink.ts`) via its route | integration     | integration | ✅ OK  |
| T4: Regression test                | Route/controller (test-only addition, no production code)                                | integration     | integration | ✅ OK  |
| T5: Enforce parity (data-room)     | Domain/business logic (`models/dataRoomLink.ts`) via its route                           | integration     | integration | ✅ OK  |
| T6: Close Visualizar bypass        | Frontend/UI component                                                                    | none            | none        | ✅ OK  |
| T7: Surface in Activity Feed       | Domain/business logic (`models/activity.ts`) via its route                               | integration     | integration | ✅ OK  |
| T8: Render in ActivityFeed.tsx     | Frontend/UI component                                                                    | none            | none        | ✅ OK  |

No violations. Every task whose layer requires `integration` tests includes those tests in the same task (T3, T4, T5, T7); every `Tests: none` task's layer is listed as `none` in the Test Coverage Matrix (T1, T2, T6, T8).

---

## Tips

- **Phases are ordered** - Each phase completes before the next; tasks run in order within a phase
- **Reuses = Token saver** - Always reference existing code
- **Tools per task** - MCPs and Skills prevent wrong approaches
- **Dependencies are gates** - Clear what blocks what
- **Done when = Testable** - If you can't verify it, rewrite it
- **Requirement ID = Traceable** - Every task traces back to a spec requirement
- **One commit per task** - Plan the commit message format in advance

---

## Task Verification Standards

Every task MUST follow the `Done when` + `Tests` + `Gate` fields defined in the **Task Breakdown** above. Each `Done when` entry is specific and binary pass/fail, and references the gate check command from **Gate Check Commands**. Expected test-count deltas are stated per task to prevent silent deletions.
