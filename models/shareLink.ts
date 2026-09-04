import crypto from "crypto";
import database from "../infra/database";
import {
  NotFoundError,
  ForbiddenError,
  PaymentRequiredError,
} from "../infra/errors";
import { isValidEmail } from "../infra/schemas";
import password from "./password";
import workspace from "./workspace";
import subscription from "./subscription";
import blockedDownload from "./blockedDownload";
import type {
  ShareLink,
  ShareLinkResponse,
  ShareLinkCreateInput,
  ShareLinkUpdateInput,
  ShareLinkWithDocument,
  ShareLinkNotificationInfo,
  ShareLinkModel,
  SubscriptionPlan,
  WorkspaceLinkSummary,
  WorkspaceLinksResponse,
  QueryParam,
  PaginationParams,
} from "../types/index";

const SHARE_LINK_COLUMNS = `
  id, token, document_id, user_id, label, password_hash,
  expires_at, allow_download, is_active, created_at, updated_at,
  notify_on_view, require_email, watermark_enabled, nda_text,
  brand_accent_color, brand_welcome_message
`;

// AD-001: enforcement is scoped to non-PDF documents. Both viewers fetch
// this same endpoint to render a PDF inline, so blocking PDFs here would
// break viewing on every "view-only" link.
const PDF_MIME_TYPE = "application/pdf";

interface ShareLinkTokenRow {
  link_id: string;
  token: string;
  label: string | null;
  password_hash: string | null;
  expires_at: Date | null;
  allow_download: boolean;
  is_active: boolean;
  require_email: boolean;
  watermark_enabled: boolean;
  nda_text: string | null;
  brand_accent_color: string | null;
  brand_welcome_message: string | null;
  has_allow_list: boolean;
  email_is_allowed: boolean;
  link_created_at: Date;
  ai_chat_available: boolean;
  document_id: string;
  title: string;
  description: string | null;
  mime_type: string;
  size_bytes: number;
  page_count: number | null;
  storage_key: string;
  document_deleted_at: Date | null;
}

function toResponse(
  link: ShareLink,
  allowedEmails: string[],
): ShareLinkResponse {
  const { password_hash, ...rest } = link;
  return {
    ...rest,
    has_password: password_hash !== null,
    allowed_emails: allowedEmails,
  };
}

async function getAllowedEmails(shareLinkId: string): Promise<string[]> {
  const results = await database.query<{ email: string }>({
    text: `
        SELECT
          email
        FROM
          share_link_allowed_emails
        WHERE
          share_link_id = $1
        ORDER BY
          email ASC
        ;`,
    values: [shareLinkId],
  });

  return results.rows.map((row) => row.email);
}

// Full-replace semantics: clears the existing allow-list and inserts the
// given set, so the owner doesn't need a separate add/remove API for what's
// really just "here's the current list" from the edit form.
async function replaceAllowedEmails(
  shareLinkId: string,
  emails: string[],
): Promise<void> {
  const client = await database.getNewClient();

  try {
    await client.query("BEGIN");

    await client.query({
      text: "DELETE FROM share_link_allowed_emails WHERE share_link_id = $1;",
      values: [shareLinkId],
    });

    for (const email of emails) {
      await client.query({
        text: `
            INSERT INTO
              share_link_allowed_emails (share_link_id, email)
            VALUES
              ($1, $2)
            ON CONFLICT
              DO NOTHING
            ;`,
        values: [shareLinkId, email],
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
      action: "Solicite um novo link ao proprietário do documento.",
    });
  }

  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    throw new ForbiddenError({
      message: "Este link expirou.",
      action: "Solicite um novo link ao proprietário do documento.",
    });
  }
}

