"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { formatDuration } from "@/lib/formatters";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ActivityEvent, ActivityListResponse } from "@/types/index";

const PER_PAGE = 50;

function startOfDay(date: Date): number {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

// Groups by calendar day relative to today, matching the design
// prototype's Hoje/Ontem/Esta semana labels — anything older falls into
// a fourth "Mais antigo" bucket rather than growing the first three
// forever as the feed accumulates history.
function groupLabel(createdAt: string | Date): string {
  const today = startOfDay(new Date());
  const day = startOfDay(new Date(createdAt));
  const diffDays = Math.round((today - day) / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) {
    return "Hoje";
  }
  if (diffDays === 1) {
    return "Ontem";
  }
  if (diffDays <= 7) {
    return "Esta semana";
  }
  return "Mais antigo";
}

function actorNameFor(event: ActivityEvent): string {
  return event.actor_name ?? event.actor_email ?? "Um visitante";
}

function actionTextFor(event: ActivityEvent): string {
  if (event.event_type === "link_created") {
    return "criou um link para";
  }
  if (event.event_type === "blocked_download") {
    return "teve um download bloqueado em";
  }
  return event.is_revisit ? "revisitou" : "visualizou";
}

function detailFor(event: ActivityEvent): string | null {
  if (event.event_type === "link_created") {
    return event.link_label;
  }
  if (event.event_type === "blocked_download") {
    return "Download não permitido neste link";
  }

  const time = formatDuration(event.time_on_page);

  if (event.page_count) {
    const percent = Math.min(
      100,
      Math.round(((event.pages_viewed ?? 0) / event.page_count) * 100),
    );
    return `${percent}% lido · ${time}`;
  }

  return event.time_on_page !== null ? time : null;
}

function formatTime(createdAt: string | Date): string {
  return new Date(createdAt).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ActivityFeed() {
  const { data, error, isLoading } = useSWR<ActivityListResponse>(
    `/api/v1/activity?page=1&per_page=${PER_PAGE}`,
    fetcher,
  );

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((key) => (
          <Skeleton key={key} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Não foi possível carregar a atividade.
      </p>
    );
  }

  if (!data || data.events.length === 0) {
    return (
      <p className="py-12 text-center text-muted-foreground">
        Nenhuma atividade ainda. Compartilhe um link para começar a ver eventos
        aqui.
      </p>
    );
  }

  const groups = new Map<string, ActivityEvent[]>();
  for (const event of data.events) {
    const label = groupLabel(event.created_at);
    const bucket = groups.get(label) ?? [];
    bucket.push(event);
    groups.set(label, bucket);
  }

  const orderedLabels = ["Hoje", "Ontem", "Esta semana", "Mais antigo"].filter(
    (label) => groups.has(label),
  );

  return (
    <div className="space-y-8">
      {orderedLabels.map((label) => (
        <div key={label} className="space-y-3">
          <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {label}
          </h2>
          <div className="rounded-lg border">
            {groups.get(label)!.map((event, index) => {
              const detail = detailFor(event);

              return (
                <div
                  key={event.id}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3",
                    index > 0 && "border-t",
                  )}
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-medium text-primary">
                    {actorNameFor(event)[0]!.toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      <span className="font-medium">{actorNameFor(event)}</span>{" "}
                      {actionTextFor(event)}{" "}
                      <span className="font-medium">
                        {event.document_title}
                      </span>
                    </p>
                    {detail && (
                      <p className="truncate text-sm text-muted-foreground">
                        {detail}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 text-sm text-muted-foreground">
                    {formatTime(event.created_at)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
