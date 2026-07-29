# US-57 — Data Room Access Control (Require Email + Allow-List)

---

**User Story: Data Room Access Control**

**As a** data room owner running a due-diligence process,
**I want** to require a visitor's email before they see any document, and
optionally restrict access to a specific list of approved emails,
**So that** I know who's in the room and can keep it limited to the
people I actually invited — the same controls a single-document share
link already has.

**Acceptance Criteria:**

- [ ] `data_room_links` gains `require_email BOOLEAN NOT NULL DEFAULT
FALSE`
- [ ] A new `data_room_link_allowed_emails` table (mirrors
      `share_link_allowed_emails`: `data_room_link_id`, `email`),
      full-replace semantics on update
- [ ] `POST/PATCH .../data-rooms/[id]/links[/[linkId]]` accept
      `require_email` and `allowed_emails`, same validation as
      `shareLinkCreateSchema`/`shareLinkUpdateSchema`
      (`allowedEmailsSchema`, max 100 addresses)
- [ ] `GET /api/v1/data-room-share/[token]` requires
      `X-Viewer-Email`/`X-Viewer-Name` headers (same convention as the
      single-document route) when `require_email` is on or an allow-list
      is configured; rejects with the same pt-BR messages
      (`fetchAndValidateTokenRow`'s email-required/email-not-allowed
      errors) when missing or not on the list
- [ ] `GET /api/v1/data-room-share/[token]/file` re-validates the same
      email gate before streaming any document's bytes (a visitor who
      never passed the gate can't reach a document by guessing its id)
- [ ] Frontend: `DataRoomViewerPage.tsx` shows an email-gate step (reuse
      `EmailGate.tsx`) before the document list when required
- [ ] `models/dataRoomLink.ts`'s `getByToken`/`getFileByToken` gain the
      `providedEmail`/`providedName` parameters, threaded through the
      same way `shareLink.ts`'s equivalents already work
- [ ] Integration tests: missing email rejected, non-allow-listed email
      rejected, allow-listed/any-valid email (depending on which gate is
      configured) succeeds, gate enforced on both the detail route and
      the file route

**Technical Context:**

- Relevant files: `models/shareLink.ts` (`fetchAndValidateTokenRow`,
  `replaceAllowedEmails`, `getAllowedEmails` — copy the pattern, not the
  code, same as US-55's own approach to `models/dataRoomLink.ts`),
  `infra/schemas.ts#allowedEmailsSchema`,
  `components/viewer/EmailGate.tsx`
- Depends on: US-56 (view analytics) is not a hard dependency, but
  shipping it first means the email captured here immediately shows up
  in the per-document viewer list instead of being collected with
  nowhere to display it yet
- Out of scope: NDA-specific email+name+accept flow — that's US-58; this
  story only covers the plain email/allow-list gate
