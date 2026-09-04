import database from "../infra/database";
import type {
  BlockedDownloadAttempt,
  BlockedDownloadCreateInput,
  BlockedDownloadModel,
} from "../types/index";

const BLOCKED_DOWNLOAD_COLUMNS = `
  id, share_link_id, document_id, viewer_email, viewer_name, created_at
`;

async function record(
  input: BlockedDownloadCreateInput,
): Promise<BlockedDownloadAttempt> {
  const results = await database.query<BlockedDownloadAttempt>({
    text: `
        INSERT INTO
          blocked_download_attempts (
            share_link_id, document_id, viewer_email, viewer_name
          )
        VALUES
          ($1, $2, $3, $4)
        RETURNING
          ${BLOCKED_DOWNLOAD_COLUMNS}
        ;`,
    values: [
      input.share_link_id,
      input.document_id,
      input.viewer_email ?? null,
      input.viewer_name ?? null,
    ],
  });

  return results.rows[0]!;
}

const blockedDownload: BlockedDownloadModel = { record };

export default blockedDownload;
