import type { NextApiRequest, NextApiResponse } from "next";
import { createRouter } from "next-connect";
import controller from "../../../../../infra/controller";
import { rateLimit } from "../../../../../infra/rate-limit";
import dataRoomLink from "../../../../../models/dataRoomLink";
import type { DataRoomLinkWithDocuments } from "../../../../../types/index";

interface DataRoomShareRequest extends NextApiRequest {
  query: {
    token?: string;
  } & NextApiRequest["query"];
}

const router = createRouter<NextApiRequest, NextApiResponse>();

// No authMiddleware: intentionally public, same shape as
// GET /api/v1/share/[token]. Rate limited for the same reason — it's the
// only unauthenticated route accepting a secret (the optional password).
router.get(rateLimit({ limit: 20, windowMs: 60 * 1000 }), getHandler);

export default router.handler(controller.errorHandlers);

async function getHandler(
  request: DataRoomShareRequest,
  response: NextApiResponse<DataRoomLinkWithDocuments>,
) {
  const token = request.query.token as string;
  // Header only, no query-param fallback — same rationale as the
  // single-document share route (query strings end up in logs/history).
  const providedPassword = request.headers["x-share-password"];
  const providedEmail = request.headers["x-viewer-email"];
  const providedName = request.headers["x-viewer-name"];

  const result = await dataRoomLink.getByToken(
    token,
    typeof providedPassword === "string" ? providedPassword : undefined,
    typeof providedEmail === "string" ? providedEmail : undefined,
    typeof providedName === "string" ? providedName : undefined,
  );

  return response.status(200).json(result);
}
