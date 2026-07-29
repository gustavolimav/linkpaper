# US-56 — Data Room View Analytics

---

**User Story: Data Room View Analytics**

**As a** data room owner,
**I want** to see who viewed which document in my data room, when, and
for how long,
**So that** I have the same visibility into a data room's traffic that I
already have for a single-document share link — right now a data room
link records nothing at all.

**Why this is first:** every other data-room follow-up (NDA gate,
allow-list, notifications, watermark) either produces an event that
should show up here, or depends on knowing who's viewing in the first
place. Shipping this before the others avoids retrofitting view-recording
into each of them separately.

**Acceptance Criteria:**

- [ ] A new `data_room_link_views` table records one row per (link,
      document, viewer) view — mirrors `link_views`' shape
      (`viewer_fingerprint`, `ip_address`, `country_code`, `user_agent`,
      `time_on_page`, `pages_viewed`, `downloaded`, timestamps) plus a
      `document_id` column, since a single data-room link view session
      can touch multiple documents
- [ ] `POST /api/v1/data-room-share/[token]/view` records a view the same
      way `POST /api/v1/share/[token]/view` does today (30-minute
      same-fingerprint-same-document dedup, same shape)
- [ ] The data room detail page (`/data-rooms/[id]`) shows, per document,
      a view count and last-viewed timestamp — reusing
      `ViewerEngagementList.tsx`'s per-viewer table pattern where it
      makes sense, scoped to "per document in this room" instead of "per
      link"
- [ ] `models/dataRoomLink.ts` (or a new `models/dataRoomLinkView.ts`,
      following `linkView.ts`'s split) exposes an aggregation function
      analogous to `getAnalyticsByLinkId`
- [ ] Frontend `DataRoomViewerPage.tsx` calls the new `/view` endpoint on
      load/page-time-tracking, same instrumentation pattern as
      `ViewerPage.tsx` (fingerprint, dwell time per page — deferred to a
      later story if page-level tracking per document turns out to be
      too much scope; a coarse per-document `time_on_page`/`downloaded`
      is the minimum bar here)
- [ ] Integration tests: recording a view, dedup within 30 minutes,
      distinct documents in the same room tracked separately, analytics
      endpoint returns correct counts

**Technical Context:**

- Relevant files: `infra/migrations/0NN-create-data-room-link-views.sql`
  (new), `models/linkView.ts` (read for the exact dedup/aggregation
  pattern to mirror), `models/dataRoomLink.ts`,
  `pages/api/v1/data-room-share/[token]/view/index.ts` (new),
  `components/data-room-viewer/DataRoomViewerPage.tsx`,
  `components/data-rooms/DataRoomDetail.tsx`
- Not in scope here: an engagement score for data rooms (US-52/Phase 5's
  `computeEngagementScore` is per-link/single-`pageCount` — a data-room
  equivalent would need its own weighting, same as US-54's contacts
  directory needed its own formula; punt until this raw data exists)
- Depends on: nothing new — `share_link_id` naming precedent already
  exists in `link_views`; this is an additive table, not a change to it
