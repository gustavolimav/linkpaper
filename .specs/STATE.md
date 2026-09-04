# Project State

## Decisions

### AD-001 — `enforce-allow-download`: PDF is out of scope for server-side enforcement

Both `ViewerPage.tsx` and `DataRoomViewerPage.tsx` fetch the same
`GET .../file` endpoint, with the same request shape, to retrieve bytes
for in-browser PDF rendering — regardless of `allow_download`. There is
no request-level way to distinguish that legitimate render fetch from a
raw extraction attempt. Enforcing `allow_download` unconditionally (as
`TODO.md`'s literal recommendation reads, "for both PDF and non-PDF
links") would break PDF viewing on every "view-only" link. Decision:
scope server-side enforcement to non-PDF documents only; PDF's
`allow_download` remains UI-only in this increment, with a follow-up
tech-debt item recommended (real prevention needs redesigning PDF
delivery, e.g. server-rendered page images, not attempted here).

### AD-002 — `enforce-allow-download`: data-room "Visualizar" bypass included in scope

Found during Specify (not in the prior US-34 investigation):
`DataRoomViewerPage.tsx#handleOpenDocument` fetches a non-PDF document's
full bytes unconditionally, regardless of `allow_download` — a
no-`curl`-needed variant of the same vulnerability the increment exists
to close. Decision: fix this in the same P1 story as the data-room file
endpoint's server-side check, rather than filing it separately, since
shipping the backend fix alone would leave this UI path as an easier
bypass than the one just closed.

### AD-003 — `enforce-allow-download`: blocked-download persistence schema deferred to Design

A blocked attempt can occur with no corresponding `link_views` row
(e.g. a bare `curl` request that never called `POST /view`), which
argues against bolting a boolean onto `link_views` the way `downloaded`
was. Decision: defer the exact schema (new table vs. extending an
existing one) to the Design phase, consistent with the skill's rule
that Large-tier features may push architectural decisions there.

### AD-004 — `enforce-allow-download`: data-room events excluded from the Activity Feed this increment

`models/activity.ts`'s `UNION ALL` has zero data-room representation
today for any event type (`view`, `link_created`, or the new
`blocked_download`). Decision: ship `403` enforcement for data-room
file requests (parity on the security fix), but persist/surface
`blocked_download` events for share links only — adding just one
data-room event type to an otherwise share-link-only feed would be a
confusing partial step. Full data-room activity-feed parity is left as
a separate, future increment.

### AD-005 — `enforce-allow-download`: blocked attempts go in a new `blocked_download_attempts` table (resolves AD-003)

Migration `036-create-blocked-download-attempts.sql`. Columns: `id`
(UUID PK, `gen_random_uuid()`), `share_link_id` (FK → `share_links`,
`ON DELETE CASCADE`), `document_id` (FK → `documents`, no cascade),
`viewer_email VARCHAR(254)`, `viewer_name VARCHAR(255)`, `created_at`.
Indexes on `share_link_id` and `created_at`, mirroring `link_views`.
Append-only: no `updated_at`, no `set_updated_at()` trigger, and no
UPDATE/DELETE code path anywhere — that is what makes the
"immutable historical record" requirement structural instead of a
convention. Rejected the `link_views`-column alternative (the way
`downloaded` was added in migration 018) because a blocked attempt
routinely has no `link_views` row at all — the file endpoint is
reachable by a bare `curl` that never calls `POST /view` — so the flag
would require inventing a synthetic view row and would inflate
`total_views`, `unique_viewers`, `views_by_day` and the engagement
score. Deliberately no `viewer_fingerprint` (never sent to `/file`;
it is a `POST /view` body field only, verified across `pages/`,
`components/`, `lib/`), and no `ip_address`/`user_agent` (HTTP-layer
facts that would need two more positional params on an already
4-/5-argument `getFileByToken`, and not required by the spec). Both
are additive, non-breaking follow-ups.

### AD-006 — `enforce-allow-download`: the `allow_download` guard lives in `getFileByToken`, never in `fetchAndValidateTokenRow`

`fetchAndValidateTokenRow` is shared by `getByToken` (which backs the
viewer page's metadata call) and `getFileByToken`. Putting the check
there would make a non-PDF, view-only link fail to load at all — a
worse regression than the bug being fixed. Placing it at the top of
`getFileByToken`, immediately after the validated row is returned,
also satisfies the "existing checks apply first, in their existing
order" requirement structurally rather than by hand-ordering `if`s.
The guard (and the `PDF_MIME_TYPE` constant) is duplicated in
`models/shareLink.ts` and `models/dataRoomLink.ts` rather than
extracted to a shared helper, matching the five helpers
(`assertLinkIsActiveAndNotExpired`, `getAllowedEmails`,
`replaceAllowedEmails`, `toResponse`, `findLinkRow`) already duplicated
between those two files, each with its own document-vs-room pt-BR
wording. Neither HTTP route changes: `infra/controller.ts` already maps
`ForbiddenError` to a `403` JSON body.

### AD-007 — best-effort side-effect writes that a response must reflect are awaited, not left dangling

The blocked-download audit write is `await`ed while its failure is
still swallowed (`await model.record(...).catch(() => undefined)`),
rather than following the un-awaited
`summarizer.summarizeDocument(...).catch(() => undefined)` /
`notifyOwnerOfNewViewer(...).catch(() => undefined)` form. A dangling
promise can be cut short when a serverless invocation ends, which
would both lose audit rows in production and make the spec's
"visible in the same request cycle" criterion flaky. The distinction
going forward: fire-and-forget stays un-awaited for slow, external,
nothing-observes-the-result work (AI calls, email); it is awaited when
the write is a single local INSERT whose row a caller is expected to
read back immediately. Swallowing the error is unchanged in both
cases — the response must never depend on the side effect succeeding.

### AD-008 — a new `ActivityEvent.event_type` ships with its `ActivityFeed` rendering branch

`components/activity/ActivityFeed.tsx#actionTextFor` has no default
branch: anything that is not `link_created` renders as
"visualizou"/"revisitou". Adding an event type to the `UNION ALL`
without a matching UI branch therefore mislabels it rather than
merely omitting it — for `blocked_download` it would display a blocked
attempt as a successful view. Decision: extending
`models/activity.ts`'s union and extending `ActivityFeed`'s
`actionTextFor`/`detailFor` are one change, never two increments.

## Handoff

**Feature:** `enforce-allow-download`
**Spec:** `.specs/features/enforce-allow-download/spec.md` (validate_spec.py: 0 errors, 0 warnings)
**Sizing:** Large
**Next phase:** Design (architecture for the blocked-download persistence schema — AD-003 — plus component breakdown across `models/shareLink.ts`, `models/dataRoomLink.ts`, `models/activity.ts`, both file-proxy routes, `DataRoomViewerPage.tsx`, and a new migration), then Tasks, then Execute.
**Branch:** `fix/enforce-allow-download-server-side` (no commits made yet by this phase).
