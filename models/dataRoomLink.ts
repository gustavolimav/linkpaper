import database from "../infra/database";
import { NotFoundError, ForbiddenError } from "../infra/errors";
import { isValidEmail } from "../infra/schemas";
import password from "./password";
import workspace from "./workspace";
import type {
  DataRoomLink,
  DataRoomLinkResponse,
  DataRoomLinkCreateInput,
  DataRoomLinkUpdateInput,
  DataRoomLinkWithDocuments,
  DataRoomLinkNotificationInfo,
  DataRoomDocumentSummary,
  DataRoomLinkModel,
  QueryParam,
} from "../types/index";

const DATA_ROOM_LINK_COLUMNS = `
  id, token, data_room_id, user_id, label, password_hash,
  expires_at, is_active, created_at, updated_at,
  require_email, notify_on_view, watermark_enabled, nda_text,
  brand_accent_color, brand_welcome_message
`;

function toResponse(
  link: DataRoomLink,
  allowedEmails: string[],
): DataRoomLinkResponse {
  const { password_hash, ...rest } = link;
  return {
    ...rest,
    has_password: password_hash !== null,
    allowed_emails: allowedEmails,
  };
}

async function getAllowedEmails(dataRoomLinkId: string): Promise<string[]> {
  const results = await database.query<{ email: string }>({
    text: `
        SELECT
          email
        FROM
          data_room_link_allowed_emails
        WHERE
          data_room_link_id = $1
        ORDER BY
          email ASC
        ;`,
    values: [dataRoomLinkId],
  });

  return results.rows.map((row) => row.email);
}

