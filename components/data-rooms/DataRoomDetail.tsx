"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import { Check, Copy, Pencil, Trash2 } from "lucide-react";
import { fetcher } from "@/lib/fetcher";
import { useWorkspaces } from "@/lib/useWorkspaces";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ManageDataRoomDocumentsModal } from "@/components/data-rooms/ManageDataRoomDocumentsModal";
import { CreateDataRoomLinkModal } from "@/components/data-rooms/CreateDataRoomLinkModal";
import { EditDataRoomLinkModal } from "@/components/data-rooms/EditDataRoomLinkModal";
import type { DataRoomResponse, DataRoomLinkResponse } from "@/types/index";

interface DataRoomDetailProps {
  id: string;
}

function publicUrlFor(token: string): string {
  return typeof window !== "undefined"
    ? `${window.location.origin}/data-room/${token}`
    : `/data-room/${token}`;
}

export function DataRoomDetail({ id }: DataRoomDetailProps) {
  const router = useRouter();
  const { activeWorkspace } = useWorkspaces();
  const canEdit = activeWorkspace?.role !== "viewer";
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [editingLink, setEditingLink] = useState<DataRoomLinkResponse | null>(
    null,
  );

  const { data: room, mutate: mutateRoom } = useSWR<DataRoomResponse>(
    `/api/v1/data-rooms/${id}`,
    fetcher,
  );

  const { data: links, mutate: mutateLinks } = useSWR<DataRoomLinkResponse[]>(
    `/api/v1/data-rooms/${id}/links`,
    fetcher,
  );

  if (!room) {
    return <Skeleton className="h-64 w-full" />;
  }

  async function handleRename() {
    if (nameDraft === null || nameDraft.trim() === room!.name) {
      setNameDraft(null);
      return;
    }

    const response = await fetch(`/api/v1/data-rooms/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nameDraft.trim() }),
    });

    if (response.ok) {
      await mutateRoom();
      toast.success("Nome atualizado.");
    } else {
      toast.error("Não foi possível renomear a data room.");
    }

    setNameDraft(null);
  }

  async function handleToggleAllowDownload(documentId: string, next: boolean) {
    const documents = room!.documents.map((doc) => ({
      document_id: doc.document_id,
      allow_download:
        doc.document_id === documentId ? next : doc.allow_download,
    }));

    const response = await fetch(`/api/v1/data-rooms/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documents }),
    });

    if (response.ok) {
      await mutateRoom();
    } else {
      toast.error("Não foi possível atualizar a permissão de download.");
    }
  }

  async function handleSaveDocuments(
    documents: { document_id: string; allow_download: boolean }[],
  ) {
    const response = await fetch(`/api/v1/data-rooms/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documents }),
    });

    if (!response.ok) {
      throw new Error("Failed to update documents");
    }

    await mutateRoom();
    toast.success("Documentos atualizados.");
  }

  async function handleDeleteRoom() {
    const response = await fetch(`/api/v1/data-rooms/${id}`, {
      method: "DELETE",
    });

    if (response.ok) {
      router.push("/data-rooms");
    } else {
      toast.error("Não foi possível excluir a data room.");
    }
  }

  async function handleRevokeLink(linkId: string) {
    const response = await fetch(`/api/v1/data-rooms/${id}/links/${linkId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: false }),
    });

    if (response.ok) {
      await mutateLinks();
    } else {
      toast.error("Não foi possível revogar o link.");
    }
  }

  async function handleCopy(link: DataRoomLinkResponse) {
    await navigator.clipboard.writeText(publicUrlFor(link.token));
    setCopiedId(link.id);
    setTimeout(
      () => setCopiedId((current) => (current === link.id ? null : current)),
      1500,
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4">
        {canEdit ? (
          <Input
            value={nameDraft ?? room.name}
            onChange={(event) => setNameDraft(event.target.value)}
            onBlur={handleRename}
            className="max-w-sm border-transparent px-0 font-heading text-2xl font-semibold tracking-tight shadow-none focus-visible:border-input focus-visible:px-3"
          />
        ) : (
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            {room.name}
          </h1>
        )}

        {canEdit && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="ghost" size="icon">
                <Trash2 className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Excluir data room?</AlertDialogTitle>
                <AlertDialogDescription>
                  Os links desta data room deixarão de funcionar. Esta ação não
                  pode ser desfeita.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={handleDeleteRoom}>
                  Excluir
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-lg font-semibold">Documentos</h2>
          {canEdit && (
            <ManageDataRoomDocumentsModal
              currentDocuments={room.documents}
              onSave={handleSaveDocuments}
            />
          )}
        </div>

        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Título</TableHead>
                <TableHead>Visualizações</TableHead>
                <TableHead>Última visualização</TableHead>
                <TableHead>Permitir download</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {room.documents.map((document) => (
                <TableRow key={document.document_id}>
                  <TableCell className="font-medium">
                    {document.title}
                  </TableCell>
                  <TableCell>{document.view_count}</TableCell>
                  <TableCell>
                    {document.last_viewed_at
                      ? new Date(document.last_viewed_at).toLocaleString(
                          "pt-BR",
                        )
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={document.allow_download}
                      disabled={!canEdit}
                      onCheckedChange={(checked) =>
                        handleToggleAllowDownload(document.document_id, checked)
                      }
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-lg font-semibold">Links</h2>
          {canEdit && (
            <CreateDataRoomLinkModal
              dataRoomId={id}
              onCreated={() => mutateLinks()}
            />
          )}
        </div>

        {links && links.length === 0 && (
          <p className="py-8 text-center text-muted-foreground">
            Nenhum link criado ainda.
          </p>
        )}

        {links && links.length > 0 && (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rótulo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>
                    <span className="sr-only">Ações</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {links.map((link) => (
                  <TableRow key={link.id}>
                    <TableCell className="font-medium">
                      {link.label ?? "—"}
                    </TableCell>
                    <TableCell>
                      {link.is_active ? (
                        <Badge className="border-score-good/20 bg-score-good/15 text-score-good">
                          Ativo
                        </Badge>
                      ) : (
                        <Badge variant="destructive">Revogado</Badge>
                      )}
                    </TableCell>
                    <TableCell className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleCopy(link)}
                      >
                        {copiedId === link.id ? (
                          <>
                            <Check className="h-3.5 w-3.5" /> Copiado
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" /> Copiar link
                          </>
                        )}
                      </Button>
                      {canEdit && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingLink(link)}
                        >
                          <Pencil className="h-3.5 w-3.5" /> Editar
                        </Button>
                      )}
                      {canEdit && link.is_active && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRevokeLink(link.id)}
                        >
                          Revogar
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {editingLink && (
        <EditDataRoomLinkModal
          dataRoomId={id}
          link={editingLink}
          open={editingLink !== null}
          onOpenChange={(next) => {
            if (!next) {
              setEditingLink(null);
            }
          }}
          onSaved={() => {
            setEditingLink(null);
            mutateLinks();
            toast.success("Link atualizado.");
          }}
        />
      )}
    </div>
  );
}
