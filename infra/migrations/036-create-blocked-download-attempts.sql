-- Create blocked_download_attempts table
-- Migration: 036-create-blocked-download-attempts.sql

-- One row per request that was refused by the server-side allow_download
-- check on GET /api/v1/share/[token]/file. Deliberately its own table
-- rather than a column on link_views (the way `downloaded` was added in
-- 018): a blocked attempt routinely has no link_views row at all — the
-- file endpoint is reachable by a bare curl that never calls POST /view —
-- so hanging the flag on link_views would mean inventing a synthetic view
-- row and inflating every view/engagement metric derived from that table.
--
-- Append-only: no updated_at and no set_updated_at() trigger. A persisted
-- attempt is immutable history; later flipping the link's allow_download
-- back on must not alter or remove it.
--
-- Share-link only in this increment — data-room blocked attempts are
-- refused with the same 403 but not recorded, because the activity feed
-- has no data-room representation for any event type yet.
CREATE TABLE blocked_download_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- same cascade rationale as link_views: a hard-deleted link takes its
    -- history with it (links are revoked, never DELETEd, in practice)
    share_link_id UUID NOT NULL REFERENCES share_links(id) ON DELETE CASCADE,
    -- stored explicitly, not derived through share_links.document_id, so
    -- the record stays self-describing regardless of later schema changes
    document_id UUID NOT NULL REFERENCES documents(id),
    -- only what the file endpoint actually receives (X-Viewer-Email /
    -- X-Viewer-Name); NULL for an anonymous request
    viewer_email VARCHAR(254),
    viewer_name VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX blocked_download_attempts_share_link_id_idx ON blocked_download_attempts (share_link_id);
CREATE INDEX blocked_download_attempts_created_at_idx ON blocked_download_attempts (created_at);
