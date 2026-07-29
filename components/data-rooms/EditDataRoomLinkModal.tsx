"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { parseAllowedEmails } from "@/lib/parseAllowedEmails";
import type {
  DataRoomLinkResponse,
  DataRoomLinkUpdateInput,
} from "@/types/index";

interface EditDataRoomLinkModalProps {
  dataRoomId: string;
  link: DataRoomLinkResponse;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (link: DataRoomLinkResponse) => void;
}

export function EditDataRoomLinkModal({
  dataRoomId,
  link,
  open,
  onOpenChange,
  onSaved,
}: EditDataRoomLinkModalProps) {
  const [label, setLabel] = useState(link.label ?? "");
  const [password, setPassword] = useState("");
  const [clearPassword, setClearPassword] = useState(false);
  const [expiresAt, setExpiresAt] = useState(
    link.expires_at ? new Date(link.expires_at).toISOString().slice(0, 10) : "",
  );
  const [isActive, setIsActive] = useState(link.is_active);
  const [requireEmail, setRequireEmail] = useState(link.require_email);
  const [allowedEmailsText, setAllowedEmailsText] = useState(
    link.allowed_emails.join("\n"),
  );
  const [notifyOnView, setNotifyOnView] = useState(link.notify_on_view);
  const [watermarkEnabled, setWatermarkEnabled] = useState(
    link.watermark_enabled,
  );
  const [ndaText, setNdaText] = useState(link.nda_text ?? "");
  const [brandAccentColor, setBrandAccentColor] = useState(
    link.brand_accent_color ?? "",
  );
  const [brandWelcomeMessage, setBrandWelcomeMessage] = useState(
    link.brand_welcome_message ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const body: DataRoomLinkUpdateInput = {
        label: label || null,
        is_active: isActive,
        require_email: requireEmail,
        notify_on_view: notifyOnView,
        watermark_enabled: watermarkEnabled,
        allowed_emails: parseAllowedEmails(allowedEmailsText),
        nda_text: ndaText || null,
        brand_accent_color: brandAccentColor || null,
        brand_welcome_message: brandWelcomeMessage || null,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
      };

      if (clearPassword) {
        body.password = null;
      } else if (password) {
        body.password = password;
      }

      const response = await fetch(
        `/api/v1/data-rooms/${dataRoomId}/links/${link.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );

      if (!response.ok) {
        const responseBody = await response.json().catch(() => null);
        setError(
          responseBody?.message ?? "Não foi possível salvar as alterações.",
        );
        return;
      }

      const updated = await response.json();
      onSaved(updated);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Editar link da data room</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="-mx-1 flex-1 space-y-4 overflow-y-auto px-1">
            <div className="space-y-2">
              <Label htmlFor="edit-dr-label">Rótulo</Label>
              <Input
                id="edit-dr-label"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-dr-password">Nova senha</Label>
              <Input
                id="edit-dr-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={clearPassword}
                placeholder={
                  link.has_password
                    ? "Deixe em branco para manter a atual"
                    : "Sem senha"
                }
              />
              <div className="flex items-center gap-2">
                <Checkbox
                  id="edit-dr-clear-password"
                  checked={clearPassword}
                  onCheckedChange={(checked) =>
                    setClearPassword(checked === true)
                  }
                />
                <Label htmlFor="edit-dr-clear-password">Remover senha</Label>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-dr-expiresAt">Expiração</Label>
              <Input
                id="edit-dr-expiresAt"
                type="date"
                value={expiresAt}
                onChange={(event) => setExpiresAt(event.target.value)}
              />
            </div>

            <div className="flex items-center gap-2">
              <Switch
                id="edit-dr-isActive"
                checked={isActive}
                onCheckedChange={setIsActive}
              />
              <Label htmlFor="edit-dr-isActive">Link ativo</Label>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                id="edit-dr-requireEmail"
                checked={requireEmail}
                onCheckedChange={setRequireEmail}
              />
              <Label htmlFor="edit-dr-requireEmail">
                Exigir email do visitante
              </Label>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-dr-allowedEmails">
                Lista de emails permitidos
              </Label>
              <Textarea
                id="edit-dr-allowedEmails"
                value={allowedEmailsText}
                onChange={(event) => setAllowedEmailsText(event.target.value)}
                placeholder="um@exemplo.com&#10;outro@exemplo.com"
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                Um email por linha. Se preenchido, só esses emails poderão
                acessar o link (mesmo com a senha correta). Deixe em branco para
                não restringir.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                id="edit-dr-notifyOnView"
                checked={notifyOnView}
                onCheckedChange={setNotifyOnView}
              />
              <Label htmlFor="edit-dr-notifyOnView">
                Notificar por e-mail ao ser visualizado
              </Label>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                id="edit-dr-watermarkEnabled"
                checked={watermarkEnabled}
                onCheckedChange={setWatermarkEnabled}
              />
              <Label htmlFor="edit-dr-watermarkEnabled">
                Marca d&apos;água com email do visitante
              </Label>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-dr-ndaText">
                Termo de confidencialidade
              </Label>
              <Textarea
                id="edit-dr-ndaText"
                value={ndaText}
                onChange={(event) => setNdaText(event.target.value)}
                placeholder="Cole aqui o texto que o visitante deve aceitar antes de ver os documentos"
                rows={4}
              />
              <p className="text-xs text-muted-foreground">
                Se preenchido, o visitante precisa informar nome e email e
                aceitar este termo antes de acessar a data room. Deixe em branco
                para remover a exigência.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-dr-brandAccentColor">Cor de destaque</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="edit-dr-brandAccentColor"
                  type="color"
                  value={brandAccentColor || "#000000"}
                  onChange={(event) => setBrandAccentColor(event.target.value)}
                  className="h-9 w-14 p-1"
                />
                {brandAccentColor && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setBrandAccentColor("")}
                  >
                    Remover
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-dr-brandWelcomeMessage">
                Mensagem de boas-vindas
              </Label>
              <Textarea
                id="edit-dr-brandWelcomeMessage"
                value={brandWelcomeMessage}
                onChange={(event) => setBrandWelcomeMessage(event.target.value)}
                placeholder="Ex: Olá! Segue a documentação da rodada, qualquer dúvida me chama."
                rows={2}
              />
            </div>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