// Records the refused attempt, then blocks. Best-effort by design: a
// failed audit write is swallowed so the 403 is returned either way — the
// security block must never depend on the audit log succeeding (DL-13).
// Awaited rather than left dangling so the row is observable within the
// same request cycle.
async function denyDownload(
  row: ShareLinkTokenRow,
  providedEmail?: string,
  providedName?: string,
): Promise<never> {
  await blockedDownload
    .record({
      share_link_id: row.link_id,
      document_id: row.document_id,
      ...(providedEmail !== undefined && { viewer_email: providedEmail }),
      ...(providedName !== undefined && { viewer_name: providedName }),
    })
    .catch(() => undefined);

  throw new ForbiddenError({
    message: "O download deste arquivo não está habilitado para este link.",
    action:
      "Peça ao proprietário do documento para habilitar o download, se necessário.",
  });
}

// No role check — an existence/deleted_at check only, returning the
// workspace_id every public function below needs for its own requireRole()
// call (viewer for reads, editor for writes).
async function getDocumentWorkspaceId(documentId: string): Promise<string> {
  const results = await database.query<{ workspace_id: string }>({
    text: `
        SELECT
          workspace_id
        FROM
          documents
        WHERE
          id = $1
          AND deleted_at IS NULL
        ;`,
    values: [documentId],
  });

  const workspaceId = results.rows[0]?.workspace_id;

  if (!workspaceId) {
    throw new NotFoundError({
      message: "O documento informado não foi encontrado.",
      action: "Verifique se o identificador está correto.",
    });
  }

  return workspaceId;
}

// Existence check only (the link belongs to this document) — no role
// check, since every caller already did its own requireRole() first.
async function findLinkRow(
  id: string,
  documentId: string,
): Promise<ShareLinkResponse> {
  const results = await database.query<ShareLink>({
    text: `
        SELECT
          ${SHARE_LINK_COLUMNS}
        FROM
          share_links
        WHERE
          id = $1
          AND document_id = $2
        LIMIT
          1
        ;`,
    values: [id, documentId],
  });

  if (!results.rowCount) {
    throw new NotFoundError({
      message: "O link de compartilhamento informado não foi encontrado.",
      action: "Verifique se o identificador está correto.",
    });
  }

  return toResponse(results.rows[0]!, await getAllowedEmails(id));
}

// Free-plan workspaces are capped at the free tier's maxActiveLinks limit
// (counted across every document in the workspace, not just this one) —
// Pro/Business have no limit. Revoking a link frees up a slot, since only
// is_active = true links count.
async function assertWithinActiveLinkLimit(workspaceId: string): Promise<void> {
  const plan = await subscription.getPlanForWorkspace(workspaceId);
  const { maxActiveLinks } = subscription.PLAN_LIMITS[plan];

  if (maxActiveLinks === null) {
    return;
  }

  const results = await database.query<{ count: string }>({
    text: `
        SELECT
          COUNT(*)::text AS count
        FROM
          share_links sl
        JOIN
          documents d ON d.id = sl.document_id
        WHERE
          d.workspace_id = $1
          AND sl.is_active = true
        ;`,
    values: [workspaceId],
  });

  if (Number(results.rows[0]!.count) >= maxActiveLinks) {
    throw new PaymentRequiredError({
      message: `Limite de ${maxActiveLinks} links ativos do plano Free atingido.`,
      action: "Faça upgrade do workspace para o plano Pro para continuar.",
    });
  }
}

interface GatedFeatureInput {
  watermark_enabled?: boolean;
  nda_text?: string | null;
  allowed_emails?: string[] | null;
  brand_accent_color?: string | null;
  brand_welcome_message?: string | null;
}

// Only checks fields actually present in the input (undefined = not being
// touched — never gated, so editing an unrelated field on a link that
// already has e.g. watermark_enabled from a since-downgraded Pro period
// still succeeds). Turning a feature OFF (false/null/empty) is never
// gated either — only newly enabling one is.
function assertGatedFeaturesAllowed(
  plan: SubscriptionPlan,
  input: GatedFeatureInput,
): void {
  if (plan !== "free") {
    return;
  }

  function gated(message: string): never {
    throw new PaymentRequiredError({
      message,
      action: "Faça upgrade do workspace para o plano Pro para continuar.",
    });
  }

  if (input.watermark_enabled === true) {
    gated("Marca d'água é um recurso do plano Pro.");
  }

  if (
    input.nda_text !== undefined &&
    input.nda_text !== null &&
    input.nda_text.trim().length > 0
  ) {
    gated("Gate de NDA é um recurso do plano Pro.");
  }

  if (
    input.allowed_emails !== undefined &&
    input.allowed_emails !== null &&
    input.allowed_emails.length > 0
  ) {
    gated("Lista de emails permitidos é um recurso do plano Pro.");
  }

  if (
    (input.brand_accent_color !== undefined &&
      input.brand_accent_color !== null) ||
    (input.brand_welcome_message !== undefined &&
      input.brand_welcome_message !== null)
  ) {
    gated("Branding customizado é um recurso do plano Pro.");
  }
}

