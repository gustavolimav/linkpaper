import orchestrator from "tests/orchestrator";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
  await orchestrator.cleanDatabase();
  await orchestrator.runPendingMigrations();
});

describe("POST /api/v1/data-room-share/[token]/view", () => {
  test("Records a view for a document in the room", async () => {
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

    const view = await orchestrator.recordDataRoomView(link.token, {
      document_id: document.id,
      viewer_fingerprint: "fingerprint-1",
    });

    expect(view.document_id).toBe(document.id);
    expect(view.data_room_link_id).toBe(link.id);
    expect(view.is_new_viewer).toBe(true);
  });

  test("A second view from the same fingerprint within 30 minutes is deduped", async () => {
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

    const first = await orchestrator.recordDataRoomView(link.token, {
      document_id: document.id,
      viewer_fingerprint: "fingerprint-2",
      time_on_page: 10,
    });
    const second = await orchestrator.recordDataRoomView(link.token, {
      document_id: document.id,
      viewer_fingerprint: "fingerprint-2",
      time_on_page: 20,
    });

    expect(second.id).toBe(first.id);
    expect(second.time_on_page).toBe(20);
    expect(second.is_new_viewer).toBe(false);
  });

  test("Views of two different documents in the same room don't dedup together", async () => {
    const { cookie } = await orchestrator.createUserSession();
    const document1 = await orchestrator.uploadDocument(cookie);
    const document2 = await orchestrator.uploadDocument(cookie);
    const room = await orchestrator.createDataRoom(
      cookie,
      document1.workspace_id,
      {
        document_ids: [document1.id, document2.id],
      },
    );
    const link = await orchestrator.createDataRoomLink(cookie, room.id);

    await orchestrator.recordDataRoomView(link.token, {
      document_id: document1.id,
      viewer_fingerprint: "fingerprint-3",
    });
    await orchestrator.recordDataRoomView(link.token, {
      document_id: document2.id,
      viewer_fingerprint: "fingerprint-3",
    });

    const roomDetail = await (
      await fetch(`http://localhost:3000/api/v1/data-rooms/${room.id}`, {
        headers: { Cookie: cookie },
      })
    ).json();

    const doc1 = roomDetail.documents.find(
      (d: any) => d.document_id === document1.id,
    );
    const doc2 = roomDetail.documents.find(
      (d: any) => d.document_id === document2.id,
    );

    expect(doc1.view_count).toBe(1);
    expect(doc2.view_count).toBe(1);
  });

  test("With a nonexistent token", async () => {
    const response = await fetch(
      "http://localhost:3000/api/v1/data-room-share/00000000-0000-4000-8000-000000000000/view",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document_id: "00000000-0000-4000-8000-000000000000",
        }),
      },
    );

    expect(response.status).toBe(404);
  });
});
