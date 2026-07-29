import type { NextApiRequest, NextApiResponse } from "next";
import { createRouter } from "next-connect";
import controller from "../../../../../../infra/controller";
import { rateLimit } from "../../../../../../infra/rate-limit";
import { validate, chatCreateSchema } from "../../../../../../infra/schemas";
import { ValidationError } from "../../../../../../infra/errors";
import dataRoomLink from "../../../../../../models/dataRoomLink";
import chat from "../../../../../../models/chat";

interface ChatRequest extends NextApiRequest {
  query: {
    token?: string;
  } & NextApiRequest["query"];
}

interface DataRoomChatBody {
  question: string;
  document_id?: string;
}

const router = createRouter<NextApiRequest, NextApiResponse>();

// Public, gated the same way as GET /api/v1/data-room-share/[token]
// (password/email/NDA) via dataRoomLink.getByToken below — not by auth
// middleware. Rate-limited the same way as the single-document chat
// endpoint, to protect both brute-forcing and AI cost.
router.post(rateLimit({ limit: 20, windowMs: 60 * 60 * 1000 }), postHandler);

export default router.handler(controller.errorHandlers);

async function postHandler(request: ChatRequest, response: NextApiResponse) {
  const token = request.query.token as string;
  const { question } = validate(chatCreateSchema, request.body);
  const documentId = (request.body as DataRoomChatBody | undefined)
    ?.document_id;

  if (typeof documentId !== "string" || !documentId) {
    throw new ValidationError({
      message: "O parâmetro 'document_id' é obrigatório.",
      action: "Informe o documento sobre o qual deseja perguntar.",
    });
  }

  const providedPassword = request.headers["x-share-password"];
  const providedEmail = request.headers["x-viewer-email"];
  const providedName = request.headers["x-viewer-name"];

  const result = await dataRoomLink.getByToken(
    token,
    typeof providedPassword === "string" ? providedPassword : undefined,
    typeof providedEmail === "string" ? providedEmail : undefined,
    typeof providedName === "string" ? providedName : undefined,
  );

  // Confirms document_id actually belongs to this room, same check
  // getFileByToken already does for file streaming — a visitor can't ask
  // about a document outside the room just by guessing its id.
  if (!result.documents.some((doc) => doc.document_id === documentId)) {
    throw new ValidationError({
      message: "O documento informado não pertence a esta data room.",
      action: "Verifique se o identificador está correto.",
    });
  }

  const messageStream = await chat.answerQuestion(documentId, question);

  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  messageStream.on("text", (textDelta: string) => {
    response.write(`data: ${JSON.stringify({ text: textDelta })}\n\n`);
  });

  messageStream.on("end", () => {
    response.write("data: [DONE]\n\n");
    response.end();
  });

  messageStream.on("error", () => {
    response.write(
      `data: ${JSON.stringify({ error: "Erro ao gerar resposta." })}\n\n`,
    );
    response.end();
  });
}
