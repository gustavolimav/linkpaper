# US-59 — Data Room View Notifications

---

**User Story: Data Room View Notifications**

**As a** data room owner,
**I want** an email when someone views a document in my data room,
**So that** I find out about engagement in real time instead of having
to check the data room's analytics page — matching what a
single-document share link's `notify_on_view` already does.

**Acceptance Criteria:**

- [ ] `data_room_links` gains `notify_on_view BOOLEAN NOT NULL DEFAULT
TRUE` (same default as `share_links`, since it's opt-out not
      opt-in)
- [ ] `POST/PATCH .../data-rooms/[id]/links[/[linkId]]` accept
      `notify_on_view`
- [ ] Recording a view (US-56's `POST
/api/v1/data-room-share/[token]/view`) sends an email to the room
      creator when `notify_on_view` is on — same fire-and-forget,
      never-block-the-response pattern as
      `mailer.ts#sendViewNotification`, and the same silent-no-op when
      `RESEND_API_KEY` isn't configured
      (`sendViewNotification`/`MailerModel`'s existing degrade-gracefully
      convention)
- [ ] The notification email identifies which document (of possibly
      several in the room) was viewed and by whom (if an email was
      captured via US-57), not just "someone viewed your data room"
- [ ] Integration tests: notification fires once per recorded view
      (respecting US-56's dedup — a deduped revisit within the window
      shouldn't re-notify), no email sent when `notify_on_view` is off or
      when `RESEND_API_KEY` is unset

**Technical Context:**

- Relevant files: `infra/mailer.ts#sendViewNotification`,
  `models/shareLink.ts#getNotificationInfo` (copy the pattern for a
  `dataRoomLink.ts` equivalent — needs the room's creator email, room
  name, and document title, not a single document's like the original)
- Depends on US-56 (view analytics) — there's nothing to trigger a
  notification from until views are actually being recorded
- No new email template system needed — reuse whatever template
  structure `sendViewNotification` already uses, parameterized per
  document/room instead of per single document
