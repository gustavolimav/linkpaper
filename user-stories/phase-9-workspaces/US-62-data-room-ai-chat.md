# US-62 — Data Room AI Viewer Chat

---

**User Story: Data Room AI Viewer Chat**

**As a** data room visitor,
**I want** to ask questions about the documents in the room and get an
AI-drafted answer grounded in their content,
**So that** I don't have to read every document end-to-end to find what
I need — matching the existing single-document viewer chat (US-16,
RAG over one document).

**Acceptance Criteria:**

- [ ] `GET /api/v1/data-room-share/[token]` includes an
      `ai_chat_available` boolean, same resolution as the single-document
      route (`creator.ai_api_key_encrypted IS NOT NULL` for the room's
      workspace's creator — a data room's documents always belong to one
      workspace, per US-55's own validation, so this is a single lookup,
      not a per-document one)
- [ ] A new `POST /api/v1/data-room-share/[token]/chat` accepts
      `{ document_id, question }` and answers grounded in that one
      document's chunks — same RAG mechanism as
      `POST /api/v1/share/[token]/chat`, scoped to whichever document the
      visitor is currently asking about (not a cross-document answer;
      that's a meaningfully harder retrieval problem, explicitly out of
      scope for this story)
- [ ] Validates `document_id` belongs to the room (same check
      `dataRoomLink.ts#getFileByToken` already does for file streaming)
      before answering
- [ ] Same rate limit and 503-when-unconfigured degrade-gracefully
      behavior as the single-document chat endpoint
- [ ] Frontend: `DataRoomViewerPage.tsx` gets a chat toggle per open
      document (reuse `ChatPanel.tsx`), shown only when
      `ai_chat_available` and only for whichever document is currently
      being viewed
- [ ] Integration tests: chat rejected for a document not in the room,
      chat unavailable (503) when the workspace creator has no AI key
      configured, a valid question returns a grounded answer

**Technical Context:**

- Relevant files: `pages/api/v1/share/[token]/chat/index.ts`,
  `infra/schemas.ts#chatCreateSchema`, `models/document.ts` (chunk
  retrieval), `components/viewer/ChatPanel.tsx`
- Depends on nothing else in this list — can be picked up independently,
  though it's the most complex of the seven (US-56 through US-62) and
  reasonable to schedule last given it's also the lowest-frequency need
  compared to analytics/access-control/NDA
- Explicitly NOT in scope: a single chat session answering from multiple
  documents in the room at once. If that turns out to be wanted later,
  it's a separate, bigger story (whole-room retrieval, not per-document)
