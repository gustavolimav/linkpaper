# Enforce allow_download Server-Side Specification

## Problem Statement

A share link (or a data-room document link) created with `allow_download: false` only hides the "Download"/"Baixar" button in the UI (`ViewerControls.tsx`, `DataRoomViewerPage.tsx`) — the file-proxy endpoints never check the flag. Confirmed via direct `curl` (US-34 investigation, `user-stories/tech-debt/US-34-investigate-non-pdf-viewer.md`, and `TODO.md`'s Technical Debt Backlog) that `GET /api/v1/share/[token]/file` still returns `200` with the full file bytes regardless of `allow_download`. The identical gap exists independently in `models/dataRoomLink.ts#getFileByToken` / `GET /api/v1/data-room-share/[token]/file`, which doesn't even select the per-document `data_room_documents.allow_download` column it would need to check. Separately, `TODO.md`'s Phase 12 (Activity Feed) already flags that blocked-download attempts aren't persisted anywhere, so they can't be shown in the workspace Activity Feed the way `view` and `link_created` events already are.

**New finding from this investigation (not in the prior US-34 report):** the file-proxy endpoint is not purely a "download" code path. For `application/pdf` documents, both viewers (`ViewerPage.tsx`, `DataRoomViewerPage.tsx`) fetch the exact same endpoint, with the exact same request shape, to retrieve the bytes that feed the in-browser PDF renderer — this happens on every page load, independent of `allow_download`. A server-side check that blocks this request whenever `allow_download` is `false` would not "close a security gap," it would break the ability to view any PDF on a "view-only" link, which is the opposite of what the feature is for. There is no way to distinguish, from the HTTP request alone, a legitimate render fetch from a raw extraction attempt for PDFs, because they are literally the same request. Non-PDF documents don't have this conflict: neither viewer ever fetches `/file` to render a non-PDF document inline (confirmed by the `mime_type !== "application/pdf"` early-return in both, and by the US-34 report) — every non-PDF `/file` request is, in effect, a full-file retrieval. This asymmetry drives the scoping decision below (see Assumptions #1–#3).

A second, more easily triggered variant of the same gap was found while investigating: `DataRoomViewerPage.tsx`'s "Visualizar" (view) action calls `handleOpenDocument`, which for non-PDF documents fetches `/file` and opens the blob **unconditionally, regardless of `allow_download`** — unlike the single-document viewer, which shows no actionable button at all for a non-PDF document when download isn't allowed. A regular visitor clicking "Visualizar" (no `curl` needed) can already retrieve a non-PDF data-room document today even when its `allow_download` is `false`.

## Goals

- [ ] `GET /api/v1/share/[token]/file` returns `403` (not the file bytes) for any non-PDF document whose link has `allow_download: false`, for any client (browser or otherwise).
- [ ] `GET /api/v1/data-room-share/[token]/file` returns the same `403` for any non-PDF document whose `data_room_documents.allow_download` is `false`, closing the identical gap in the second sharing mechanism.
- [ ] The data-room viewer's "Visualizar" action no longer offers a way to retrieve a non-PDF document's bytes when its `allow_download` is `false`, removing the no-curl-needed variant of the same gap.
- [ ] Each blocked share-link download attempt is persisted and appears as a new `blocked_download` event type in `GET /api/v1/activity`, closing the Phase 12 follow-up item.

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature                                                                                      | Reason                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PDF byte-level download prevention                                                           | The file-proxy endpoint is the only source of bytes for in-browser PDF rendering in both viewers; gating it on `allow_download` would break viewing entirely on "view-only" PDF links. Real prevention needs a redesign (e.g. server-rendered per-page images instead of raw bytes) — out of scope here; a new tech-debt follow-up is recommended instead (see Assumption #1). |
| Data-room events (`view`, `link_created`, `blocked_download`) in the workspace Activity Feed | `models/activity.ts`'s `UNION ALL` has zero data-room representation today for any event type. Adding only `blocked_download` for data rooms would be an inconsistent partial step. Full data-room activity-feed parity is a separate, future increment (see Assumption #5).                                                                                                   |
| NDA-acceptance persistence & activity event                                                  | A distinct, already-deferred Phase 12 follow-up item (`TODO.md`), unrelated to download enforcement.                                                                                                                                                                                                                                                                           |
| New or changed rate limiting on the file-proxy routes                                        | Both routes are already rate-limited (20 req/60s, `infra/rate-limit.ts`); unaffected by this change — the same limiter now just also bounds retry volume of a blocked client.                                                                                                                                                                                                  |
| Client-side error toast for a mid-session `allow_download` flip (TOCTOU)                     | A PDF/non-PDF `allow_download` value changing between page load and a user action is a rare, low-value edge case; the request still correctly gets/doesn't get a `403`, it's only the client's silent `if (!response.ok) return` that would need a message. Marginal value; fast-follow if requested.                                                                          |

---

## Assumptions & Open Questions

Every ambiguity is resolved or recorded here - nothing is left silently unclear.

| Assumption / decision                                                                                                                                       | Chosen default                                                                                                                                                                                                                                | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Confirmed? |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Should `allow_download` be enforced for `application/pdf` documents too, as `TODO.md`'s recommendation literally states ("for both PDF and non-PDF links")? | No — enforcement is scoped to non-PDF documents only; PDF behavior (bytes always served) is unchanged in this increment.                                                                                                                      | Both viewers fetch the identical `/file` endpoint, with the identical request shape, to render a PDF inline — there is no request-level signal that distinguishes "rendering" from "extracting." Blocking it would break viewing on every "view-only" PDF link, which contradicts the feature's own intent. Deviates from the literal TODO wording because implementing it as written would be a functional regression, discovered only by tracing both viewer components during this Specify pass.       | y          |
| How is "non-PDF" scoping implemented at the check level?                                                                                                    | Gate on `document.mime_type !== "application/pdf"` AND `allow_download === false`, evaluated in the model layer (`shareLink.ts#getFileByToken`, `dataRoomLink.ts#getFileByToken`) after the existing password/NDA/email/expiry checks.        | Keeps the fix minimal (no new request headers/params, no client protocol change) and matches exactly the scope the US-34 investigation confirmed as reproducible and closeable.                                                                                                                                                                                                                                                                                                                           | y          |
| Should the data-room "Visualizar" action be restricted for non-PDF, `allow_download: false` documents?                                                      | Yes — hide/disable the action for that combination, mirroring the single-document viewer's existing convention (`ViewerPage.tsx` only offers a "Baixar arquivo" CTA for non-PDF when `allow_download` is `true`; otherwise no action at all). | Found during this investigation: today "Visualizar" unconditionally retrieves a non-PDF document's full bytes regardless of `allow_download` — a more easily triggered (no `curl` needed) variant of the exact gap this increment exists to close. Leaving it unfixed would mean the server-side fix doesn't actually stop the most common path a real visitor would use.                                                                                                                                 | y          |
| Where to persist a blocked-download attempt (new column on an existing table vs. a new dedicated table)?                                                    | Deferred to the Design phase.                                                                                                                                                                                                                 | This feature sizes Large, and the skill explicitly permits deferring architecture-level schema decisions to Design. It's a genuine design call: a blocked attempt can happen with no corresponding `link_views` row at all (e.g., a bare `curl` request that never called `POST /view`), which argues against bolting a boolean onto `link_views` the way `downloaded` was — but the final shape (new table vs. an existing one) should be decided with the rest of the schema in view, not guessed here. | y          |
| Do data-room blocked-download attempts get persisted/surfaced this increment?                                                                               | No — persistence and Activity Feed surfacing are share-link-only in this increment. Data-room `/file` enforcement (the `403`) still ships for parity; only the accompanying audit trail is deferred.                                          | The Activity Feed has no data-room representation at all today (see Out of Scope). Building persistence for a `blocked_download` event type that only data rooms would emit, with no feed to show it in yet, is throwaway scope. Full data-room activity parity (all event types) is better sized as its own increment.                                                                                                                                                                                   | y          |
| Error class/status/message for a blocked download                                                                                                           | `ForbiddenError` (403), pt-BR message, e.g. "O download deste arquivo não está habilitado para este link." / action "Peça ao proprietário do documento para habilitar o download, se necessário."                                             | `CLAUDE.md`'s error-handling table maps "not allowed to do this" to `ForbiddenError`; already imported in both `shareLink.ts` and `dataRoomLink.ts`, so no new dependency.                                                                                                                                                                                                                                                                                                                                | y          |
| Should repeated blocked attempts from the same visitor be deduplicated (like the 30-min view dedup)?                                                        | No — persist one event per blocked attempt, no dedup window.                                                                                                                                                                                  | Unlike view-count (an engagement metric where inflation from refreshes matters), a blocked-download attempt is a security-observability signal where each occurrence is meaningful to the owner. Existing per-route rate limiting (20/60s) already bounds worst-case volume from one source.                                                                                                                                                                                                              | y          |
| Does a persistence failure for a blocked-download event block the `403` response to the client?                                                             | No — persistence is best-effort; a failure to write the audit record is caught and swallowed (logged, not thrown), and the `403` is still returned.                                                                                           | Matches the existing "fire-and-forget, silently no-op" pattern already used for other side-effect writes in this codebase (e.g. AI summarization). The security block itself must never depend on the audit log succeeding.                                                                                                                                                                                                                                                                               | y          |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: Enforce download restriction on the public share-link file endpoint ⭐ MVP

**User Story**: As a document owner who created a share link with download disabled, I want the file's bytes to be inaccessible through the file-download endpoint for non-PDF documents, so that disabling download actually prevents any client — browser or otherwise — from obtaining the file.

**Why P1**: This is the originally confirmed, currently-open vulnerability (`TODO.md`, `user-stories/tech-debt/US-34-investigate-non-pdf-viewer.md`) — the entire reason this increment exists.

**Acceptance Criteria** (each line is one EARS pattern):

1. WHEN a client sends `GET /api/v1/share/[token]/file` for a valid, active link whose `allow_download` is `false` AND whose document's `mime_type` is not `application/pdf` THEN the system SHALL respond `403` and SHALL NOT include the file bytes in the response body.
2. WHEN a client sends `GET /api/v1/share/[token]/file` for a valid, active link whose `allow_download` is `true` THEN the system SHALL respond `200` with the file bytes, regardless of `mime_type` (unchanged from today).
3. WHEN a client sends `GET /api/v1/share/[token]/file` for a valid, active link whose `allow_download` is `false` AND whose document's `mime_type` is `application/pdf` THEN the system SHALL respond `200` with the file bytes (inline PDF rendering continues to work unchanged).
4. IF the token is invalid, inactive, expired, password-mismatched, missing a required NDA acceptance, or gated by an email allow-list the requester doesn't satisfy THEN the system SHALL apply those existing checks first, in their existing order, before evaluating `allow_download`.
5. The system SHALL return the `403` response's `message` and `action` fields in pt-BR.

**Independent Test**: Create a share link with `allow_download: false` on a `.docx` document. `curl GET /api/v1/share/{token}/file` directly (no browser, no cookies) → expect `403`, empty/error body. Flip `allow_download` to `true` on the same link → expect `200` with the correct bytes.

---

### P1: Enforce parity on the data-room file endpoint and close the "Visualizar" bypass ⭐ MVP

**User Story**: As a data-room owner who disabled download for one document in a room, I want that document's bytes to be inaccessible through the room's file endpoint and its "Visualizar" action, so that per-document download control in a data room is enforced the same way it already is for a plain share link.

**Why P1**: The same gap exists independently in the second, newer sharing mechanism (data rooms); the TODO note explicitly calls out "both need the fix for real parity." Additionally, the "Visualizar" bypass found during this investigation is a more easily triggered variant (no `curl` needed) of the same vulnerability, so it ships in the same story rather than being deferred.

**Acceptance Criteria**:

1. WHEN a client sends `GET /api/v1/data-room-share/[token]/file?document_id=X` for a document whose `data_room_documents.allow_download` is `false` AND whose `mime_type` is not `application/pdf` THEN the system SHALL respond `403` and SHALL NOT include the file bytes.
2. WHEN a client sends that same request for a document whose `allow_download` is `true` THEN the system SHALL respond `200` with the file bytes, regardless of `mime_type` (unchanged).
3. WHEN a client sends that same request for an `application/pdf` document whose `allow_download` is `false` THEN the system SHALL respond `200` with the file bytes (inline rendering continues to work unchanged).
4. WHILE the public data-room viewer renders its document list, for a document whose `mime_type` is not `application/pdf` AND `allow_download` is `false`, the system SHALL NOT present a "Visualizar" action capable of fetching that document's file.
5. IF the client-side restriction in AC4 is bypassed by any means (e.g. a direct request replaying the "Visualizar" code path) THEN the server-side check in AC1 SHALL still apply and SHALL still respond `403`.
6. IF the token is invalid, the `document_id` is missing/malformed, or the document doesn't belong to this data room THEN the system SHALL apply those existing checks first, in their existing order, before evaluating `allow_download`.

**Independent Test**: Create a data room with a `.pptx` document, `allow_download: false`. Load the public data-room-share page as a visitor → no "Visualizar" action is offered for that document. `curl` the file endpoint directly with the room token and that `document_id` → expect `403`. Flip `allow_download` to `true` → "Visualizar" and "Baixar" both appear and both work end-to-end.

---

### P2: Persist blocked-download attempts and surface them in the Activity Feed

**User Story**: As a workspace owner, I want to see in my Activity Feed when someone tried to download a file that isn't allowed to be downloaded, so that I have visibility into that attempted access instead of it vanishing silently.

**Why P2**: Valuable observability that closes the Phase 12 follow-up item, but the security fix (the P1 stories above) stands on its own without it — this can ship slightly after, or be descoped independently, without reopening the vulnerability.

**Acceptance Criteria**:

1. WHEN the system responds `403` per the P1 share-link story's AC1 THEN the system SHALL persist a record of that blocked attempt, including the share link's id, the document's id, a timestamp, and the requester's identifying info already collected for that link (viewer email/name/fingerprint) when present.
2. IF persisting that record fails (e.g. a transient database error) THEN the system SHALL still respond `403` to the client — persistence failure SHALL NOT change the response the client receives.
3. WHEN `GET /api/v1/activity` is requested for a workspace THEN the system SHALL include that workspace's `blocked_download` events, interleaved with its existing `view` and `link_created` events and ordered by `created_at DESC`.
4. The system SHALL populate each `blocked_download` activity event with the document's title and, when available, the requester's name/email, using `NULL` for fields that don't apply to this event type — following the same explicit-cast convention the existing `view`/`link_created` `UNION ALL` branches already use in `models/activity.ts`.
5. IF a blocked attempt has no identifiable viewer name/email (e.g. a bare request with neither `X-Viewer-Email` nor `X-Viewer-Name` set) THEN the system SHALL still persist and surface the event, with those actor fields `NULL`.
6. WHERE the blocked request originates from a data-room link THEN the system SHALL NOT persist or surface a `blocked_download` activity event in this increment (data-room activity parity is out of scope — see Assumptions).
7. The system SHALL treat a persisted `blocked_download` event as an immutable historical record: a later change to the link's `allow_download` setting SHALL NOT alter or remove previously persisted events.

**Independent Test**: Trigger a blocked download (per the P1 share-link story's Independent Test). `GET /api/v1/activity` for that document's workspace → response includes a new `blocked_download`-typed event referencing that document and link, ordered correctly among other events.

---

## Edge Cases

- IF the same visitor (or script) retries a blocked download multiple times THEN the system SHALL persist one event per attempt, up to the volume already bounded by the existing 20-req/60s rate limiter on the route (no additional dedup/throttle introduced).
- IF the document behind a blocked-download attempt is later soft-deleted THEN the system SHALL treat its `blocked_download` activity event the same way it already treats existing `view`/`link_created` events for a soft-deleted document (no new filtering behavior introduced by this increment).
- IF a request's `mime_type` check and `allow_download` check would both fail (e.g., an inactive link on a non-PDF document with `allow_download: false`) THEN the system SHALL return the pre-existing failure (inactive-link error) rather than `403`, per the ordering in AC4/AC6 above.
- WHEN a data-room document's `allow_download` is toggled from `false` to `true` after some blocked attempts were already made THEN the system SHALL allow subsequent requests immediately (no caching of the prior denial) while leaving previously persisted events unchanged.

---

## Requirement Traceability

Each requirement gets a unique ID for tracking across design, tasks, and validation.

| Requirement ID | Story                                           | Phase   | Status       |
| -------------- | ----------------------------------------------- | ------- | ------------ |
| DL-01          | P1: Share-link file endpoint enforcement        | Execute | Implementing |
| DL-02          | P1: Share-link file endpoint enforcement        | Execute | Implementing |
| DL-03          | P1: Share-link file endpoint enforcement        | Execute | Implementing |
| DL-04          | P1: Share-link file endpoint enforcement        | Execute | Verified     |
| DL-05          | P1: Share-link file endpoint enforcement        | Execute | Implementing |
| DL-06          | P1: Data-room file endpoint + Visualizar bypass | Execute | Implementing |
| DL-07          | P1: Data-room file endpoint + Visualizar bypass | Execute | Implementing |
| DL-08          | P1: Data-room file endpoint + Visualizar bypass | Execute | Implementing |
| DL-09          | P1: Data-room file endpoint + Visualizar bypass | Execute | Verified     |
| DL-10          | P1: Data-room file endpoint + Visualizar bypass | Execute | Implementing |
| DL-11          | P1: Data-room file endpoint + Visualizar bypass | Execute | Implementing |
| DL-12          | P2: Persist + surface blocked-download events   | Execute | Implementing |
| DL-13          | P2: Persist + surface blocked-download events   | Execute | Verified     |
| DL-14          | P2: Persist + surface blocked-download events   | Execute | Implementing |
| DL-15          | P2: Persist + surface blocked-download events   | Execute | Implementing |
| DL-16          | P2: Persist + surface blocked-download events   | Execute | Implementing |
| DL-17          | P2: Persist + surface blocked-download events   | Execute | Implementing |
| DL-18          | P2: Persist + surface blocked-download events   | Execute | Implementing |

**ID format:** `[CATEGORY]-[NUMBER]` (`DL` = download-lock enforcement)

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 18 total, 18 mapped to tasks (T1-T8), 18 Implementing (T1-T8 all committed) - pending Verifier for "Verified" status

---

## Success Criteria

How we know the feature is successful:

- [ ] A direct, non-browser request (`curl`) to either file-proxy endpoint for a non-PDF document with `allow_download: false` returns `403` and zero file bytes — verified by a new automated integration test in `tests/integration/api/v1/share/[token]/file/index.test.ts` (new file) and an extension of `tests/integration/api/v1/data-room-share/[token]/file/index.test.ts`.
- [ ] Existing PDF viewing behavior is unchanged for both `allow_download: true` and `allow_download: false` links — verified by integration tests covering both cases returning `200` with correct bytes.
- [ ] The data-room viewer no longer offers a working "Visualizar" action for a non-PDF, `allow_download: false` document.
- [ ] A workspace's `GET /api/v1/activity` response includes a `blocked_download` event within the same request cycle as the blocked share-link file request that produced it — verified by an integration test.
- [ ] `npm run sf` and `npm test` both exit `0` (per `CLAUDE.md`'s Definition of Done).
