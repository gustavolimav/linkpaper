import orchestrator from "tests/orchestrator";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
  await orchestrator.cleanDatabase();
  await orchestrator.runPendingMigrations();
});

describe("POST /api/v1/data-room-share/[token]/chat", () => {
  test("With a document not in the room, returns 400", async () => {
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
      `http://localhost:3000/api/v1/data-room-share/${link.token}/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: "O que diz este documento?",
          document_id: otherDocument.id,
        }),
      },
    );

    expect(response.status).toBe(400);
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
      `http://localhost:3000/api/v1/data-room-share/${link.token}/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: "O que diz este documento?" }),
      },
    );

    expect(response.status).toBe(400);
  });

  test("With no AI key configured for the workspace creator, returns 503", async () => {
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
      `http://localhost:3000/api/v1/data-room-share/${link.token}/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: "O que diz este documento?",
          document_id: document.id,
        }),
      },
    );

    expect(response.status).toBe(503);
  });

  test("With a revoked link, returns 403", async () => {
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
      `http://localhost:3000/api/v1/data-room-share/${link.token}/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: "O que diz este documento?",
          document_id: document.id,
        }),
      },
    );

    expect(response.status).toBe(403);
  });
});
