import orchestrator from "tests/orchestrator";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
  await orchestrator.cleanDatabase();
  await orchestrator.runPendingMigrations();
});

describe("GET /api/v1/share/[token]", () => {
  test("With a nonexistent token", async () => {
    const response = await fetch(
      "http://localhost:3000/api/v1/share/00000000-0000-4000-8000-000000000000",
    );

    expect(response.status).toBe(404);
  });

  test("With a revoked link", async () => {
    const { cookie } = await orchestrator.createUserSession();
    const document = await orchestrator.uploadDocument(cookie);
    const link = await orchestrator.createShareLink(cookie, document.id);

    await fetch(
      `http://localhost:3000/api/v1/documents/${document.id}/links/${link.id}`,
      { method: "DELETE", headers: { Cookie: cookie } },
    );

    const response = await fetch(
      `http://localhost:3000/api/v1/share/${link.token}`,
    );

    expect(response.status).toBe(403);

    const responseBody = await response.json();
    expect(responseBody.message).toBe("Este link foi revogado.");
  });

  test("With an expired link", async () => {
    const { cookie } = await orchestrator.createUserSession();
    const document = await orchestrator.uploadDocument(cookie);
    const link = await orchestrator.createShareLink(cookie, document.id, {
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    await orchestrator.expireShareLink(link.id);

    const response = await fetch(
      `http://localhost:3000/api/v1/share/${link.token}`,
    );

    expect(response.status).toBe(403);

    const responseBody = await response.json();
    expect(responseBody.message).toBe("Este link expirou.");
  });

  test("With no password set", async () => {
    const { cookie } = await orchestrator.createUserSession();
    const document = await orchestrator.uploadDocument(cookie, {
      title: "Public doc",
    });
    const link = await orchestrator.createShareLink(cookie, document.id, {
      allow_download: false,
    });

    const response = await fetch(
      `http://localhost:3000/api/v1/share/${link.token}`,
    );

    expect(response.status).toBe(200);

    const responseBody = await response.json();

    expect(responseBody).toEqual({
      id: link.id,
      token: link.token,
      label: null,
      expires_at: null,
      allow_download: false,
      is_active: true,
      created_at: responseBody.created_at,
      has_password: false,
      watermark_enabled: false,
      nda_text: null,
      brand_accent_color: null,
      brand_welcome_message: null,
      ai_chat_available: false,
      document: {
        id: document.id,
        title: "Public doc",
        description: null,
        mime_type: document.mime_type,
        size_bytes: document.size_bytes,
        page_count: document.page_count,
      },
    });
  });

  // Regression pin (design.md's Risks table, row 1): the allow_download
  // guard added to getFileByToken (models/shareLink.ts) must never migrate
  // into fetchAndValidateTokenRow, the validator this metadata endpoint
  // shares with the file endpoint — that would 403 the viewer page itself
  // for every non-PDF, view-only link instead of just the file download.
  test("A non-PDF, allow_download: false link still returns 200 (allow_download is not enforced here)", async () => {
    const { cookie } = await orchestrator.createUserSession();
    const document = await orchestrator.uploadDocument(cookie, {
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      filename: "a.docx",
      buffer: Buffer.from("fake docx bytes"),
    });

    expect(document.mime_type).not.toBe("application/pdf");

    const link = await orchestrator.createShareLink(cookie, document.id, {
      allow_download: false,
    });

    const response = await fetch(
      `http://localhost:3000/api/v1/share/${link.token}`,
    );

    expect(response.status).toBe(200);

    const responseBody = await response.json();
    expect(responseBody.document.mime_type).toBe(document.mime_type);
  });

  test("With an AI key configured by the document owner", async () => {
    const { user, cookie } = await orchestrator.createUserSession();
    await fetch(`http://localhost:3000/api/v1/users/${user.username}/ai-key`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ api_key: "sk-ant-api03-fake-key-value-here" }),
    });
    const document = await orchestrator.uploadDocument(cookie);
    const link = await orchestrator.createShareLink(cookie, document.id);

    const response = await fetch(
      `http://localhost:3000/api/v1/share/${link.token}`,
    );

    const responseBody = await response.json();
    expect(responseBody.ai_chat_available).toBe(true);
  });

  test("With a password set, no password provided", async () => {
    const { cookie } = await orchestrator.createUserSession();
    const document = await orchestrator.uploadDocument(cookie);
    const link = await orchestrator.createShareLink(cookie, document.id, {
      password: "secret123",
    });

    const response = await fetch(
      `http://localhost:3000/api/v1/share/${link.token}`,
    );

    expect(response.status).toBe(403);

    const responseBody = await response.json();
    expect(responseBody.message).toBe("Senha incorreta.");
  });

  test("With a password set, wrong password provided", async () => {
    const { cookie } = await orchestrator.createUserSession();
    const document = await orchestrator.uploadDocument(cookie);
    const link = await orchestrator.createShareLink(cookie, document.id, {
      password: "secret123",
    });

    const response = await fetch(
      `http://localhost:3000/api/v1/share/${link.token}`,
      { headers: { "X-Share-Password": "wrongpassword" } },
    );

    expect(response.status).toBe(403);

    const responseBody = await response.json();
    expect(responseBody.message).toBe("Senha incorreta.");
  });

  test("With a password set, correct password provided via header", async () => {
    const { cookie } = await orchestrator.createUserSession();
    const document = await orchestrator.uploadDocument(cookie);
    const link = await orchestrator.createShareLink(cookie, document.id, {
      password: "secret123",
    });

    const response = await fetch(
      `http://localhost:3000/api/v1/share/${link.token}`,
      { headers: { "X-Share-Password": "secret123" } },
    );

    expect(response.status).toBe(200);

    const responseBody = await response.json();
    expect(responseBody.has_password).toBe(true);
  });

  test("With a password set, password provided only via query param is ignored", async () => {
    const { cookie } = await orchestrator.createUserSession();
    const document = await orchestrator.uploadDocument(cookie);
    const link = await orchestrator.createShareLink(cookie, document.id, {
      password: "secret123",
    });

    const response = await fetch(
      `http://localhost:3000/api/v1/share/${link.token}?password=secret123`,
    );

    expect(response.status).toBe(403);
  });

  test("With require_email enabled, no email provided", async () => {
    const { cookie } = await orchestrator.createUserSession();
    const document = await orchestrator.uploadDocument(cookie);
    const link = await orchestrator.createShareLink(cookie, document.id, {
      require_email: true,
    });

    const response = await fetch(
      `http://localhost:3000/api/v1/share/${link.token}`,
    );

    expect(response.status).toBe(403);

    const responseBody = await response.json();
    expect(responseBody.message).toBe("Email obrigatório.");
  });

  test("With require_email enabled, invalid email provided", async () => {
    const { cookie } = await orchestrator.createUserSession();
    const document = await orchestrator.uploadDocument(cookie);
    const link = await orchestrator.createShareLink(cookie, document.id, {
      require_email: true,
    });

    const response = await fetch(
      `http://localhost:3000/api/v1/share/${link.token}`,
      { headers: { "X-Viewer-Email": "not-an-email" } },
    );

    expect(response.status).toBe(403);

    const responseBody = await response.json();
    expect(responseBody.message).toBe("Email obrigatório.");
  });

  test("With require_email enabled, valid email provided", async () => {
    const { cookie } = await orchestrator.createUserSession();
    const document = await orchestrator.uploadDocument(cookie);
    const link = await orchestrator.createShareLink(cookie, document.id, {
      require_email: true,
    });

    const response = await fetch(
      `http://localhost:3000/api/v1/share/${link.token}`,
      { headers: { "X-Viewer-Email": "viewer@example.com" } },
    );

    expect(response.status).toBe(200);
  });

  test("With require_email and a password both enabled, password takes priority", async () => {
    const { cookie } = await orchestrator.createUserSession();
    const document = await orchestrator.uploadDocument(cookie);
    const link = await orchestrator.createShareLink(cookie, document.id, {
      password: "secret123",
      require_email: true,
    });

    const withEmailOnly = await fetch(
      `http://localhost:3000/api/v1/share/${link.token}`,
      { headers: { "X-Viewer-Email": "viewer@example.com" } },
    );

    expect(withEmailOnly.status).toBe(403);
    expect((await withEmailOnly.json()).message).toBe("Senha incorreta.");

    const withBoth = await fetch(
      `http://localhost:3000/api/v1/share/${link.token}`,
      {
        headers: {
          "X-Share-Password": "secret123",
          "X-Viewer-Email": "viewer@example.com",
        },
      },
    );

    expect(withBoth.status).toBe(200);
  });

  test("With an allow-list, no email provided", async () => {
    const { user, cookie } = await orchestrator.createUserSession();
    await orchestrator.activateSubscription(user.active_workspace_id!);
    const document = await orchestrator.uploadDocument(cookie);
    const link = await orchestrator.createShareLink(cookie, document.id, {
      allowed_emails: ["approved@example.com"],
    });

    const response = await fetch(
      `http://localhost:3000/api/v1/share/${link.token}`,
    );

    expect(response.status).toBe(403);

    const responseBody = await response.json();
    expect(responseBody.message).toBe("Email não autorizado.");
  });

  test("With an allow-list, an email not on the list", async () => {
    const { user, cookie } = await orchestrator.createUserSession();
    await orchestrator.activateSubscription(user.active_workspace_id!);
    const document = await orchestrator.uploadDocument(cookie);
    const link = await orchestrator.createShareLink(cookie, document.id, {
      allowed_emails: ["approved@example.com"],
    });

    const response = await fetch(
      `http://localhost:3000/api/v1/share/${link.token}`,
      { headers: { "X-Viewer-Email": "notapproved@example.com" } },
    );

    expect(response.status).toBe(403);

    const responseBody = await response.json();
    expect(responseBody.message).toBe("Email não autorizado.");
  });

  test("With an allow-list, the approved email (case-insensitive)", async () => {
    const { user, cookie } = await orchestrator.createUserSession();
    await orchestrator.activateSubscription(user.active_workspace_id!);
    const document = await orchestrator.uploadDocument(cookie);
    const link = await orchestrator.createShareLink(cookie, document.id, {
      allowed_emails: ["Approved@Example.com"],
    });

    const response = await fetch(
      `http://localhost:3000/api/v1/share/${link.token}`,
      { headers: { "X-Viewer-Email": "approved@example.com" } },
    );

    expect(response.status).toBe(200);
  });

  test("With an allow-list but require_email off, email is still required", async () => {
    const { user, cookie } = await orchestrator.createUserSession();
    await orchestrator.activateSubscription(user.active_workspace_id!);
    const document = await orchestrator.uploadDocument(cookie);
    const link = await orchestrator.createShareLink(cookie, document.id, {
      allowed_emails: ["approved@example.com"],
      require_email: false,
    });

    const response = await fetch(
      `http://localhost:3000/api/v1/share/${link.token}`,
    );

    expect(response.status).toBe(403);
    expect((await response.json()).message).toBe("Email não autorizado.");
  });

  test("With watermark_enabled, no email provided", async () => {
    const { user, cookie } = await orchestrator.createUserSession();
    await orchestrator.activateSubscription(user.active_workspace_id!);
    const document = await orchestrator.uploadDocument(cookie);
    const link = await orchestrator.createShareLink(cookie, document.id, {
      watermark_enabled: true,
    });

    const response = await fetch(
      `http://localhost:3000/api/v1/share/${link.token}`,
    );

    expect(response.status).toBe(403);

    const responseBody = await response.json();
    expect(responseBody.message).toBe("Email obrigatório.");
  });

  test("With watermark_enabled, valid email provided", async () => {
    const { user, cookie } = await orchestrator.createUserSession();
    await orchestrator.activateSubscription(user.active_workspace_id!);
    const document = await orchestrator.uploadDocument(cookie);
    const link = await orchestrator.createShareLink(cookie, document.id, {
      watermark_enabled: true,
    });

    const response = await fetch(
      `http://localhost:3000/api/v1/share/${link.token}`,
      { headers: { "X-Viewer-Email": "viewer@example.com" } },
    );

    expect(response.status).toBe(200);

    const responseBody = await response.json();
    expect(responseBody.watermark_enabled).toBe(true);
  });

  test("With an NDA configured, no email/name provided", async () => {
    const { user, cookie } = await orchestrator.createUserSession();
    await orchestrator.activateSubscription(user.active_workspace_id!);
    const document = await orchestrator.uploadDocument(cookie);
    const link = await orchestrator.createShareLink(cookie, document.id, {
      nda_text: "Keep this confidential.",
    });

    const response = await fetch(
      `http://localhost:3000/api/v1/share/${link.token}`,
    );

    expect(response.status).toBe(403);

    const responseBody = await response.json();
    expect(responseBody.message).toBe("Aceite os termos para continuar.");
  });

  test("With an NDA configured, email provided but no name", async () => {
    const { user, cookie } = await orchestrator.createUserSession();
    await orchestrator.activateSubscription(user.active_workspace_id!);
    const document = await orchestrator.uploadDocument(cookie);
    const link = await orchestrator.createShareLink(cookie, document.id, {
      nda_text: "Keep this confidential.",
    });

    const response = await fetch(
      `http://localhost:3000/api/v1/share/${link.token}`,
      { headers: { "X-Viewer-Email": "viewer@example.com" } },
    );

    expect(response.status).toBe(403);

    const responseBody = await response.json();
    expect(responseBody.message).toBe("Aceite os termos para continuar.");
  });

  test("With an NDA configured, email and name provided", async () => {
    const { user, cookie } = await orchestrator.createUserSession();
    await orchestrator.activateSubscription(user.active_workspace_id!);
    const document = await orchestrator.uploadDocument(cookie);
    const link = await orchestrator.createShareLink(cookie, document.id, {
      nda_text: "Keep this confidential.",
    });

    const response = await fetch(
      `http://localhost:3000/api/v1/share/${link.token}`,
      {
        headers: {
          "X-Viewer-Email": "viewer@example.com",
          "X-Viewer-Name": "Jane Viewer",
        },
      },
    );

    expect(response.status).toBe(200);

    const responseBody = await response.json();
    expect(responseBody.nda_text).toBe("Keep this confidential.");
  });

  test("With both an NDA and an allow-list, email/name valid but not on the list", async () => {
    const { user, cookie } = await orchestrator.createUserSession();
    await orchestrator.activateSubscription(user.active_workspace_id!);
    const document = await orchestrator.uploadDocument(cookie);
    const link = await orchestrator.createShareLink(cookie, document.id, {
      nda_text: "Keep this confidential.",
      allowed_emails: ["approved@example.com"],
    });

    const response = await fetch(
      `http://localhost:3000/api/v1/share/${link.token}`,
      {
        headers: {
          "X-Viewer-Email": "notapproved@example.com",
          "X-Viewer-Name": "Jane Viewer",
        },
      },
    );

    expect(response.status).toBe(403);

    const responseBody = await response.json();
    expect(responseBody.message).toBe("Email não autorizado.");
  });

  test("With both an NDA and an allow-list, approved email but no name", async () => {
    const { user, cookie } = await orchestrator.createUserSession();
    await orchestrator.activateSubscription(user.active_workspace_id!);
    const document = await orchestrator.uploadDocument(cookie);
    const link = await orchestrator.createShareLink(cookie, document.id, {
      nda_text: "Keep this confidential.",
      allowed_emails: ["approved@example.com"],
    });

    const response = await fetch(
      `http://localhost:3000/api/v1/share/${link.token}`,
      { headers: { "X-Viewer-Email": "approved@example.com" } },
    );

    expect(response.status).toBe(403);

    const responseBody = await response.json();
    expect(responseBody.message).toBe("Aceite os termos para continuar.");
  });

  test("With both an NDA and an allow-list, approved email and name provided", async () => {
    const { user, cookie } = await orchestrator.createUserSession();
    await orchestrator.activateSubscription(user.active_workspace_id!);
    const document = await orchestrator.uploadDocument(cookie);
    const link = await orchestrator.createShareLink(cookie, document.id, {
      nda_text: "Keep this confidential.",
      allowed_emails: ["approved@example.com"],
    });

    const response = await fetch(
      `http://localhost:3000/api/v1/share/${link.token}`,
      {
        headers: {
          "X-Viewer-Email": "approved@example.com",
          "X-Viewer-Name": "Jane Viewer",
        },
      },
    );

    expect(response.status).toBe(200);
  });

  test("With the linked document soft-deleted", async () => {
    const { cookie } = await orchestrator.createUserSession();
    const document = await orchestrator.uploadDocument(cookie);
    const link = await orchestrator.createShareLink(cookie, document.id);

    await fetch(`http://localhost:3000/api/v1/documents/${document.id}`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    });

    const response = await fetch(
      `http://localhost:3000/api/v1/share/${link.token}`,
    );

    expect(response.status).toBe(404);
  });
});
