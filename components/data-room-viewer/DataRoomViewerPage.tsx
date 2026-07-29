"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  FileQuestion,
  Ban,
  Clock,
  AlertCircle,
  Download,
  Eye,
  ArrowLeft,
  MessageCircle,
} from "lucide-react";
import { PasswordGate } from "@/components/viewer/PasswordGate";
import { EmailGate } from "@/components/viewer/EmailGate";
import { NdaGate } from "@/components/viewer/NdaGate";
import { PDFViewer } from "@/components/viewer/PDFViewer";
import { ChatPanel } from "@/components/viewer/ChatPanel";
import { ViewerCardShell } from "@/components/viewer/ViewerCardShell";
import { ViewerStateCard } from "@/components/viewer/ViewerStateCard";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { getViewerFingerprint } from "@/lib/fingerprint";
import type { DataRoomLinkWithDocuments } from "@/types/index";

interface DataRoomViewerPageProps {
  token: string;
}

type ErrorKind = "not-found" | "revoked" | "expired" | "generic";

type LoadState =
  | { status: "loading" }
  | { status: "password-required"; error?: string }
  | { status: "email-required"; error?: string }
  | { status: "nda-required"; ndaText: string; error?: string }
  | { status: "error"; kind: ErrorKind; message: string }
  | { status: "ready"; link: DataRoomLinkWithDocuments };

// Set only while a single document is open for inline viewing (PDF only
// — non-PDF documents have no inline preview, same limitation as the
// single-document viewer, tracked in US-34).
interface OpenDocument {
  documentId: string;
  fileData: ArrayBuffer;
}

const ERROR_PRESENTATION: Record<
  ErrorKind,
  { icon: typeof FileQuestion; title: string }
