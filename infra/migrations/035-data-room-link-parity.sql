-- Bring data_room_links up to feature parity with share_links
-- Migration: 035-data-room-link-parity.sql
-- Implements US-56 through US-62 (see user-stories/phase-9-workspaces/)

ALTER TABLE data_room_links
  ADD COLUMN require_email BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN notify_on_view BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN watermark_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN nda_text TEXT,
  ADD COLUMN brand_accent_color VARCHAR(7),
  ADD COLUMN brand_welcome_message VARCHAR(500);

-- Mirrors share_link_allowed_emails (US-57)
CREATE TABLE data_room_link_allowed_emails (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data_room_link_id UUID NOT NULL REFERENCES data_room_links(id) ON DELETE CASCADE,
    email VARCHAR(254) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX data_room_link_allowed_emails_link_id_idx ON data_room_link_allowed_emails (data_room_link_id);

-- Mirrors link_views (US-56), plus document_id: a single data-room link
-- covers several documents, so a view needs to say which one was actually
-- opened. Deliberately no per-page dwell-time table (link_view_pages'
-- equivalent) yet — a coarse per-document time_on_page/pages_viewed is the
-- scoped-down bar for this story; page-level tracking can be added later
-- the same way link_view_pages was, without reshaping this table.
CREATE TABLE data_room_link_views (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data_room_link_id UUID NOT NULL REFERENCES data_room_links(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id),
    viewer_fingerprint VARCHAR(64),
    viewer_email VARCHAR(254),
    viewer_name VARCHAR(255),
    ip_address INET,
    country_code CHAR(2),
    user_agent TEXT,
    time_on_page INTEGER,
    pages_viewed INTEGER,
    downloaded BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX data_room_link_views_link_id_idx ON data_room_link_views (data_room_link_id);
CREATE INDEX data_room_link_views_document_id_idx ON data_room_link_views (document_id);
CREATE INDEX data_room_link_views_created_at_idx ON data_room_link_views (created_at);
-- speeds up the 30-minute dedup lookup in models/dataRoomLinkView.ts
CREATE INDEX data_room_link_views_dedup_idx ON data_room_link_views (data_room_link_id, document_id, viewer_fingerprint, created_at);

CREATE TRIGGER trigger_set_updated_at
BEFORE UPDATE ON data_room_link_views
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
