# US-61 — Data Room Custom Branding

---

**User Story: Data Room Custom Branding**

**As a** data room owner sending a room to an investor or counterparty,
**I want** to set an accent color and a welcome message on the room's
link,
**So that** the experience feels like it's coming from me/my company
instead of a generic Papershare page — matching the existing
single-document `brand_accent_color`/`brand_welcome_message` feature.

**Acceptance Criteria:**

- [ ] `data_room_links` gains `brand_accent_color VARCHAR(7)` and
      `brand_welcome_message VARCHAR(500)` (nullable, same shape as
      `share_links`)
- [ ] `POST/PATCH .../data-rooms/[id]/links[/[linkId]]` accept both
      fields, same validation as `shareLinkCreateSchema`/
      `shareLinkUpdateSchema` (`brandAccentColorSchema` — `#RRGGBB` regex
      — and `brandWelcomeMessageSchema`)
- [ ] `GET /api/v1/data-room-share/[token]` includes both fields in its
      response (they're non-sensitive display data, same rationale as
      the single-document route already includes them)
- [ ] `DataRoomViewerPage.tsx` applies `brand_accent_color` (e.g. as a
      CSS custom property, same approach as the single-document
      viewer's `--primary` override) and renders
      `brand_welcome_message` once past any gates (password/email/NDA),
      matching where the single-document viewer shows it
- [ ] Integration tests: both fields round-trip through create/update/
      public-read; invalid hex color rejected with 400

**Technical Context:**

- Relevant files: wherever the single-document viewer applies
  `brand_accent_color` today (grep `ViewerPage.tsx`/`ViewerCardShell.tsx`
  for the CSS variable override — copy the exact mechanism)
- Lowest-priority of the data-room follow-ups: purely cosmetic, no new
  access-control or data-visibility value, safe to schedule last
- Plan-gating note: same as US-60 — the single-document version of this
  is Pro-gated (`assertGatedFeaturesAllowed`); confirm with the user
  whether the data-room version should be too, before implementing