// Full-replace semantics, same pattern as shareLink.ts's
// replaceAllowedEmails.
async function replaceAllowedEmails(
  dataRoomLinkId: string,
  emails: string[],
): Promise<void> {
  const client = await database.getNewClient();

  try {
    await client.query("BEGIN");

    await client.query({
      text: "DELETE FROM data_room_link_allowed_emails WHERE data_room_link_id = $1;",
      values: [dataRoomLinkId],
    });

    for (const email of emails) {
      await client.query({
        text: `
            INSERT INTO
              data_room_link_allowed_emails (data_room_link_id, email)
            VALUES
              ($1, $2)
            ON CONFLICT
              DO NOTHING
            ;`,
        values: [dataRoomLinkId, email],
      });
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

function assertLinkIsActiveAndNotExpired(row: {
  is_active: boolean;
  expires_at: Date | null;
}): void {
  if (!row.is_active) {
    throw new ForbiddenError({
      message: "Este link foi revogado.",
      action: "Solicite um novo link ao proprietário da data room.",
    });
  }

  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    throw new ForbiddenError({
      message: "Este link expirou.",
      action: "Solicite um novo link ao proprietário da data room.",
    });
  }
}

// Existence + soft-delete check only — mirrors the document-workspace
// lookup and link-row lookup helpers in shareLink.ts; every caller does
// its own requireRole() first.
async function getRoomWorkspaceId(dataRoomId: string): Promise<string> {
  const results = await database.query<{ workspace_id: string }>({
    text: `
        SELECT
          workspace_id
        FROM
          data_rooms
        WHERE
          id = $1
          AND deleted_at IS NULL
        ;`,
    values: [dataRoomId],
  });

  const workspaceId = results.rows[0]?.workspace_id;

  if (!workspaceId) {
    throw new NotFoundError({
      message: "A data room informada não foi encontrada.",
      action: "Verifique se o identificador está correto.",
    });
  }

  return workspaceId;
}

async function findLinkRow(
  id: string,
  dataRoomId: string,
): Promise<DataRoomLinkResponse> {
  const results = await database.query<DataRoomLink>({
    text: `
        SELECT
          ${DATA_ROOM_LINK_COLUMNS}
        FROM
          data_room_links
        WHERE
          id = $1
          AND data_room_id = $2
        LIMIT
          1
        ;`,
    values: [id, dataRoomId],
  });

  if (!results.rowCount) {
    throw new NotFoundError({
      message: "O link informado não foi encontrado.",
      action: "Verifique se o identificador está correto.",
    });
  }

  return toResponse(results.rows[0]!, await getAllowedEmails(id));
}

async function create(
  dataRoomId: string,
  userId: string,
  input: DataRoomLinkCreateInput,
): Promise<DataRoomLinkResponse> {
  const workspaceId = await getRoomWorkspaceId(dataRoomId);
  await workspace.requireRole(workspaceId, userId, "editor");

  const passwordHash = input.password
    ? await password.hash(input.password)
    : null;

  const results = await database.query<DataRoomLink>({
    text: `
        INSERT INTO
          data_room_links (
            data_room_id, user_id, label, password_hash, expires_at,
            require_email, notify_on_view, watermark_enabled, nda_text,
            brand_accent_color, brand_welcome_message
          )
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING
          ${DATA_ROOM_LINK_COLUMNS}
        ;`,
    values: [
      dataRoomId,
      userId,
      input.label ?? null,
      passwordHash,
      input.expires_at ?? null,
      input.require_email ?? false,
      input.notify_on_view ?? true,
      input.watermark_enabled ?? false,
      input.nda_text ?? null,
      input.brand_accent_color ?? null,
      input.brand_welcome_message ?? null,
    ],
  });

  const link = results.rows[0]!;

  if (input.allowed_emails?.length) {
    await replaceAllowedEmails(link.id, input.allowed_emails);
  }

  return toResponse(link, await getAllowedEmails(link.id));
}

async function findAllByDataRoomId(
  dataRoomId: string,
  userId: string,
): Promise<DataRoomLinkResponse[]> {
  const workspaceId = await getRoomWorkspaceId(dataRoomId);
  await workspace.requireRole(workspaceId, userId, "viewer");

  const results = await database.query<DataRoomLink>({
    text: `
        SELECT
          ${DATA_ROOM_LINK_COLUMNS}
        FROM
          data_room_links
        WHERE
          data_room_id = $1
        ORDER BY
          created_at DESC
        ;`,
    values: [dataRoomId],
  });

  return Promise.all(
    results.rows.map(async (row) =>
      toResponse(row, await getAllowedEmails(row.id)),
    ),
  );
}

async function updateById(
  id: string,
  dataRoomId: string,
  userId: string,
  input: DataRoomLinkUpdateInput,
): Promise<DataRoomLinkResponse> {
  const workspaceId = await getRoomWorkspaceId(dataRoomId);
  await workspace.requireRole(workspaceId, userId, "editor");
  await findLinkRow(id, dataRoomId);

  const setClauses: string[] = [];
  const values: QueryParam[] = [];

  if (input.label !== undefined) {
    values.push(input.label);
    setClauses.push(`label = $${values.length}`);
  }

  if (input.password !== undefined) {
    values.push(
      input.password === null ? null : await password.hash(input.password),
    );
    setClauses.push(`password_hash = $${values.length}`);
  }

  if (input.expires_at !== undefined) {
    values.push(input.expires_at);
    setClauses.push(`expires_at = $${values.length}`);
  }

  if (input.is_active !== undefined) {
    values.push(input.is_active);
    setClauses.push(`is_active = $${values.length}`);
  }

  if (input.require_email !== undefined) {
    values.push(input.require_email);
    setClauses.push(`require_email = $${values.length}`);
  }

  if (input.notify_on_view !== undefined) {
    values.push(input.notify_on_view);
    setClauses.push(`notify_on_view = $${values.length}`);
  }

  if (input.watermark_enabled !== undefined) {
    values.push(input.watermark_enabled);
    setClauses.push(`watermark_enabled = $${values.length}`);
  }

  if (input.nda_text !== undefined) {
    values.push(input.nda_text);
    setClauses.push(`nda_text = $${values.length}`);
  }

  if (input.brand_accent_color !== undefined) {
    values.push(input.brand_accent_color);
    setClauses.push(`brand_accent_color = $${values.length}`);
  }

  if (input.brand_welcome_message !== undefined) {
    values.push(input.brand_welcome_message);
    setClauses.push(`brand_welcome_message = $${values.length}`);
  }

  if (input.allowed_emails !== undefined) {
    await replaceAllowedEmails(id, input.allowed_emails ?? []);
  }

  // allowed_emails lives in its own table, so a request that only touches
  // it never adds a data_room_links column to update — skip the UPDATE
  // entirely rather than run one with an empty SET clause (same fix as
  // US-25 applied to shareLink.ts#updateById).
  if (setClauses.length === 0) {
    return findLinkRow(id, dataRoomId);
  }

  values.push(id);

  const results = await database.query<DataRoomLink>({
    text: `
        UPDATE
          data_room_links
        SET
          ${setClauses.join(",\n          ")}
        WHERE
          id = $${values.length}
        RETURNING
          ${DATA_ROOM_LINK_COLUMNS}
        ;`,
    values,
  });

  return toResponse(results.rows[0]!, await getAllowedEmails(id));
}

interface DataRoomLinkTokenRow {
  link_id: string;
  token: string;
  label: string | null;
  password_hash: string | null;
  expires_at: Date | null;
  is_active: boolean;
  require_email: boolean;
  watermark_enabled: boolean;
  nda_text: string | null;
  brand_accent_color: string | null;
  brand_welcome_message: string | null;
  has_allow_list: boolean;
  email_is_allowed: boolean;
  data_room_id: string;
  data_room_name: string;
  ai_chat_available: boolean;
}

async function fetchAndValidateTokenRow(
  token: string,
  providedPassword?: string,
  providedEmail?: string,
  providedName?: string,
): Promise<DataRoomLinkTokenRow> {
  const results = await database.query<DataRoomLinkTokenRow>({
    text: `
        SELECT
          drl.id AS link_id,
          drl.token,
          drl.label,
          drl.password_hash,
          drl.expires_at,
          drl.is_active,
          drl.require_email,
          drl.watermark_enabled,
          drl.nda_text,
          drl.brand_accent_color,
          drl.brand_welcome_message,
          EXISTS (
            SELECT 1 FROM data_room_link_allowed_emails a
            WHERE a.data_room_link_id = drl.id
          ) AS has_allow_list,
          EXISTS (
            SELECT 1 FROM data_room_link_allowed_emails a
            WHERE a.data_room_link_id = drl.id AND LOWER(a.email) = LOWER($2)
          ) AS email_is_allowed,
          dr.id AS data_room_id,
          dr.name AS data_room_name,
          (creator.ai_api_key_encrypted IS NOT NULL) AS ai_chat_available
        FROM
          data_room_links drl
        JOIN
          data_rooms dr ON dr.id = drl.data_room_id
        JOIN
          workspaces w ON w.id = dr.workspace_id
        JOIN
          users creator ON creator.id = w.created_by
        WHERE
          drl.token = $1
          AND dr.deleted_at IS NULL
        LIMIT
          1
        ;`,
    values: [token, providedEmail ?? ""],
  });

  if (!results.rowCount) {
    throw new NotFoundError({
      message: "O link informado não foi encontrado.",
      action: "Verifique se o link está correto.",
    });
  }

  const row = results.rows[0]!;

  assertLinkIsActiveAndNotExpired(row);

  if (row.password_hash) {
    const isPasswordValid =
      !!providedPassword &&
      (await password.compare(providedPassword, row.password_hash));

    if (!isPasswordValid) {
      throw new ForbiddenError({
        message: "Senha incorreta.",
        action: "Verifique a senha e tente novamente.",
      });
    }
  }

  // Same priority/inherently-needs-an-identity rules as
  // shareLink.ts#fetchAndValidateTokenRow: NDA/allow-list/watermark all
  // imply an email is required even if require_email itself is off.
  const hasNda = !!row.nda_text && row.nda_text.trim().length > 0;
  const emailRequired =
    row.has_allow_list || hasNda || row.require_email || row.watermark_enabled;

  if (emailRequired && !(providedEmail && isValidEmail(providedEmail))) {
    if (hasNda) {
      throw new ForbiddenError({
        message: "Aceite os termos para continuar.",
        action: "Leia e aceite o termo de confidencialidade para continuar.",
      });
    }

    if (row.has_allow_list) {
      throw new ForbiddenError({
        message: "Email não autorizado.",
        action:
          "Este link só pode ser acessado por emails aprovados pelo proprietário da data room.",
      });
    }

    throw new ForbiddenError({
      message: "Email obrigatório.",
      action: "Informe um email válido para continuar.",
    });
  }

  if (row.has_allow_list && !row.email_is_allowed) {
    throw new ForbiddenError({
      message: "Email não autorizado.",
      action:
        "Este link só pode ser acessado por emails aprovados pelo proprietário da data room.",
    });
  }

  if (hasNda && !providedName?.trim()) {
    throw new ForbiddenError({
      message: "Aceite os termos para continuar.",
      action: "Leia e aceite o termo de confidencialidade para continuar.",
    });
  }

  return row;
}

async function getRoomDocuments(
  dataRoomId: string,
): Promise<DataRoomDocumentSummary[]> {
  const results = await database.query<DataRoomDocumentSummary>({
    text: `
        SELECT
          documents.id AS document_id,
          documents.title,
          documents.mime_type,
          documents.page_count,
          data_room_documents.allow_download
        FROM
          data_room_documents
        JOIN
          documents ON documents.id = data_room_documents.document_id
        WHERE
          data_room_documents.data_room_id = $1
          AND documents.deleted_at IS NULL
        ORDER BY
          data_room_documents.added_at ASC
        ;`,
    values: [dataRoomId],
  });

  return results.rows;
}

async function getByToken(
  token: string,
  providedPassword?: string,
  providedEmail?: string,
  providedName?: string,
): Promise<DataRoomLinkWithDocuments> {
  const row = await fetchAndValidateTokenRow(
    token,
    providedPassword,
    providedEmail,
    providedName,
  );

  return {
    id: row.link_id,
    token: row.token,
    label: row.label,
    expires_at: row.expires_at,
    is_active: row.is_active,
    has_password: row.password_hash !== null,
    watermark_enabled: row.watermark_enabled,
    nda_text: row.nda_text,
    brand_accent_color: row.brand_accent_color,
    brand_welcome_message: row.brand_welcome_message,
    ai_chat_available: row.ai_chat_available,
    data_room: { id: row.data_room_id, name: row.data_room_name },
    documents: await getRoomDocuments(row.data_room_id),
  };
}

// Used only by the internal file-proxy route — storage_key is
// deliberately excluded from DataRoomLinkWithDocuments (the public
// response shape above). Validates document_id actually belongs to this
// room, so a guessed/unrelated document id can't be pulled through a
// valid room token.
async function getFileByToken(
  token: string,
  documentId: string,
  providedPassword?: string,
  providedEmail?: string,
  providedName?: string,
): Promise<{ storage_key: string; mime_type: string }> {
  const row = await fetchAndValidateTokenRow(
    token,
    providedPassword,
    providedEmail,
    providedName,
  );

  const results = await database.query<{
    storage_key: string;
    mime_type: string;
  }>({
    text: `
        SELECT
          documents.storage_key,
          documents.mime_type
        FROM
          data_room_documents
        JOIN
          documents ON documents.id = data_room_documents.document_id
        WHERE
          data_room_documents.data_room_id = $1
          AND data_room_documents.document_id = $2
          AND documents.deleted_at IS NULL
        LIMIT
          1
        ;`,
    values: [row.data_room_id, documentId],
  });

  if (!results.rowCount) {
    throw new NotFoundError({
      message: "O documento informado não pertence a esta data room.",
      action: "Verifique se o identificador está correto.",
    });
  }

  return results.rows[0]!;
}

// Skips the password/email/NDA checks — used by view-event recording,
// which happens after the viewer has already passed every gate on the
// viewer page. Mirrors shareLink.ts#validateToken.
async function validateToken(token: string): Promise<{ id: string }> {
  const results = await database.query<{
    id: string;
    is_active: boolean;
    expires_at: Date | null;
  }>({
    text: `
        SELECT
          drl.id, drl.is_active, drl.expires_at
        FROM
          data_room_links drl
        JOIN
          data_rooms dr ON dr.id = drl.data_room_id
        WHERE
          drl.token = $1
          AND dr.deleted_at IS NULL
        LIMIT
          1
        ;`,
    values: [token],
  });

  if (!results.rowCount) {
    throw new NotFoundError({
      message: "O link informado não foi encontrado.",
      action: "Verifique se o link está correto.",
    });
  }

  const row = results.rows[0]!;

  assertLinkIsActiveAndNotExpired(row);

  return { id: row.id };
}

// The NDA text itself isn't sensitive, same rationale as
// shareLink.ts#getNdaText — readable by any visitor before they submit
// name/email/acceptance. Returns null (not an error) for a revoked/
// expired/deleted/nonexistent link, or one with no NDA configured.
async function getNdaText(token: string): Promise<string | null> {
  const results = await database.query<{
    nda_text: string | null;
    is_active: boolean;
    expires_at: Date | null;
  }>({
    text: `
        SELECT
          drl.nda_text,
          drl.is_active,
          drl.expires_at
        FROM
          data_room_links drl
        JOIN
          data_rooms dr ON dr.id = drl.data_room_id
        WHERE
          drl.token = $1
          AND dr.deleted_at IS NULL
        LIMIT
          1
        ;`,
    values: [token],
  });

  if (!results.rowCount) {
    return null;
  }

  const row = results.rows[0]!;

  if (
    !row.is_active ||
    (row.expires_at && new Date(row.expires_at) < new Date())
  ) {
    return null;
  }

  return row.nda_text;
}

// Used to notify the room's creator when a view is recorded (US-59).
async function getNotificationInfo(
  dataRoomLinkId: string,
  documentId: string,
): Promise<DataRoomLinkNotificationInfo | null> {
  const results = await database.query<DataRoomLinkNotificationInfo>({
    text: `
        SELECT
          u.email AS owner_email,
          dr.id AS data_room_id,
          dr.name AS data_room_name,
          d.id AS document_id,
          d.title AS document_title,
          drl.label AS link_label,
          drl.notify_on_view
        FROM
          data_room_links drl
        JOIN
          data_rooms dr ON dr.id = drl.data_room_id
        JOIN
          users u ON u.id = dr.created_by
        JOIN
          documents d ON d.id = $2
        WHERE
          drl.id = $1
        LIMIT
          1
        ;`,
    values: [dataRoomLinkId, documentId],
  });

  return results.rows[0] ?? null;
}

const dataRoomLink: DataRoomLinkModel = {
  create,
  findAllByDataRoomId,
  updateById,
  getByToken,
  getFileByToken,
  validateToken,
  getNdaText,
  getNotificationInfo,
};

export default dataRoomLink;
