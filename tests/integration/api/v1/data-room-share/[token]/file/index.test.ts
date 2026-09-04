import orchestrator from "tests/orchestrator";
import database from "infra/database";

const NON_PDF_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function setAllowDownload(
  cookie: string,
  roomId: string,
  documentId: string,
  allowDownload: boolean,
) {
  await fetch(`http://localhost:3000/api/v1/data-rooms/${roomId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      documents: [{ document_id: documentId, allow_download: allowDownload }],
    }),
  });
}

beforeAll(async () => {
  await orchestrator.waitForAllServices();
  await orchestrator.cleanDatabase();
  await orchestrator.runPendingMigrations();
});

describe("GET /api/v1/data-room-share/[token]/file", () => {
  test("With a nonexistent token", async () => {
    const response = await fetch(
      "http://localhost:3000/api/v1/data-room-share/00000000-0000-4000-8000-000000000000/file?document_id=00000000-0000-4000-8000-000000000000",
    );

    expect(response.status).toBe(404);
  });

  test("Missing document_id returns 400", async () => {
    const { cookie } = await orchestrator.createUserSession();
    const document = await orchestrator.uploadDocument(cookie);
    const room = await orchestrator.createDataRoom(
      cookie,
      document.workspace_id,
      {
        document_ids: [document.id],
      },
    );
    const link = await orchestrator.createDataRoomLink(cookie, room.id);

    const response = await fetch(
      `http://localhost:3000/api/v1/data-room-share/${link.token}/file`,
    );

    expect(response.status).toBe(400);
  });

  test("A document not in this room returns 404", async () => {
    const { cookie } = await orchestrator.createUserSession();
    const roomDocument = await orchestrator.uploadDocument(cookie);
    const otherDocument = await orchestrator.uploadDocument(cookie);
    const room = await orchestrator.createDataRoom(
      cookie,
      roomDocument.workspace_id,
      { document_ids: [roomDocument.id] },
    );
    const link = await orchestrator.createDataRoomLink(cookie, room.id);

    const response = await fetch(
      `http://localhost:3000/api/v1/data-room-share/${link.token}/file?document_id=${otherDocument.id}`,
    );

    expect(response.status).toBe(404);
  });

  test("Streams the document's bytes for a document that belongs to the room", async () => {
    const { cookie } = await orchestrator.createUserSession();
    const document = await orchestrator.uploadDocument(cookie);
    const room = await orchestrator.createDataRoom(
      cookie,
      document.workspace_id,
      {
        document_ids: [document.id],
      },
    );
    const link = await orchestrator.createDataRoomLink(cookie, room.id);

    const response = await fetch(
      `http://localhost:3000/api/v1/data-room-share/${link.token}/file?document_id=${document.id}`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");

    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(0);
  });

  test("With a password set, requires the correct password", async () => {
    const { cookie } = await orchestrator.createUserSession();
    const document = await orchestrator.uploadDocument(cookie);
    const room = await orchestrator.createDataRoom(
      cookie,
      document.workspace_id,
      {
        document_ids: [document.id],
      },
    );
    const link = await orchestrator.createDataRoomLink(cookie, room.id, {
      password: "secret123",
    });

    const withoutPassword = await fetch(
      `http://localhost:3000/api/v1/data-room-share/${link.token}/file?document_id=${document.id}`,
    );
    expect(withoutPassword.status).toBe(403);

    const withCorrectPassword = await fetch(
      `http://localhost:3000/api/v1/data-room-share/${link.token}/file?document_id=${document.id}`,
      { headers: { "X-Share-Password": "secret123" } },
    );
    expect(withCorrectPassword.status).toBe(200);
  });

  test("A revoked link returns 403", async () => {
    const { cookie } = await orchestrator.createUserSession();
    const document = await orchestrator.uploadDocument(cookie);
    const room = await orchestrator.createDataRoom(
      cookie,
      document.workspace_id,
      {
        document_ids: [document.id],
      },
    );
    const link = await orchestrator.createDataRoomLink(cookie, room.id);

    await fetch(
      `http://localhost:3000/api/v1/data-rooms/${room.id}/links/${link.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ is_active: false }),
      },
    );

    const response = await fetch(
      `http://localhost:3000/api/v1/data-room-share/${link.token}/file?document_id=${document.id}`,
    );

    expect(response.status).toBe(403);
  });

  test("A non-PDF document with allow_download false returns 403 with no file bytes", async () => {
    const { cookie } = await orchestrator.createUserSession();
    const document = await orchestrator.uploadDocument(cookie, {
      mimeType: NON_PDF_MIME_TYPE,
      filename: "a.docx",
      buffer: Buffer.from("fake docx bytes"),
    });

    expect(document.mime_type).not.toBe("application/pdf");

    const room = await orchestrator.createDataRoom(
      cookie,
      document.workspace_id,
      { document_ids: [document.id] },
    );
    const link = await orchestrator.createDataRoomLink(cookie, room.id);
    await setAllowDownload(cookie, room.id, document.id, false);

    const response = await fetch(
      `http://localhost:3000/api/v1/data-room-share/${link.token}/file?document_id=${document.id}`,
    );

    expect(response.status).toBe(403);

    const responseBody = await response.json();
    expect(responseBody).toEqual({
      name: "ForbiddenError",
      message: "O download deste arquivo não está habilitado para este link.",
      action:
        "Peça ao proprietário da data room para habilitar o download, se necessário.",
      status: 403,
    });
  });

  test("A non-PDF document with allow_download true returns 200 with the file bytes", async () => {
    const { cookie } = await orchestrator.createUserSession();
    const document = await orchestrator.uploadDocument(cookie, {
      mimeType: NON_PDF_MIME_TYPE,
      filename: "a.docx",
      buffer: Buffer.from("fake docx bytes"),
    });
    const room = await orchestrator.createDataRoom(
      cookie,
      document.workspace_id,
      { document_ids: [document.id] },
    );
    const link = await orchestrator.createDataRoomLink(cookie, room.id);

    const response = await fetch(
      `http://localhost:3000/api/v1/data-room-share/${link.token}/file?document_id=${document.id}`,
    );

    expect(response.status).toBe(200);

    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.toString()).toBe("fake docx bytes");
  });

  test("A PDF document with allow_download false still returns 200 with the file bytes", async () => {
    const { cookie } = await orchestrator.createUserSession();
    const document = await orchestrator.uploadDocument(cookie);

    expect(document.mime_type).toBe("application/pdf");

    const room = await orchestrator.createDataRoom(
      cookie,
      document.workspace_id,
      { document_ids: [document.id] },
    );
    const link = await orchestrator.createDataRoomLink(cookie, room.id);
    await setAllowDownload(cookie, room.id, document.id, false);

    const response = await fetch(
      `http://localhost:3000/api/v1/data-room-share/${link.token}/file?document_id=${document.id}`,
    );

    expect(response.status).toBe(200);

    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(0);
  });

  test("A blocked data-room download attempt does not write a blocked_download_attempts row", async () => {
    const { cookie } = await orchestrator.createUserSession();
    const document = await orchestrator.uploadDocument(cookie, {
      mimeType: NON_PDF_MIME_TYPE,
      filename: "a.docx",
      buffer: Buffer.from("fake docx bytes"),
    });
    const room = await orchestrator.createDataRoom(
      cookie,
      document.workspace_id,
      { document_ids: [document.id] },
    );
    const link = await orchestrator.createDataRoomLink(cookie, room.id);
    await setAllowDownload(cookie, room.id, document.id, false);

    const before = await database.query<{ count: string }>({
      text: "SELECT COUNT(*)::text AS count FROM blocked_download_attempts;",
    });

    const response = await fetch(
      `http://localhost:3000/api/v1/data-room-share/${link.token}/file?document_id=${document.id}`,
    );
    expect(response.status).toBe(403);

    const after = await database.query<{ count: string }>({
      text: "SELECT COUNT(*)::text AS count FROM blocked_download_attempts;",
    });

    expect(after.rows[0]!.count).toBe(before.rows[0]!.count);
  });
});
