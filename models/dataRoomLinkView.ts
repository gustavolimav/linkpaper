import database from "../infra/database";
import dataRoomLink from "./dataRoomLink";
import type {
  DataRoomLinkView,
  RecordedDataRoomLinkView,
  DataRoomLinkViewCreateInput,
  DataRoomLinkViewModel,
} from "../types/index";

const DATA_ROOM_LINK_VIEW_COLUMNS = `
  id, data_room_link_id, document_id, viewer_fingerprint, viewer_email,
  viewer_name, ip_address, country_code, user_agent, time_on_page,
  pages_viewed, downloaded, created_at, updated_at
`;

// Same 30-minute merge window as models/linkView.ts, keyed by
// (link, document, fingerprint) instead of just (link, fingerprint) —
// a data-room link covers several documents, so the same viewer opening
// two different documents in one sitting produces two rows, not one.
const DEDUP_WINDOW_MINUTES = 30;

async function recordView(
  token: string,
  input: DataRoomLinkViewCreateInput,
): Promise<RecordedDataRoomLinkView> {
  const { id: dataRoomLinkId } = await dataRoomLink.validateToken(token);

  if (!input.viewer_fingerprint) {
    const view = await insertView(dataRoomLinkId, input);
    return { ...view, is_new_viewer: false };
  }

  return await upsertViewWithDedup(dataRoomLinkId, input);
}

async function insertView(
  dataRoomLinkId: string,
  input: DataRoomLinkViewCreateInput,
): Promise<DataRoomLinkView> {
  const results = await database.query<DataRoomLinkView>({
    text: `
        INSERT INTO
          data_room_link_views (
            data_room_link_id, document_id, viewer_fingerprint,
            viewer_email, viewer_name, ip_address, user_agent,
            time_on_page, pages_viewed, downloaded
          )
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING
          ${DATA_ROOM_LINK_VIEW_COLUMNS}
        ;`,
    values: [
      dataRoomLinkId,
      input.document_id,
      input.viewer_fingerprint ?? null,
      input.viewer_email ?? null,
      input.viewer_name ?? null,
      input.ip_address ?? null,
      input.user_agent ?? null,
      input.time_on_page ?? null,
      input.pages_viewed ?? null,
      input.downloaded ?? false,
    ],
  });

  return results.rows[0]!;
}

// Same dedicated-client/transaction shape as
// linkView.ts#upsertViewWithDedup, keyed by (link, document, fingerprint).
async function upsertViewWithDedup(
  dataRoomLinkId: string,
  input: DataRoomLinkViewCreateInput,
): Promise<RecordedDataRoomLinkView> {
  const client = await database.getNewClient();

  try {
    await client.query("BEGIN");

    const existing = await client.query({
      text: `
          SELECT
            id
          FROM
            data_room_link_views
          WHERE
            data_room_link_id = $1
            AND document_id = $2
            AND viewer_fingerprint = $3
            AND created_at > NOW() - INTERVAL '${DEDUP_WINDOW_MINUTES} minutes'
          ORDER BY
            created_at DESC
          LIMIT
            1
          FOR UPDATE
          ;`,
      values: [dataRoomLinkId, input.document_id, input.viewer_fingerprint],
    });

    let result;
    let isNewViewer = false;

    if (existing.rowCount) {
      result = await client.query({
        text: `
            UPDATE
              data_room_link_views
            SET
              viewer_email = COALESCE($1, viewer_email),
              viewer_name = COALESCE($2, viewer_name),
              time_on_page = COALESCE($3, time_on_page),
              pages_viewed = COALESCE($4, pages_viewed),
              downloaded = downloaded OR $5
            WHERE
              id = $6
            RETURNING
              ${DATA_ROOM_LINK_VIEW_COLUMNS}
            ;`,
        values: [
          input.viewer_email ?? null,
          input.viewer_name ?? null,
          input.time_on_page ?? null,
          input.pages_viewed ?? null,
          input.downloaded ?? false,
          existing.rows[0].id,
        ],
      });
    } else {
      const priorAnyTime = await client.query({
        text: `
            SELECT
              1
            FROM
              data_room_link_views
            WHERE
              data_room_link_id = $1
              AND document_id = $2
              AND viewer_fingerprint = $3
            LIMIT
              1
            ;`,
        values: [dataRoomLinkId, input.document_id, input.viewer_fingerprint],
      });

      isNewViewer = priorAnyTime.rowCount === 0;

      result = await client.query({
        text: `
            INSERT INTO
              data_room_link_views (
                data_room_link_id, document_id, viewer_fingerprint,
                viewer_email, viewer_name, ip_address, user_agent,
                time_on_page, pages_viewed, downloaded
              )
            VALUES
              ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING
              ${DATA_ROOM_LINK_VIEW_COLUMNS}
            ;`,
        values: [
          dataRoomLinkId,
          input.document_id,
          input.viewer_fingerprint ?? null,
          input.viewer_email ?? null,
          input.viewer_name ?? null,
          input.ip_address ?? null,
          input.user_agent ?? null,
          input.time_on_page ?? null,
          input.pages_viewed ?? null,
          input.downloaded ?? false,
        ],
      });
    }

    const view = result.rows[0] as DataRoomLinkView;

    await client.query("COMMIT");

    return { ...view, is_new_viewer: isNewViewer };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

// Per-document view_count/last_viewed_at across every link of a room —
// a room can have more than one link, so this aggregates by document_id
// through data_room_links rather than a single link_id (unlike
// linkView.ts's per-link aggregation, which never needs to span links).
async function getStatsByDataRoomId(
  dataRoomId: string,
): Promise<Map<string, { view_count: number; last_viewed_at: Date | null }>> {
  const results = await database.query<{
    document_id: string;
    view_count: string;
    last_viewed_at: Date | null;
  }>({
    text: `
        SELECT
          drlv.document_id,
          COUNT(*)::text AS view_count,
          MAX(drlv.created_at) AS last_viewed_at
        FROM
          data_room_link_views drlv
        JOIN
          data_room_links drl ON drl.id = drlv.data_room_link_id
        WHERE
          drl.data_room_id = $1
        GROUP BY
          drlv.document_id
        ;`,
    values: [dataRoomId],
  });

  return new Map(
    results.rows.map((row) => [
      row.document_id,
      {
        view_count: Number(row.view_count),
        last_viewed_at: row.last_viewed_at,
      },
    ]),
  );
}

const dataRoomLinkView: DataRoomLinkViewModel = {
  recordView,
  getStatsByDataRoomId,
};

export default dataRoomLinkView;
