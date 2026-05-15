"use client";

import * as React from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Icon } from "@/components/shared/Icon";
import { cn } from "@/lib/utils/cn";
import { formatRelative } from "@/lib/utils/format";
import { listChatThreads, type ChatThreadDTO } from "@/lib/api/chat";

/**
 * Compact list of the user's active chat threads. Clicking a row opens the
 * `ChatDrawer` via the `onOpen` callback (parent owns the drawer state so
 * both this card and `ActiveConnections` can drive it).
 *
 * Parents can pass a `refreshKey` that increments when something (e.g. a
 * message send) should make the list reload — keeps the parent free of
 * imperative ref handles.
 */
export function ActiveChats({
  onOpen,
  refreshKey,
}: {
  onOpen: (args: { threadId: string; counterpartyId: string; counterpartyName: string; counterpartyRole: "consultant" | "taxpayer" }) => void;
  refreshKey?: number;
}) {
  const [threads, setThreads] = React.useState<ChatThreadDTO[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setError(null);
    try {
      const list = await listChatThreads();
      setThreads(list);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not load chats.");
      setThreads([]);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  return (
    <section
      aria-label="Active chats"
      className="flex flex-col gap-4 rounded-2xl border border-line bg-surface-raised p-5"
    >
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <p className="text-2xs font-medium uppercase tracking-widest text-ink-subtle">
            Active chats
          </p>
          <h2 className="mt-1 text-base font-semibold tracking-[-0.005em] text-ink">
            Conversations with your network
          </h2>
          <p className="mt-1 text-xs text-ink-muted">
            Resume where you left off — pick a thread to open it.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void refresh()}
          leftIcon={<Icon.Refresh size={12} />}
        >
          Refresh
        </Button>
      </header>

      {error && (
        <Alert tone="error" compact>
          {error}
        </Alert>
      )}

      {threads === null ? (
        <p className="text-sm text-ink-muted">Loading chats…</p>
      ) : threads.length === 0 ? (
        <EmptyThreads />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {threads.map((t) => (
            <li key={t.id}>
              <ThreadRow thread={t} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ThreadRow({
  thread,
  onOpen,
}: {
  thread: ChatThreadDTO;
  onOpen: (args: { threadId: string; counterpartyId: string; counterpartyName: string; counterpartyRole: "consultant" | "taxpayer" }) => void;
}) {
  const initials = thread.counterpartyName
    .replace(/^CA\s+/i, "")
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <button
      type="button"
      onClick={() =>
        onOpen({
          threadId: thread.id,
          counterpartyId: thread.counterpartyId,
          counterpartyName: thread.counterpartyName,
          counterpartyRole: thread.counterpartyRole,
        })
      }
      className={cn(
        "group flex w-full items-center gap-3 rounded-xl border border-transparent px-2.5 py-2 text-left",
        "transition-colors hover:border-line hover:bg-surface-sunken/60",
      )}
    >
      <span
        aria-hidden
        className="relative flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-navy text-white text-sm font-semibold"
      >
        {initials || <Icon.User size={14} />}
        {thread.unread && (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface-raised bg-signal-success"
          />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p
            className={cn(
              "truncate text-sm tracking-[-0.005em] text-ink",
              thread.unread ? "font-semibold" : "font-medium",
            )}
          >
            {thread.counterpartyName}
          </p>
          {thread.lastMessageAt && (
            <span className="flex-shrink-0 text-2xs font-medium uppercase tracking-widest text-ink-subtle">
              {formatRelative(thread.lastMessageAt)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Badge tone="navy" size="sm">
            {thread.counterpartyRole === "consultant" ? "Consultant" : "Taxpayer"}
          </Badge>
          <p className="min-w-0 truncate text-xs text-ink-muted">
            {previewLine(thread)}
          </p>
        </div>
      </div>
    </button>
  );
}

function previewLine(t: ChatThreadDTO): string {
  if (t.lastMessagePreview) {
    return t.lastMessageMine ? `You: ${t.lastMessagePreview}` : t.lastMessagePreview;
  }
  if (t.hasAttachment) return "Attachment shared";
  return "No messages yet";
}

function EmptyThreads() {
  return (
    <div className="rounded-xl border border-dashed border-line bg-surface-sunken/40 px-4 py-6 text-center">
      <span
        aria-hidden
        className="mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-surface-raised text-navy"
      >
        <Icon.Chat size={14} />
      </span>
      <p className="mt-2 text-sm font-medium text-ink">No chats yet</p>
      <p className="mt-1 text-xs text-ink-muted text-pretty">
        Open a chat from one of your active connections to get started.
      </p>
    </div>
  );
}
