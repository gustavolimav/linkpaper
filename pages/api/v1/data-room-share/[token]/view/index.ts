import type { NextApiRequest, NextApiResponse } from "next";
import { createRouter } from "next-connect";
import controller from "../../../../../../infra/controller";
import mailer from "../../../../../../infra/mailer";
import {
  validate,
  dataRoomLinkViewCreateSchema,
} from "../../../../../../infra/schemas";
import dataRoomLinkView from "../../../../../../models/dataRoomLinkView";
import dataRoomLink from "../../../../../../models/dataRoomLink";
import type {
  RecordedDataRoomLinkView,
  DataRoomLinkViewCreateInput,
} from "../../../../../../types/index";

interface ViewRequest extends NextApiRequest {
  query: {
    token?: string;
  } & NextApiRequest["query"];
}

const router = createRouter<NextApiRequest, NextApiResponse>();

router.post(postHandler);

export default router.handler(controller.errorHandlers);

async function postHandler(
  request: ViewRequest,
  response: NextApiResponse<RecordedDataRoomLinkView>,
) {
  const token = request.query.token as string;

  const validated = validate(dataRoomLinkViewCreateSchema, request.body);
  const ipAddress = extractIpAddress(request);
  const userAgent = request.headers["user-agent"];

  const input: DataRoomLinkViewCreateInput = {
    document_id: validated.document_id,
    ...(validated.viewer_fingerprint !== undefined && {
      viewer_fingerprint: validated.viewer_fingerprint,
    }),
    ...(validated.viewer_email !== undefined && {
      viewer_email: validated.viewer_email,
    }),
    ...(validated.viewer_name !== undefined && {
      viewer_name: validated.viewer_name,
    }),
    ...(validated.time_on_page !== undefined && {
      time_on_page: validated.time_on_page,
    }),
    ...(validated.pages_viewed !== undefined && {
      pages_viewed: validated.pages_viewed,
    }),
    ...(validated.downloaded !== undefined && {
      downloaded: validated.downloaded,
    }),
    ...(ipAddress !== undefined && { ip_address: ipAddress }),
    ...(typeof userAgent === "string" && { user_agent: userAgent }),
  };

  const newView = await dataRoomLinkView.recordView(token, input);

  if (newView.is_new_viewer) {
    notifyOwnerOfNewViewer(
      newView.data_room_link_id,
      newView.document_id,
      newView.viewer_email,
      request,
    ).catch(() => undefined);
  }

  return response.status(201).json(newView);
}

// Fire-and-forget, same rationale as the single-document view route: a
// notification failure must never affect the response to the anonymous
// viewer whose request triggered it.
async function notifyOwnerOfNewViewer(
  dataRoomLinkId: string,
  documentId: string,
  viewerEmail: string | null,
  request: NextApiRequest,
): Promise<void> {
  const info = await dataRoomLink.getNotificationInfo(
    dataRoomLinkId,
    documentId,
  );

  if (!info || !info.notify_on_view) {
    return;
  }

  await mailer.sendViewNotification({
    to: info.owner_email,
    documentTitle: info.document_title,
    documentId: info.document_id,
    linkLabel: info.link_label,
    analyticsUrl: `${getBaseUrl(request)}/data-rooms/${info.data_room_id}`,
    viewerEmail,
  });
}

function getBaseUrl(request: NextApiRequest): string {
  const host = request.headers["x-forwarded-host"] ?? request.headers.host;
  const protocol = request.headers["x-forwarded-proto"] ?? "https";
  return `${protocol}://${host}`;
}

function extractIpAddress(request: NextApiRequest): string | undefined {
  const forwarded = request.headers["x-forwarded-for"];

  if (typeof forwarded === "string") {
    return forwarded.split(",")[0]?.trim();
  }

  return request.socket?.remoteAddress ?? undefined;
}
