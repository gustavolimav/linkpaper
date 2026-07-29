import type { NextApiRequest, NextApiResponse } from "next";
import { createRouter } from "next-connect";
import controller from "../../../../../../infra/controller";
import { rateLimit } from "../../../../../../infra/rate-limit";
import { ValidationError } from "../../../../../../infra/errors";
import dataRoomLink from "../../../../../../models/dataRoomLink";
import storage from "../../../../../../infra/storage";

interface DataRoomFileRequest extends NextApiRequest {
  query: {
    token?: string;
    document_id?: string;
  } & NextApiRequest["query"];
}

const router = createRouter<NextApiRequest, NextApiResponse>();

// No authMiddleware: intentionally public, re-validates the link token
// (and password) itself, same as GET /api/v1/share/[token]/file.
router.get(rateLimit({ limit: 20, windowMs: 60 * 1000 }), getHandler);

export default router.handler(controller.errorHandlers);

async function getHandler(
  request: DataRoomFileRequest,
  response: NextApiResponse,
) {
  const token = request.query.token as string;
  const documentId = request.query.document_id;
  const providedPassword = request.headers["x-share-password"];
  const providedEmail = request.headers["x-viewer-email"];
  const providedName = request.headers["x-viewer-name"];

  if (typeof documentId !== "string" || !documentId) {
    throw new ValidationError({
      message: "O parâmetro 'document_id' é obrigatório.",
      action: "Informe o documento desejado.",
    });
  }

  const { storage_key, mime_type } = await dataRoomLink.getFileByToken(
    token,
    documentId,
    typeof providedPassword === "string" ? providedPassword : undefined,
    typeof providedEmail === "string" ? providedEmail : undefined,
    typeof providedName === "string" ? providedName : undefined,
  );

  const file = await storage.getFile(storage_key);

  response.setHeader("Content-Type", mime_type || file.contentType);
  response.setHeader("Cache-Control", "private, max-age=0, no-store");
  return response.status(200).send(file.body);
}