async function create(
  documentId: string,
  userId: string,
  input: ShareLinkCreateInput,
): Promise<ShareLinkResponse> {
  const workspaceId = await getDocumentWorkspaceId(documentId);
  await workspace.requireRole(workspaceId, userId, "editor");

  const plan = await subscription.getPlanForWorkspace(workspaceId);
  await assertWithinActiveLinkLimit(workspaceId);
  assertGatedFeaturesAllowed(plan, input);

  const id = crypto.randomUUID();
  const passwordHash = input.password
    ? await password.hash(input.password)
    : null;

  const results = await database.query<ShareLink>({
    text: `
        INSERT INTO
          share_links (
            id, document_id, user_id, label, password_hash,
            expires_at, allow_download, notify_on_view, require_email,
            watermark_enabled, nda_text, brand_accent_color,
            brand_welcome_message
          )
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING
          ${SHARE_LINK_COLUMNS}
        ;`,
    values: [
      id,
      documentId,
      userId,
      input.label ?? null,
      passwordHash,
      input.expires_at ?? null,
      input.allow_download ?? true,
      input.notify_on_view ?? true,
      input.require_email ?? false,
      input.watermark_enabled ?? false,
      input.nda_text ?? null,
      input.brand_accent_color ?? null,
      input.brand_welcome_message ?? null,
    ],
  });

  if (input.allowed_emails?.length) {
    await replaceAllowedEmails(id, input.allowed_emails);
  }

  return toResponse(results.rows[0]!, await getAllowedEmails(id));
}

async function findAllByDocumentId(
  documentId: string,
  userId: string,
): Promise<ShareLinkResponse[]> {
  const workspaceId = await getDocumentWorkspaceId(documentId);
  await workspace.requireRole(workspaceId, userId, "viewer");

  const results = await database.query<ShareLink>({
    text: `
        SELECT
          ${SHARE_LINK_COLUMNS}
        FROM
          share_links
        WHERE
          document_id = $1
        ORDER BY
          created_at DESC
        ;`,
    values: [documentId],
  });

  return Promise.all(
    results.rows.map(async (row) =>
      toResponse(row, await getAllowedEmails(row.id)),
    ),
  );
}

async function findAllByWorkspaceId(
  workspaceId: string,
  userId: string,
  pagination: PaginationParams,
): Promise<WorkspaceLinksResponse> {
  await workspace.requireRole(workspaceId, userId, "viewer");

  const [linksResult, countResult] = await Promise.all([
    database.query<WorkspaceLinkSummary>({
      text: `
          SELECT
            share_links.id, share_links.token, share_links.label,
            share_links.document_id, documents.title AS document_title,
            (
              SELECT COUNT(*)::int FROM link_views lv
              WHERE lv.share_link_id = share_links.id
            ) AS view_count,
            CASE
              WHEN share_links.is_active
                AND (
                  share_links.expires_at IS NULL
                  OR share_links.expires_at > now()
                )
                THEN 'active'
              ELSE 'expired'
            END AS status,
            share_links.created_at
          FROM
            share_links
          JOIN
            documents ON documents.id = share_links.document_id
          WHERE
            documents.workspace_id = $1
          ORDER BY
            share_links.created_at DESC
          LIMIT
            $2
          OFFSET
            $3
          ;`,
      values: [workspaceId, pagination.perPage, pagination.offset],
    }),
    database.query<{ count: string }>({
      text: `
          SELECT
            COUNT(*)::text AS count
          FROM
            share_links
          JOIN
            documents ON documents.id = share_links.document_id
          WHERE
            documents.workspace_id = $1
          ;`,
      values: [workspaceId],
    }),
  ]);

  return {
    links: linksResult.rows,
    total: Number(countResult.rows[0]!.count),
  };
}

