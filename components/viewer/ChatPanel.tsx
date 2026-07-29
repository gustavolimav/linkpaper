"use client";

import { useState } from "react";
import { Send, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatPanelProps {
  token: string;
  headers: HeadersInit;
  onClose: () => void;
  // Lets a caller with a different chat route (e.g. a data room, which
  // needs a document_id in the body since one link covers several
  // documents) reuse this component instead of forking it.
  endpoint?: string;
  extraBody?: Record<string, unknown>;
}

export function ChatPanel({
  token,
  headers,
  onClose,
  endpoint,
  extraBody,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const trimmed = question.trim();
    if (!trimmed || isStreaming) {
      return;
    }

    setMessages((prev) => [
      ...prev,
      { role: "user", content: trimmed },
      { role: "assistant", content: "" },
    ]);
    setQuestion("");
    setIsStreaming(true);
    setError(null);

    try {
      const response = await fetch(endpoint ?? `/api/v1/share/${token}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ question: trimmed, ...extraBody }),
      });

      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null);
        setError(body?.message ?? "Não foi possível obter uma resposta.");
        setMessages((prev) => prev.slice(0, -2));
        return;
      }

      await streamResponse(response.body, (chunk) => {
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1]!;
          next[next.length - 1] = { ...last, content: last.content + chunk };
          return next;
        });
      });
    } finally {
      setIsStreaming(false);
    }
  }

  async function streamResponse(
    body: ReadableStream<Uint8Array>,
    onChunk: (text: string) => void,
  ) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";

      for (const event of events) {
        if (!event.startsWith("data: ")) {
          continue;
        }

        const payload = event.slice("data: ".length);
        if (payload === "[DONE]") {
          continue;
        }

        try {
          const parsed = JSON.parse(payload);
          if (parsed.error) {
            setError(parsed.error);
          } else if (typeof parsed.text === "string") {
            onChunk(parsed.text);
          }
        } catch {
          // ignore malformed event
        }
      }
    }
  }

  return (
    <div className="flex h-full w-80 shrink-0 flex-col border-l bg-background">
      <div className="flex items-center justify-between border-b p-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="h-4 w-4" /> Pergunte sobre este documento
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label="Fechar chat"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Faça uma pergunta sobre o conteúdo do documento.
          </p>
        )}
        {messages.map((message, index) => (
          <div
            key={index}
            className={
              message.role === "user"
                ? "ml-6 rounded-lg bg-muted p-2 text-sm"
                : "mr-6 rounded-lg bg-muted/30 p-2 text-sm whitespace-pre-wrap"
            }
          >
            {message.content ||
              (isStreaming && index === messages.length - 1 ? "..." : "")}
          </div>
        ))}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 border-t p-3"
      >
        <Input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Digite sua pergunta..."
          disabled={isStreaming}
        />
        <Button
          type="submit"
          size="icon"
          disabled={isStreaming || !question.trim()}
          aria-label="Enviar pergunta"
        >
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