> = {
  "not-found": { icon: FileQuestion, title: "Link não encontrado" },
  revoked: { icon: Ban, title: "Link revogado" },
  expired: { icon: Clock, title: "Link expirado" },
  generic: { icon: AlertCircle, title: "Não foi possível abrir a data room" },
};

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "application/pdf": ".pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    ".docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    ".pptx",
};

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function DataRoomViewerPage({ token }: DataRoomViewerPageProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [isSubmittingPassword, setIsSubmittingPassword] = useState(false);
  const [isSubmittingEmail, setIsSubmittingEmail] = useState(false);
  const [isSubmittingNda, setIsSubmittingNda] = useState(false);
  const [loadingDocumentId, setLoadingDocumentId] = useState<string | null>(
    null,
  );
  const [openDocument, setOpenDocument] = useState<OpenDocument | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);

  const fingerprintRef = useRef<string>("");
  const passwordRef = useRef<string | undefined>(undefined);
  const emailRef = useRef<string | undefined>(undefined);
  const nameRef = useRef<string | undefined>(undefined);
  const startTimeRef = useRef<number | null>(null);
  const pagesViewedRef = useRef(1);
  const hasDownloadedRef = useRef(false);
  const watermarkTextRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    fingerprintRef.current = getViewerFingerprint();
  }, []);

  function gateHeaders(): HeadersInit {
    return {
      ...(passwordRef.current
        ? { "X-Share-Password": passwordRef.current }
        : {}),
      ...(emailRef.current ? { "X-Viewer-Email": emailRef.current } : {}),
      ...(nameRef.current ? { "X-Viewer-Name": nameRef.current } : {}),
    };
  }

  const load = useCallback(
    async (overrides?: {
      password?: string;
      email?: string;
      name?: string;
    }) => {
      if (overrides?.password !== undefined) {
        passwordRef.current = overrides.password;
      }
      if (overrides?.email !== undefined) {
        emailRef.current = overrides.email;
      }
      if (overrides?.name !== undefined) {
        nameRef.current = overrides.name;
      }

      const response = await fetch(`/api/v1/data-room-share/${token}`, {
        headers: gateHeaders(),
      });

      if (response.status === 404) {
        setState({
          status: "error",
          kind: "not-found",
          message: "Este link não foi encontrado.",
        });
        return;
      }

      if (response.status === 403) {
        const body = await response.json().catch(() => null);
        const message: string = body?.message ?? "";

        if (message.includes("Senha")) {
          setState({
            status: "password-required",
            ...(overrides?.password !== undefined
              ? { error: "Senha incorreta." }
              : {}),
          });
          return;
        }

        if (message.includes("termos")) {
          const ndaResponse = await fetch(
            `/api/v1/data-room-share/${token}/nda`,
          );
          const ndaBody = await ndaResponse.json().catch(() => null);
          const ndaText: string = ndaBody?.nda_text ?? "";

          setState({
            status: "nda-required",
            ndaText,
            ...(overrides?.name !== undefined || overrides?.email !== undefined
              ? { error: message }
              : {}),
          });
          return;
        }

        if (message.includes("Email")) {
          setState({
            status: "email-required",
            ...(overrides?.email !== undefined ? { error: message } : {}),
          });
          return;
        }

        setState({
          status: "error",
          kind:
            message === "Este link foi revogado."
              ? "revoked"
              : message === "Este link expirou."
                ? "expired"
                : "generic",
          message: message || "Este link não está mais disponível.",
        });
        return;
      }

      if (!response.ok) {
        setState({
          status: "error",
          kind: "generic",
          message: "Não foi possível abrir a data room.",
        });
        return;
      }

      const link: DataRoomLinkWithDocuments = await response.json();
      setState({ status: "ready", link });

      if (link.watermark_enabled && emailRef.current) {
        watermarkTextRef.current = `${emailRef.current} · ${new Date().toLocaleString("pt-BR")}`;
      }
    },
    [token],
  );

  useEffect(() => {
    load();
  }, [load]);

  const recordView = useCallback(
    (
      documentId: string,
      extra?: {
        time_on_page?: number;
        pages_viewed?: number;
        downloaded?: boolean;
      },
    ) => {
      fetch(`/api/v1/data-room-share/${token}/view`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document_id: documentId,
          viewer_fingerprint: fingerprintRef.current,
          ...(emailRef.current ? { viewer_email: emailRef.current } : {}),
          ...(nameRef.current ? { viewer_name: nameRef.current } : {}),
          ...extra,
        }),
      }).catch(() => undefined);
    },
    [token],
  );

  function recordExitForOpenDocument() {
    if (!openDocument || startTimeRef.current === null) {
      return;
    }

    const timeOnPage = Math.round((Date.now() - startTimeRef.current) / 1000);

    navigator.sendBeacon(
      `/api/v1/data-room-share/${token}/view`,
      new Blob(
        [
          JSON.stringify({
            document_id: openDocument.documentId,
            viewer_fingerprint: fingerprintRef.current,
            ...(emailRef.current && { viewer_email: emailRef.current }),
            ...(nameRef.current && { viewer_name: nameRef.current }),
            time_on_page: timeOnPage,
            pages_viewed: pagesViewedRef.current,
            ...(hasDownloadedRef.current && { downloaded: true }),
          }),
        ],
        { type: "application/json" },
      ),
    );
  }

  useEffect(() => {
    window.addEventListener("beforeunload", recordExitForOpenDocument);
    return () =>
      window.removeEventListener("beforeunload", recordExitForOpenDocument);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openDocument]);

  async function handleOpenDocument(documentId: string, mimeType: string) {
    if (mimeType !== "application/pdf") {
      // No inline preview for non-PDF (US-34) — download the bytes and let
      // the browser handle them (open/download), same as before, but still
      // record a one-off view (US-56 fixes this gap for data rooms, unlike
      // the single-document viewer's early-return that skips it entirely).
      setLoadingDocumentId(documentId);
      try {
        const response = await fetch(
          `/api/v1/data-room-share/${token}/file?document_id=${documentId}`,
          { headers: gateHeaders() },
        );
        if (!response.ok) return;
        const blob = await response.blob();
        window.open(URL.createObjectURL(blob), "_blank");
        recordView(documentId);
      } finally {
        setLoadingDocumentId(null);
      }
      return;
    }

    setLoadingDocumentId(documentId);
    try {
      const response = await fetch(
        `/api/v1/data-room-share/${token}/file?document_id=${documentId}`,
        { headers: gateHeaders() },
      );
      if (!response.ok) return;

      const fileData = await response.arrayBuffer();
      pagesViewedRef.current = 1;
      hasDownloadedRef.current = false;
      startTimeRef.current = Date.now();
      setOpenDocument({ documentId, fileData });
      recordView(documentId);
    } finally {
      setLoadingDocumentId(null);
    }
  }

  function handleCloseDocument() {
    recordExitForOpenDocument();
    setOpenDocument(null);
    setIsChatOpen(false);
    startTimeRef.current = null;
  }

  async function handleDownload(documentId: string, filename: string) {
    setLoadingDocumentId(documentId);
    try {
      const response = await fetch(
        `/api/v1/data-room-share/${token}/file?document_id=${documentId}`,
        { headers: gateHeaders() },
      );
      if (!response.ok) return;

      const blob = await response.blob();
      triggerBlobDownload(blob, filename);
      hasDownloadedRef.current = true;

      if (!openDocument) {
        recordView(documentId, { downloaded: true });
      }
    } finally {
      setLoadingDocumentId(null);
    }
  }

  if (state.status === "loading") {
    return (
      <ViewerCardShell>
        <p className="text-center text-muted-foreground">Carregando...</p>
      </ViewerCardShell>
    );
  }

  if (state.status === "password-required") {
    return (
      <PasswordGate
        onSubmit={async (pw) => {
          setIsSubmittingPassword(true);
          await load({ password: pw });
          setIsSubmittingPassword(false);
        }}
        error={state.error}
        isSubmitting={isSubmittingPassword}
      />
    );
  }

  if (state.status === "email-required") {
    return (
      <EmailGate
        onSubmit={async (email) => {
          setIsSubmittingEmail(true);
          await load({ email });
          setIsSubmittingEmail(false);
        }}
        error={state.error}
        isSubmitting={isSubmittingEmail}
      />
    );
  }

  if (state.status === "nda-required") {
    return (
      <NdaGate
        ndaText={state.ndaText}
        onSubmit={async (name, email) => {
          setIsSubmittingNda(true);
          await load({ name, email });
          setIsSubmittingNda(false);
        }}
        error={state.error}
        isSubmitting={isSubmittingNda}
      />
    );
  }

  if (state.status === "error") {
    const presentation = ERROR_PRESENTATION[state.kind];
    return (
      <ViewerCardShell>
        <ViewerStateCard
          icon={presentation.icon}
          title={presentation.title}
          description={state.message}
        />
      </ViewerCardShell>
    );
  }

  const { link } = state;
  const brandStyle = link.brand_accent_color
    ? ({ "--primary": link.brand_accent_color } as React.CSSProperties)
    : undefined;

  if (openDocument) {
    const document = link.documents.find(
      (d) => d.document_id === openDocument.documentId,
    )!;

    return (
      <div className="flex h-screen flex-col bg-background" style={brandStyle}>
        <div className="flex items-center justify-between border-b p-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleCloseDocument}
          >
            <ArrowLeft className="h-4 w-4" /> Voltar
          </Button>
          <p className="truncate text-sm font-medium">{document.title}</p>
          {link.ai_chat_available && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsChatOpen((v) => !v)}
            >
              <MessageCircle className="h-4 w-4" /> Chat
            </Button>
          )}
          {!link.ai_chat_available && <div className="w-16" />}
        </div>
        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1">
            <PDFViewer
              fileData={openDocument.fileData}
              allowDownload={document.allow_download}
              onDownload={() => {
                triggerBlobDownload(
                  new Blob([openDocument.fileData], {
                    type: "application/pdf",
                  }),
                  `${document.title}.pdf`,
                );
                hasDownloadedRef.current = true;
              }}
              onPageChange={(page) => {
                pagesViewedRef.current = Math.max(pagesViewedRef.current, page);
              }}
              watermarkText={watermarkTextRef.current}
            />
          </div>
          {isChatOpen && (
            <ChatPanel
              token={token}
              headers={gateHeaders()}
              onClose={() => setIsChatOpen(false)}
              endpoint={`/api/v1/data-room-share/${token}/chat`}
              extraBody={{ document_id: openDocument.documentId }}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <ViewerCardShell className="max-w-lg" style={brandStyle}>
      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-xl">
            {link.data_room.name}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {link.brand_welcome_message && (
            <p className="mb-2 text-sm text-muted-foreground">
              {link.brand_welcome_message}
            </p>
          )}
          {link.documents.map((doc) => (
            <div
              key={doc.document_id}
              className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
            >
              <span className="truncate text-sm font-medium">{doc.title}</span>
              <div className="flex shrink-0 gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={loadingDocumentId === doc.document_id}
                  onClick={() =>
                    handleOpenDocument(doc.document_id, doc.mime_type)
                  }
                >
                  <Eye className="h-3.5 w-3.5" /> Visualizar
                </Button>
                {doc.allow_download && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={loadingDocumentId === doc.document_id}
                    onClick={() =>
                      handleDownload(
                        doc.document_id,
                        `${doc.title}${EXTENSION_BY_MIME_TYPE[doc.mime_type] ?? ""}`,
                      )
                    }
                  >
                    <Download className="h-3.5 w-3.5" /> Baixar
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </ViewerCardShell>
  );
}
