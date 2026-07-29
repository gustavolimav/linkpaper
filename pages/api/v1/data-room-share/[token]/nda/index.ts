import type { NextApiRequest, NextApiResponse } from "next";
import { createRouter } from "next-connect";
import controller from "../../../../../../infra/controller";
import { rateLimit } from "../../../../../../infra/rate-limit";
import dataRoomLink from "../../../../../../models/dataRoomLink";

interface NdaRequest extends NextApiRequest {
  query: {
    token?: string;
  } & NextApiRequest["query"];
}

const router = createRouter<NextApiRequest, NextApiResponse>();

// No authMiddleware: intentionally public, same rationale as the
// single-document route — the NDA text isn't sensitive, readable before
// any password/email/name is provided.
router.get(rateLimit({ limit: 20, windowMs: 60 * 1000 }), getHandler);

export default router.handler(controller.errorHandlers);

async function getHandler(
  request: NdaRequest,
  response: NextApiResponse<{ nda_text: string | null }>,
) {
  const token = request.query.token as string;
  const ndaText = await dataRoomLink.getNdaText(token);

  return response.status(200).json({ nda_text: ndaText });
}
