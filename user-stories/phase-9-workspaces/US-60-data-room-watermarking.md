# US-60 — Data Room Watermarking

---

**User Story: Data Room Watermarking**

**As a** data room owner sharing sensitive documents,
**I want** each viewer's email burned into the document as a watermark,
**So that** a leaked copy of any document in the room can be traced back
to whoever it was shared with — matching the existing single-document
`watermark_enabled` feature.

**Acceptance Criteria:**

- [ ] `data_room_links` gains `watermark_enabled BOOLEAN NOT NULL DEFAULT
FALSE`
- [ ] `POST/PATCH .../data-rooms/[id]/links[/[linkId]]` accept
      `watermark_enabled`
- [ ] `watermark_enabled` implies an email is required to view (same
      "inherently needs an identity" rule `fetchAndValidateTokenRow`
      already applies to the single-document link) — depends on US-57
      being in place first
- [ ] Every document viewed/downloaded through a watermark-enabled data
      room link is watermarked with the viewer's email, reusing the
      existing mechanism as-is: `ViewerPage.tsx` computes
      `watermarkTextRef` (`"{email} · {timestamp}"`) once per session and
      passes it to `PDFViewer.tsx`, which burns it into each rendered
      page via a canvas overlay (`drawWatermark`) — this is a frontend
      change in `DataRoomViewerPage.tsx` (compute the same string, pass
      it through when rendering a document) plus surfacing
      `watermark_enabled` in the public API response; no new watermark
      logic needs to be written
- [ ] Integration tests: `watermark_enabled` without an email present is
      rejected (same as the single-doc link's rule), the public response
      surfaces `watermark_enabled` so the frontend knows to render it

**Technical Context:**

- Relevant files: `components/viewer/PDFViewer.tsx`,
  `components/viewer/ViewerPage.tsx` (read for the existing watermark
  rendering approach before implementing the data-room equivalent — do
  not re-derive the mechanism from scratch)
- Depends on US-57 (Access Control) for the email-required precondition
- Plan-gating note: the single-document `watermark_enabled` is a
  Pro-plan-gated feature (`assertGatedFeaturesAllowed` in
  `shareLink.ts`). Confirm with the user whether data-room watermarking
  should be gated the same way before implementing — not decided in this
  story
