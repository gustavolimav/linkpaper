import database from "../infra/database";
import type {
  ActivityEvent,
  ActivityListResponse,
  ActivityModel,
  PaginationParams,
} from "../types/index";

// Three shapes UNION ALL'd together — every column must line up in type
// across all branches, hence the explicit NULL::type casts on whichever
// side doesn't have that field. See US-52: NDA-acceptance events aren't
// included because they still aren't persisted anywhere. blocked_download
// events (share-link only — see AD-004) are the third branch below.
const ACTIVITY_UNION = `
  SELECT
    'view' AS event_type,
    lv.id,
    d.id AS document_id,
    d.title AS document_title,
    lv.viewer_name AS actor_name,
    lv.viewer_email AS actor_email,
    NULL::varchar AS link_label,
    lv.pages_viewed,
    d.page_count,
    lv.time_on_page,
    EXISTS (
      SELECT 1 FROM link_views lv2
      WHERE
        lv2.share_link_id = lv.share_link_id
        AND lv2.viewer_fingerprint = lv.viewer_fingerprint
        AND lv2.created_at < lv.created_at
    ) AS is_revisit,
    lv.created_at
  FROM
    link_views lv
  JOIN
    share_links sl ON sl.id = lv.share_link_id
  JOIN
    documents d ON d.id = sl.document_id
  WHERE
    d.workspace_id = $1

  UNION ALL

  SELECT
    'link_created' AS event_type,
    sl.id,
    d.id AS document_id,
    d.title AS document_title,
    u.username AS actor_name,
    NULL::varchar AS actor_email,
    sl.label AS link_label,
    NULL::int AS pages_viewed,
    NULL::int AS page_count,
    NULL::int AS time_on_page,
    false AS is_revisit,
    sl.created_at
  FROM
    share_links sl
  JOIN
    documents d ON d.id = sl.document_id
  JOIN
    users u ON u.id = sl.user_id
  WHERE
    d.workspace_id = $1

  UNION ALL

  SELECT
    'blocked_download' AS event_type,
    bda.id,
    d.id AS document_id,
    d.title AS document_title,
    bda.viewer_name AS actor_name,
    bda.viewer_email AS actor_email,
    sl.label AS link_label,
    NULL::int AS pages_viewed,
    NULL::int AS page_count,
    NULL::int AS time_on_page,
    false AS is_revisit,
    bda.created_at
  FROM
    blocked_download_attempts bda
  JOIN
    share_links sl ON sl.id = bda.share_link_id
  JOIN
    documents d ON d.id = bda.document_id
  WHERE
    d.workspace_id = $1
`;

async function findAllByWorkspaceId(
  workspaceId: string,
  pagination: PaginationParams,
): Promise<ActivityListResponse> {
  const [eventsResult, countResult] = await Promise.all([
    database.query<ActivityEvent>({
      text: `
          SELECT * FROM (${ACTIVITY_UNION}) events
          ORDER BY
            created_at DESC
          LIMIT
            $2
          OFFSET
            $3
          ;`,
      values: [workspaceId, pagination.perPage, pagination.offset],
    }),
    database.query<{ count: string }>({
      text: `
          SELECT COUNT(*)::text AS count FROM (${ACTIVITY_UNION}) events
          ;`,
      values: [workspaceId],
    }),
  ]);

  return {
    events: eventsResult.rows,
    total: Number(countResult.rows[0]!.count),
  };
}

const activity: ActivityModel = { findAllByWorkspaceId };

export default activity;
