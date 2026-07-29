# US-58 — Data Room NDA Gate

---

**User Story: Data Room NDA Gate**

**As a** data room owner sharing sensitive due-diligence material,
**I want** to require visitors to accept a confidentiality agreement
before they see any document,
**So that** every viewer of the room has agreed to the same terms,
matching what a single-document share link's NDA gate already does —
and arguably more expected for a data room than for a single file.

**Acceptance Criteria:**

- [ ] `data_room_links` gains `nda_text TEXT` (nullable — same convention
      as `share_links.nda_text`)
- [ ] `POST/PATCH .../data-rooms/[id]/links[/[linkId]]` accept `nda_text`,
      same validation as `shareLinkCreateSchema`/`shareLinkUpdateSchema`
      (`ndaTextSchema`, max 10000 chars)
- [ ] `GET /api/v1/data-room-share/[token]` requires the visitor to
      submit name + email + acceptance before returning the document
      list when `nda_text` is set — same priority-over-plain-email-gate
      rule as `fetchAndValidateTokenRow` (NDA text surfaces first if both
      would otherwise apply)
- [ ] A new `GET /api/v1/data-room-share/[token]/nda` mirrors
      `shareLink.ts#getNdaText`/`GET /api/v1/share/[token]/nda` — returns
      the NDA text itself without gating (so the visitor can read it
      before deciding to accept), null for a room with none configured
- [ ] Frontend: `DataRoomViewerPage.tsx` shows the NDA gate (reuse
      `NdaGate.tsx`) before the document list when configured
- [ ] Integration tests: NDA text visible pre-acceptance via the `/nda`
      route, document list blocked until name+email+acceptance submitted,
      NDA takes priority over a plain email-required message when both
      are configured (US-57 + this story combined)

**Technical Context:**

- Relevant files: `models/shareLink.ts#getNdaText`,
  `pages/api/v1/share/[token]/nda/index.ts`,
  `components/viewer/NdaGate.tsx`
- Depends on US-57 (Access Control) — the NDA gate reuses the same
  name/email capture plumbing (`providedEmail`/`providedName` threaded
  through `getByToken`/`getFileByToken`); implement US-57 first
- Consider whether NDA acceptance should be persisted per-viewer (a
  `data_room_link_views.nda_accepted_at` column, once US-56 exists) so
  the owner can see who explicitly agreed and when — same gap flagged for
  single-document links in Phase 12's activity-feed follow-up
  (`TODO.md`); reasonable to fold into this story rather than defer again
