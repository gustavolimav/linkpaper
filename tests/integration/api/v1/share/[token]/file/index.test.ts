import orchestrator from "tests/orchestrator";

const NON_PDF_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
  await orchestrator.cleanDatabase();
  await orchestrator.runPendingMigrations();
});

describe("GET /api/v1/share/[token]/file", () => {
  test("A non-PDF fixture upload really has a non-PDF mime_type", async () => {
    const { cookie } = await orchestrator.createUserSession();
    const document = await orchestrator.uploadDocument(cookie, {
      mimeType: NON_PDF_MIME_TYPE,
      filename: "a.docx",
      buffer: Buffer.from("fake docx bytes"),
    });

    expect(document.mime_type).toBe(NON_PDF_MIME_TYPE);
    expect(document.mime_type).not.toBe("application/pdf");
  });

  test("A non-PDF document with allow_download false returns 403 with no file bytes, in pt-BR", async () => {
    const { cookie } = await orchestrator.createUserSession();
    const document = await orchestrator.uploadDocument(cookie, {
      mimeType: NON_PDF_MIME_TYPE,
      filename: "a.docx",
      buffer: Buffer.from("fake docx bytes"),
    });
    const link = await orchestrator.createShareLink(cookie, document.id, {
      allow_download: false,
    });

    const response = await fetch(
      `http://localhost:3000/api/v1/share/${link.token}/file`,
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );

    const responseBody = await response.json();
    // toEqual (not toStrictEqual): Node's built-in fetch parses the JSON
    // body in a different VM realm than the one this test file's object
    // literals run in, so its Object.prototype differs from this file's —
    // toStrictEqual's prototype check fails even though every key/value
    // matches exactly. Matches this repo's existing convention (no
    // response.json() body anywhere else in the suite is asserted with
    // toStrictEqual — see e.g. tests/integration/api/v1/share/[token]/
    // index.test.ts).
    expect(responseBody).toEqual({
      name: "ForbiddenError",
      message:
        "O download deste arquivo não está habilitado para este link.",
      action:
        "Peça ao proprietário do documento para habilitar o download, se necessário.",
      status: 403,
    });
  });

  test("The same link with allow_download flipped to true returns 200 with the file bytes", async () => {
    const { cookie } = await orchestrator.createUserSession();
    const document = await orchestrator.uploadDocument(cookie, {
      mimeType: NON_PDF_MIME_TYPE,
      filename: "a.docx",
      buffer: Buffer.from("fake docx bytes"),
    });
    const link = await orchestrator.createShareLink(cookie, document.id, {
      allow_download: false,
    });

    await fetch(
      `http://localhost:3000/api/v1/documents/${document.id}/links/${link.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ allow_download: true }),
      },
    );

    const response = await fetch(
      `http://localhost:3000/api/v1/share/${link.token}/file`,
    );

    expect(response.status).toBe(200);

    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.toString()).toBe("fake docx bytes");
  });

  test("A PDF document with allow_download false still returns 200 with the file bytes", async () => {
    const { cookie } = await orchestrator.createUserSession();
    const document = await orchestrator.uploadDocument(cookie);

    expect(document.mime_type).toBe("application/pdf");

    const link = await orchestrator.createShareLink(cookie, document.id, {
      allow_download: false,
    });

    const response = await fetch(
      `http://localhost:3000/api/v1/share/${link.token}/file`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");

    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(0);
  });

  test("A blocked attempt with no viewer headers still returns 403 (best-effort audit write never blocks the response)", async () => {
    const { cookie } = await orchestrator.createUserSession();
    const document = await orchestrator.uploadDocument(cookie, {
      mimeType: NON_PDF_MIME_TYPE,
      filename: "a.docx",
      buffer: Buffer.from("fake docx bytes"),
    });
    const link = await orchestrator.createShareLink(cookie, document.id, {
      allow_download: false,
    });

    const response = await fetch(
      `http://localhost:3000/api/v1/share/${link.token}/file`,
      {
        // Explicitly no X-Viewer-Email / X-Viewer-Name — an anonymous request.
        headers: {},
      },
    );

    expect(response.status).toBe(403);

    const responseBody = await response.json();
    expect(responseBody.name).toBe("ForbiddenError");
  });
});
