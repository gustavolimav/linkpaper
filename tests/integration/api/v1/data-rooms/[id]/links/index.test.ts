import orchestrator from "tests/orchestrator";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
  await orchestrator.cleanDatabase();
  await orchestrator.runPendingMigrations();
});

describe("GET /api/v1/data-rooms/[id]/links", () => {
  test("Without a session", async () => {
    const response = await fetch(
      "http://localhost:3000/api/v1/data-rooms/00000000-0000-4000-8000-000000000000/links",
    );

    expect(response.status).toBe(401);
  });

  test("Lists a room's links", async () => {
    const { cookie } = await orchestrator.createUserSession();
    const document = await orchestrator.uploadDocument(cookie);
    const room = await orchestrator.createDataRoom(
      cookie,
      document.workspace_id,
      {
        document_ids: [document.id],
      },
    );

    await orchestrator.createDataRoomLink(cookie, room.id, {
      label: "Investor link",
    });

    const response = await fetch(
      `http://localhost:3000/api/v1/data-rooms/${room.id}/links`,
      { headers: { Cookie: cookie } },
    );

    expect(response.status).toBe(200);

    const responseBody = await response.json();

    expect(responseBody).toHaveLength(1);
    expect(responseBody[0]).toMatchObject({
      label: "Investor link",
      is_active: true,
      has_password: false,
    });
    expect(responseBody[0].token).toBeDefined();
  });
});

describe("POST /api/v1/data-rooms/[id]/links", () => {
  test("Without a session", async () => {
    const response = await fetch(
      "http://localhost:3000/api/v1/data-rooms/00000000-0000-4000-8000-000000000000/links",
      { method: "POST" },
    );

    expect(response.status).toBe(401);
  });

  test("As a non-member of the workspace", async () => {
    const { cookie: ownerCookie } = await orchestrator.createUserSession();
    const { cookie: strangerCookie } = await orchestrator.createUserSession();

    const document = await orchestrator.uploadDocument(ownerCookie);
    const room = await orchestrator.createDataRoom(
      ownerCookie,
      document.workspace_id,
      { document_ids: [document.id] },
    );

    const response = await fetch(
      `http://localhost:3000/api/v1/data-rooms/${room.id}/links`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: strangerCookie,
        },
        body: JSON.stringify({}),
      },
    );

    expect(response.status).toBe(404);
  });

  test("Creates a link with a password", async () => {
    const { cookie } = await orchestrator.createUserSession();
    const document = await orchestrator.uploadDocument(cookie);
    const room = await orchestrator.createDataRoom(
      cookie,
      document.workspace_id,
      {
        document_ids: [document.id],
      },
    );

    const response = await fetch(
      `http://localhost:3000/api/v1/data-rooms/${room.id}/links`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ password: "secret123" }),
      },
    );

    expect(response.status).toBe(201);

    const responseBody = await response.json();

    expect(responseBody.has_password).toBe(true);
  });

  test("Creates a link with the full set of gating fields", async () => {
    const { cookie } = await orchestrator.createUserSession();
    const document = await orchestrator.uploadDocument(cookie);
    const room = await orchestrator.createDataRoom(
      cookie,
      document.workspace_id,
      { document_ids: [document.id] },
    );

    const response = await fetch(
      `http://localhost:3000/api/v1/data-rooms/${room.id}/links`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          require_email: true,
          allowed_emails: ["a@example.com", "b@example.com"],
          notify_on_view: false,
          watermark_enabled: true,
          nda_text: "Termo de confidencialidade.",
          brand_accent_color: "#123456",
          brand_welcome_message: "Bem-vindo!",
        }),
      },
    );

    expect(response.status).toBe(201);

    const responseBody = await response.json();

    expect(responseBody.require_email).toBe(true);
    expect(responseBody.allowed_emails).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
    expect(responseBody.notify_on_view).toBe(false);
    expect(responseBody.watermark_enabled).toBe(true);
    expect(responseBody.nda_text).toBe("Termo de confidencialidade.");
    expect(responseBody.brand_accent_color).toBe("#123456");
    expect(responseBody.brand_welcome_message).toBe("Bem-vindo!");
  });

  test("notify_on_view defaults to true", async () => {
    const { cookie } = await orchestrator.createUserSession();
    const document = await orchestrator.uploadDocument(cookie);
    const room = await orchestrator.createDataRoom(
      cookie,
      document.workspace_id,
      { document_ids: [document.id] },
    );

    const link = await orchestrator.createDataRoomLink(cookie, room.id);

    expect(link.notify_on_view).toBe(true);
    expect(link.require_email).toBe(false);
    expect(link.watermark_enabled).toBe(false);
  });
});

describe("PATCH /api/v1/data-rooms/[id]/links/[linkId]", () => {
  test("Revokes the link", async () => {
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
      `http://localhost:3000/api/v1/data-rooms/${room.id}/links/${link.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ is_active: false }),
      },
    );

    expect(response.status).toBe(200);

    const responseBody = await response.json();

    expect(responseBody.is_active).toBe(false);
  });

  test("Updating label/password/expires_at", async () => {
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
      `http://localhost:3000/api/v1/data-rooms/${room.id}/links/${link.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ label: "Updated label", password: "newpass1" }),
      },
    );

    expect(response.status).toBe(200);

    const responseBody = await response.json();

    expect(responseBody.label).toBe("Updated label");
    expect(responseBody.has_password).toBe(true);
  });

  test("Setting allowed_emails then clearing with an empty array", async () => {
    const { cookie } = await orchestrator.createUserSession();
    const document = await orchestrator.uploadDocument(cookie);
    const room = await orchestrator.createDataRoom(
      cookie,
      document.workspace_id,
      { document_ids: [document.id] },
    );
    const link = await orchestrator.createDataRoomLink(cookie, room.id, {
      allowed_emails: ["a@example.com"],
    });

    const clearResponse = await fetch(
      `http://localhost:3000/api/v1/data-rooms/${room.id}/links/${link.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ allowed_emails: [] }),
      },
    );

    expect(clearResponse.status).toBe(200);

    const responseBody = await clearResponse.json();
    expect(responseBody.allowed_emails).toEqual([]);
  });

  test("Updating watermark_enabled/nda_text/brand fields", async () => {
    const { cookie } = await orchestrator.createUserSession();
    const document = await orchestrator.uploadDocument(cookie);
    const room = await orchestrator.createDataRoom(
      cookie,
      document.workspace_id,
      { document_ids: [document.id] },
    );
    const link = await orchestrator.createDataRoomLink(cookie, room.id);

    const response = await fetch(
      `http://localhost:3000/api/v1/data-rooms/${room.id}/links/${link.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          watermark_enabled: true,
          nda_text: "Novo termo.",
          brand_accent_color: "#abcdef",
        }),
      },
    );

    expect(response.status).toBe(200);

    const responseBody = await response.json();
    expect(responseBody.watermark_enabled).toBe(true);
    expect(responseBody.nda_text).toBe("Novo termo.");
    expect(responseBody.brand_accent_color).toBe("#abcdef");
  });
});
