import { test, expect } from "@playwright/test";
import orchestrator from "../orchestrator";
import { loginNewUser } from "./helpers";

const NON_PDF_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

test.beforeAll(async () => {
  await orchestrator.waitForAllServices();
  await orchestrator.cleanDatabase();
  await orchestrator.runPendingMigrations();
});

// Same PATCH shape used by the sibling Jest suite
// (tests/integration/api/v1/data-room-share/[token]/file/index.test.ts)
// to flip a single document's allow_download flag within a data room.
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

test.describe("Data-room public viewer — 'Visualizar' gated by allow_download (DL-09)", () => {
  test("A non-PDF document with allow_download false offers no working preview action, and gains one once allowed", async ({
    page,
    context,
  }) => {
    const { cookie } = await loginNewUser(context);
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

    await page.goto(`/data-room/${link.token}`);

    await expect(page.getByRole("button", { name: /Visualizar/ })).toHaveCount(
      0,
    );
    await expect(
      page.getByText("Pré-visualização não disponível"),
    ).toBeVisible();

    await setAllowDownload(cookie, room.id, document.id, true);
    await page.reload();

    await expect(
      page.getByRole("button", { name: /Visualizar/ }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /Baixar/ })).toBeVisible();
  });
});