async function findOneById(
  id: string,
  documentId: string,
  userId: string,
): Promise<ShareLinkResponse> {
  const workspaceId = await getDocumentWorkspaceId(documentId);
  await workspace.requireRole(workspaceId, userId, "viewer");

  return findLinkRow(id, documentId);
}

async function updateById(
  id: string,
  documentId: string,
  userId: string,
  input: ShareLinkUpdateInput,
): Promise<ShareLinkResponse> {
  const workspaceId = await getDocumentWorkspaceId(documentId);
  await workspace.requireRole(workspaceId, userId, "editor");
  await findLinkRow(id, documentId);

  const plan = await subscription.getPlanForWorkspace(workspaceId);
  assertGatedFeaturesAllowed(plan, input);

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

  if (input.allow_download !== undefined) {
    values.push(input.allow_download);
    setClauses.push(`allow_download = $${values.length}`);
  }

  if (input.is_active !== undefined) {
    values.push(input.is_active);
    setClauses.push(`is_active = $${values.length}`);
  }

  if (input.notify_on_view !== undefined) {
    values.push(input.notify_on_view);
    setClauses.push(`notify_on_view = $${values.length}`);
  }

  if (input.require_email !== undefined) {
    values.push(input.require_email);
    setClauses.push(`require_email = $${values.length}`);
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

  // allowed_emails lives in its own table (share_link_allowed_emails), so a
  // request that only touches it (e.g. clearing the allow-list with an
  // empty array) never adds a share_links column to update — skip the
  // UPDATE entirely rather than run one with an empty SET clause.
  if (setClauses.length === 0) {
    return findLinkRow(id, documentId);
  }

  values.push(id);

  const results = await database.query<ShareLink>({
    text: `
        UPDATE
          share_links
        SET
          ${setClauses.join(",\n          ")}
        WHERE
          id = $${values.length}
        RETURNING
          ${SHARE_LINK_COLUMNS}
        ;`,
    values,
  });

  return toResponse(results.rows[0]!, await getAllowedEmails(id));
}

async function revokeById(
  id: string,
  documentId: string,
  userId: string,
): Promise<ShareLinkResponse> {
  const workspaceId = await getDocumentWorkspaceId(documentId);
  await workspace.requireRole(workspaceId, userId, "editor");
  await findLinkRow(id, documentId);

  const results = await database.query<ShareLink>({
    text: `
        UPDATE
          share_links
        SET
          is_active = FALSE
        WHERE
          id = $1
        RETURNING
          ${SHARE_LINK_COLUMNS}
        ;`,
    values: [id],
  });

  return toResponse(results.rows[0]!, await getAllowedEmails(id));
}

async function fetchAndValidateTokenRow(
  token: string,
  providedPassword?: string,
  providedEmail?: string,
  providedName?: string,
): Promise<ShareLinkTokenRow> {
  const results = await database.query<ShareLinkTokenRow>({
    text: `
        SELECT
          sl.id AS link_id,
          sl.token,
          sl.label,
          sl.password_hash,
          sl.expires_at,
          sl.allow_download,
          sl.is_active,
          sl.require_email,
          sl.watermark_enabled,
          sl.nda_text,
          sl.brand_accent_color,
          sl.brand_welcome_message,
          EXISTS (
            SELECT 1 FROM share_link_allowed_emails a
            WHERE a.share_link_id = sl.id
          ) AS has_allow_list,
          EXISTS (
            SELECT 1 FROM share_link_allowed_emails a
            WHERE a.share_link_id = sl.id AND LOWER(a.email) = LOWER($2)
          ) AS email_is_allowed,
          sl.created_at AS link_created_at,
          d.id AS document_id,
          d.title,
          d.description,
          d.mime_type,
          d.size_bytes,
          d.page_count,
          d.storage_key,
          d.deleted_at AS document_deleted_at,
          -- The viewer chat needs the document's workspace creator's own
          -- Anthropic key (bring-your-own-key, resolved per-workspace since
          -- US-32 — not the uploader, who might be a different member of a
          -- shared workspace) — this tells the frontend whether to show the
          -- chat toggle at all, without exposing anything about the key
          -- itself.
          (creator.ai_api_key_encrypted IS NOT NULL) AS ai_chat_available
        FROM
          share_links sl
        JOIN
          documents d ON d.id = sl.document_id
        JOIN
          workspaces w ON w.id = d.workspace_id
        JOIN
          users creator ON creator.id = w.created_by
        WHERE
          sl.token = $1
        LIMIT
          1
        ;`,
    values: [token, providedEmail ?? ""],
  });

  if (!results.rowCount) {
    throw new NotFoundError({
      message: "O link de compartilhamento informado não foi encontrado.",
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

  // Checked after the password so a link with multiple gates gives the
  // viewer one thing to fix at a time instead of a single generic error.
  // An allow-list, an NDA, or an enabled watermark all imply an email is
  // required even if require_email itself is off — the owner shouldn't
  // have to flip multiple toggles for things that inherently need an
  // identity (the watermark to burn in, the allow-list to check against,
  // the NDA to record who agreed).
  const hasNda = !!row.nda_text && row.nda_text.trim().length > 0;
  const emailRequired =
    row.has_allow_list || hasNda || row.require_email || row.watermark_enabled;

  if (emailRequired && !(providedEmail && isValidEmail(providedEmail))) {
    // NDA takes priority when configured: its gate collects the email
    // itself (alongside the name and the "I accept" action), so a missing
    // email should surface the NDA text rather than a plain email prompt.
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
          "Este link só pode ser acessado por emails aprovados pelo proprietário do documento.",
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
        "Este link só pode ser acessado por emails aprovados pelo proprietário do documento.",
    });
  }

  if (hasNda && !providedName?.trim()) {
    throw new ForbiddenError({
      message: "Aceite os termos para continuar.",
      action: "Leia e aceite o termo de confidencialidade para continuar.",
    });
  }

  if (row.document_deleted_at) {
    throw new NotFoundError({
      message: "O documento deste link não está mais disponível.",
      action: "Solicite um novo link ao proprietário do documento.",
    });
  }

  return row;
}

async function getByToken(
  token: string,
  providedPassword?: string,
  providedEmail?: string,
  providedName?: string,
): Promise<ShareLinkWithDocument> {
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
    allow_download: row.allow_download,
    is_active: row.is_active,
    created_at: row.link_created_at,
    has_password: row.password_hash !== null,
    watermark_enabled: row.watermark_enabled,
    nda_text: row.nda_text,
    brand_accent_color: row.brand_accent_color,
    brand_welcome_message: row.brand_welcome_message,
    ai_chat_available: row.ai_chat_available,
    document: {
      id: row.document_id,
      title: row.title,
      description: row.description,
      mime_type: row.mime_type,
      size_bytes: row.size_bytes,
      page_count: row.page_count,
    },
  };
}

// Used only by the internal file-proxy route — storage_key is deliberately
// excluded from ShareLinkWithDocument (the public response shape above).
async function getFileByToken(
  token: string,
  providedPassword?: string,
  providedEmail?: string,
  providedName?: string,
): Promise<{ storage_key: string; mime_type: string }> {
  // Every prior gate (revoked, expired, password, email/allow-list, NDA,
  // deleted document) has already run and thrown in its existing order —
  // that ordering requirement (DL-04) is why this check lives here and not
  // inside fetchAndValidateTokenRow, which getByToken also uses.
  const row = await fetchAndValidateTokenRow(
    token,
    providedPassword,
    providedEmail,
    providedName,
  );

  if (!row.allow_download && row.mime_type !== PDF_MIME_TYPE) {
    await denyDownload(row, providedEmail, providedName);
  }

  return { storage_key: row.storage_key, mime_type: row.mime_type };
}

// Skips the password check: used by view-event recording, which happens
// after the viewer has already passed the password gate on the viewer page.
async function validateToken(token: string): Promise<{ id: string }> {
  const results = await database.query<{
    id: string;
    is_active: boolean;
    expires_at: Date | null;
  }>({
    text: `
        SELECT
          id, is_active, expires_at
        FROM
          share_links
        WHERE
          token = $1
        LIMIT
          1
        ;`,
    values: [token],
  });

  if (!results.rowCount) {
    throw new NotFoundError({
      message: "O link de compartilhamento informado não foi encontrado.",
      action: "Verifique se o link está correto.",
    });
  }

  const row = results.rows[0]!;

  assertLinkIsActiveAndNotExpired(row);

  return { id: row.id };
}

// Used to notify the document owner when a share link gets a new viewer.
async function getNotificationInfo(
  shareLinkId: string,
): Promise<ShareLinkNotificationInfo | null> {
  const results = await database.query<ShareLinkNotificationInfo>({
    text: `
        SELECT
          u.email AS owner_email,
          d.id AS document_id,
          d.title AS document_title,
          sl.label AS link_label,
          sl.notify_on_view
        FROM
          share_links sl
        JOIN
          documents d ON d.id = sl.document_id
        JOIN
          users u ON u.id = d.user_id
        WHERE
          sl.id = $1
        LIMIT
          1
        ;`,
    values: [shareLinkId],
  });

  return results.rows[0] ?? null;
}

// Used by the public viewer page's generateMetadata (crawlers/link
// unfurlers never have the password/email a gated link requires), so it
// deliberately skips the password/require_email/allow-list checks — only
// the document title/description are exposed, nothing sensitive. Returns
// null instead of throwing for a revoked/expired/deleted link, so the
// caller can fall back to generic metadata instead of erroring.
async function getPublicMetadata(
  token: string,
): Promise<{ title: string; description: string | null } | null> {
  const results = await database.query<{
    title: string;
    description: string | null;
    is_active: boolean;
    expires_at: Date | null;
    document_deleted_at: Date | null;
  }>({
    text: `
        SELECT
          d.title,
          d.description,
          sl.is_active,
          sl.expires_at,
          d.deleted_at AS document_deleted_at
        FROM
          share_links sl
        JOIN
          documents d ON d.id = sl.document_id
        WHERE
          sl.token = $1
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
    (row.expires_at && new Date(row.expires_at) < new Date()) ||
    row.document_deleted_at
  ) {
    return null;
  }

  return { title: row.title, description: row.description };
}

// The NDA text itself isn't sensitive — it's meant to be readable by any
// visitor with the link before they provide a password/email/name, same as
// getPublicMetadata's title/description. What's actually gated is the
// document, checked separately by fetchAndValidateTokenRow once the
// visitor submits the NDA form. Returns null (not an error) for a revoked/
// expired/deleted/nonexistent link, or one with no NDA configured.
async function getNdaText(token: string): Promise<string | null> {
  const results = await database.query<{
    nda_text: string | null;
    is_active: boolean;
    expires_at: Date | null;
    document_deleted_at: Date | null;
  }>({
    text: `
        SELECT
          sl.nda_text,
          sl.is_active,
          sl.expires_at,
          d.deleted_at AS document_deleted_at
        FROM
          share_links sl
        JOIN
          documents d ON d.id = sl.document_id
        WHERE
          sl.token = $1
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
    (row.expires_at && new Date(row.expires_at) < new Date()) ||
    row.document_deleted_at
  ) {
    return null;
  }

  return row.nda_text;
}

const shareLink: ShareLinkModel = {
  create,
  findAllByDocumentId,
  findAllByWorkspaceId,
  findOneById,
  updateById,
  revokeById,
  getByToken,
  getFileByToken,
  validateToken,
  getNotificationInfo,
  getPublicMetadata,
  getNdaText,
};

export default shareLink;
