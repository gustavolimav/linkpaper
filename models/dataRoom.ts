import database from "../infra/database";
import { NotFoundError, ValidationError } from "../infra/errors";
import workspace from "./workspace";
import dataRoomLinkView from "./dataRoomLinkView";
import type {
  DataRoom,
  DataRoomResponse,
  DataRoomDocumentWithStats,
  DataRoomCreateInput,
  DataRoomUpdateInput,
  DataRoomSummary,
  DataRoomListResponse,
  DataRoomModel,
  PaginationParams,
} from "../types/index";

// Existence + soft-delete check only — every caller does its own
// requireRole() first, same split as the document-workspace lookup and
// link-row lookup helpers in shareLink.ts.
async function findRoomRaw(id: string): Promise<DataRoom> {
  const results = await database.query<DataRoom>({
    text: `
        SELECT
          id, workspace_id, name, created_by, created_at, updated_at, deleted_at
        FROM
          data_rooms
        WHERE
          id = $1
          AND deleted_at IS NULL
        ;`,
    values: [id],
  });

  const room = results.rows[0];

  if (!room) {
    throw new NotFoundError({
      message: "A data room informada não foi encontrada.",
      action: "Verifique se o identificador está correto.",
    });
  }

  return room;
}

// Owner-facing only — attaches each document's view_count/last_viewed_at
// (US-56), aggregated across every link of this room. The public
// data-room-share routes use dataRoomLink.ts's own getRoomDocuments
// instead, which never exposes view stats to a visitor.
async function getDocuments(
  dataRoomId: string,
): Promise<DataRoomDocumentWithStats[]> {
  const [results, stats] = await Promise.all([
    database.query<
      Omit<DataRoomDocumentWithStats, "view_count" | "last_viewed_at">
    >({
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
    }),
    dataRoomLinkView.getStatsByDataRoomId(dataRoomId),
  ]);

  return results.rows.map((row) => ({
    ...row,
    view_count: stats.get(row.document_id)?.view_count ?? 0,
    last_viewed_at: stats.get(row.document_id)?.last_viewed_at ?? null,
  }));
}

// Every document_id must exist, not be soft-deleted, and belong to the
// same workspace as the room — otherwise a member of workspace A could
// smuggle a workspace B document into one of their rooms.
async function assertDocumentsBelongToWorkspace(
  documentIds: string[],
  workspaceId: string,
): Promise<void> {
  const results = await database.query<{ count: string }>({
    text: `
        SELECT
          COUNT(*)::text AS count
        FROM
          documents
        WHERE
          id = ANY($1::uuid[])
          AND workspace_id = $2
          AND deleted_at IS NULL
        ;`,
    values: [documentIds, workspaceId],
  });

  if (Number(results.rows[0]!.count) !== documentIds.length) {
    throw new ValidationError({
      message: "Um ou mais documentos informados não foram encontrados.",
      action: "Verifique se todos os documentos pertencem a este workspace.",
    });
  }
}

async function replaceDocuments(
  dataRoomId: string,
  documents: { document_id: string; allow_download: boolean }[],
): Promise<void> {
  const client = await database.getNewClient();

  try {
    await client.query("BEGIN");

    await client.query({
      text: "DELETE FROM data_room_documents WHERE data_room_id = $1;",
      values: [dataRoomId],
    });

    for (const doc of documents) {
      await client.query({
        text: `
            INSERT INTO
              data_room_documents (data_room_id, document_id, allow_download)
            VALUES
              ($1, $2, $3)
            ;`,
        values: [dataRoomId, doc.document_id, doc.allow_download],
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

async function toResponse(room: DataRoom): Promise<DataRoomResponse> {
  return {
    id: room.id,
    workspace_id: room.workspace_id,
    name: room.name,
    created_at: room.created_at,
    updated_at: room.updated_at,
    documents: await getDocuments(room.id),
  };
}

async function create(
  workspaceId: string,
  userId: string,
  input: DataRoomCreateInput,
): Promise<DataRoomResponse> {
  await workspace.requireRole(workspaceId, userId, "editor");
  await assertDocumentsBelongToWorkspace(input.document_ids, workspaceId);

  const results = await database.query<DataRoom>({
    text: `
        INSERT INTO
          data_rooms (workspace_id, name, created_by)
        VALUES
          ($1, $2, $3)
        RETURNING
          id, workspace_id, name, created_by, created_at, updated_at, deleted_at
        ;`,
    values: [workspaceId, input.name, userId],
  });

  const room = results.rows[0]!;

  await replaceDocuments(
    room.id,
    input.document_ids.map((documentId) => ({
      document_id: documentId,
      allow_download: true,
    })),
  );

  return toResponse(room);
}

async function findAllByWorkspaceId(
  workspaceId: string,
  userId: string,
  pagination: PaginationParams,
): Promise<DataRoomListResponse> {
  await workspace.requireRole(workspaceId, userId, "viewer");

  const [roomsResult, countResult] = await Promise.all([
    database.query<DataRoomSummary>({
      text: `
          SELECT
            data_rooms.id,
            data_rooms.name,
            (
              SELECT COUNT(*)::int FROM data_room_documents drd
              WHERE drd.data_room_id = data_rooms.id
            ) AS document_count,
            data_rooms.created_at
          FROM
            data_rooms
          WHERE
            data_rooms.workspace_id = $1
            AND data_rooms.deleted_at IS NULL
          ORDER BY
            data_rooms.created_at DESC
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
            data_rooms
          WHERE
            workspace_id = $1
            AND deleted_at IS NULL
          ;`,
      values: [workspaceId],
    }),
  ]);

  return {
    data_rooms: roomsResult.rows,
    total: Number(countResult.rows[0]!.count),
  };
}

async function findOneById(
  id: string,
  userId: string,
): Promise<DataRoomResponse> {
  const room = await findRoomRaw(id);
  await workspace.requireRole(room.workspace_id, userId, "viewer");

  return toResponse(room);
}

async function updateById(
  id: string,
  userId: string,
  input: DataRoomUpdateInput,
): Promise<DataRoomResponse> {
  const room = await findRoomRaw(id);
  await workspace.requireRole(room.workspace_id, userId, "editor");

  if (input.documents) {
    await assertDocumentsBelongToWorkspace(
      input.documents.map((d) => d.document_id),
      room.workspace_id,
    );
    await replaceDocuments(id, input.documents);
  }

  if (input.name === undefined) {
    return toResponse(await findRoomRaw(id));
  }

  const results = await database.query<DataRoom>({
    text: `
        UPDATE
          data_rooms
        SET
          name = $1
        WHERE
          id = $2
        RETURNING
          id, workspace_id, name, created_by, created_at, updated_at, deleted_at
        ;`,
    values: [input.name, id],
  });

  return toResponse(results.rows[0]!);
}

async function deleteById(id: string, userId: string): Promise<void> {
  const room = await findRoomRaw(id);
  await workspace.requireRole(room.workspace_id, userId, "editor");

  await database.query({
    text: `
        UPDATE
          data_rooms
        SET
          deleted_at = NOW()
        WHERE
          id = $1
        ;`,
    values: [id],
  });
}

const dataRoom: DataRoomModel = {
  create,
  findAllByWorkspaceId,
  findOneById,
  updateById,
  deleteById,
};

export default dataRoom;
