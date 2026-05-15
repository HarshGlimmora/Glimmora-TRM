"use client";

import * as React from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";
import { Icon } from "@/components/shared/Icon";
import { cn } from "@/lib/utils/cn";
import { formatRelative } from "@/lib/utils/format";
import {
  listChatMessages,
  markChatThreadRead,
  sendChatAttachments,
  sendChatMessage,
  toggleChatReaction,
  type ChatMessageDTO,
  type ChatReactionEmoji,
} from "@/lib/api/chat";

const POLL_INTERVAL_MS = 3000;
const REACTION_BAR: { emoji: ChatReactionEmoji; icon: React.ReactNode; label: string }[] = [
  { emoji: "like", icon: <Icon.Star size={11} />, label: "Like" },
  { emoji: "heart", icon: <Icon.Heart size={11} />, label: "Heart" },
  { emoji: "thumbs_up", icon: <Icon.ThumbsUp size={11} />, label: "Thumbs up" },
];

const ALLOWED_EXTENSIONS = [
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".csv",
  ".txt",
  ".xlsx",
  ".xls",
  ".docx",
  ".doc",
  ".zip",
];

export interface ChatPeer {
  id: string;
  name: string;
  role: "consultant" | "taxpayer";
  subline?: string | null;
}

export function ChatDrawer({
  open,
  onClose,
  threadId,
  peer,
  onActivity,
}: {
  open: boolean;
  onClose: () => void;
  threadId: string | null;
  peer: ChatPeer | null;
  /** Fired any time the drawer mutates server state — parents use this to
   *  refresh the thread list (preview, unread, last-active time). */
  onActivity?: () => void;
}) {
  const [messages, setMessages] = React.useState<ChatMessageDTO[]>([]);
  const [draft, setDraft] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const lastSeenAtRef = React.useRef<string | null>(null);
  // Stash the latest onActivity in a ref so the load/poll effects don't
  // re-run every time the parent passes a new closure. Without this, each
  // `onActivity?.()` call (which often updates parent state) causes the
  // drawer to teardown + re-fetch and visibly flashes "Loading…".
  const onActivityRef = React.useRef(onActivity);
  React.useEffect(() => {
    onActivityRef.current = onActivity;
  }, [onActivity]);
  const notifyActivity = React.useCallback(() => {
    onActivityRef.current?.();
  }, []);

  const scrollToBottom = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Defer so the freshly rendered message is in the DOM.
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, []);

  // Initial load + reset on thread change.
  React.useEffect(() => {
    if (!open || !threadId) return;
    let cancelled = false;
    setLoading(true);
    setMessages([]);
    setError(null);
    lastSeenAtRef.current = null;
    (async () => {
      try {
        const list = await listChatMessages(threadId);
        if (cancelled) return;
        setMessages(list);
        lastSeenAtRef.current = list.length
          ? list[list.length - 1]!.createdAt
          : null;
        scrollToBottom();
        try {
          await markChatThreadRead(threadId);
          notifyActivity();
        } catch {
          /* non-fatal */
        }
      } catch (err: unknown) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load chat.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, threadId, scrollToBottom, notifyActivity]);

  // Poll for new messages while the drawer is open. We send `after` so the
  // server only returns the tail — cheap to poll.
  React.useEffect(() => {
    if (!open || !threadId) return;
    let stopped = false;
    const tick = async () => {
      if (stopped || !threadId) return;
      try {
        const tail = await listChatMessages(threadId, {
          after: lastSeenAtRef.current ?? undefined,
        });
        if (stopped) return;
        if (tail.length > 0) {
          setMessages((prev) => mergeMessages(prev, tail));
          lastSeenAtRef.current = tail[tail.length - 1]!.createdAt;
          scrollToBottom();
          try {
            await markChatThreadRead(threadId);
            notifyActivity();
          } catch {
            /* non-fatal */
          }
        }
      } catch {
        /* swallow: we'll retry on next tick */
      }
    };
    const id = window.setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [open, threadId, scrollToBottom, notifyActivity]);

  // ESC to close.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const handleSendText = async () => {
    const body = draft.trim();
    if (!threadId || !body || sending) return;
    setSending(true);
    setError(null);
    try {
      const msg = await sendChatMessage(threadId, body);
      setMessages((prev) => mergeMessages(prev, [msg]));
      lastSeenAtRef.current = msg.createdAt;
      setDraft("");
      scrollToBottom();
      notifyActivity();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not send.");
    } finally {
      setSending(false);
    }
  };

  const handleFiles = async (files: FileList | null) => {
    if (!threadId || !files || files.length === 0) return;
    setSending(true);
    setError(null);
    try {
      const arr = Array.from(files);
      const msg = await sendChatAttachments(threadId, arr, draft.trim() || undefined);
      setMessages((prev) => mergeMessages(prev, [msg]));
      lastSeenAtRef.current = msg.createdAt;
      setDraft("");
      scrollToBottom();
      notifyActivity();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not attach files.");
    } finally {
      setSending(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleReact = async (messageId: string, emoji: ChatReactionEmoji) => {
    setError(null);
    // Optimistic update so the reaction feels instant.
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId) return m;
        const existing = m.reactions.find((r) => r.emoji === emoji);
        if (existing?.mine) {
          const reactions = m.reactions
            .map((r) =>
              r.emoji === emoji
                ? { ...r, count: r.count - 1, mine: false }
                : r,
            )
            .filter((r) => r.count > 0);
          return { ...m, reactions };
        }
        const reactions = existing
          ? m.reactions.map((r) =>
              r.emoji === emoji ? { ...r, count: r.count + 1, mine: true } : r,
            )
          : [
              ...m.reactions,
              { emoji, count: 1, mine: true, userIds: [] },
            ];
        return { ...m, reactions };
      }),
    );
    try {
      await toggleChatReaction(messageId, emoji);
      notifyActivity();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not react.");
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="chat-drawer-title"
      className="fixed inset-0 z-50"
    >
      <div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 bg-navy-deep/40 backdrop-blur-sm animate-fade-in"
      />
      <aside
        className="absolute right-0 top-0 flex h-dvh w-full max-w-[460px] flex-col border-l border-line-strong bg-surface-raised shadow-elevated animate-slide-in-right"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line-subtle px-5 pb-4 pt-5">
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-navy text-white text-sm font-semibold"
            >
              {peer ? initials(peer.name) : <Icon.User size={16} />}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2
                  id="chat-drawer-title"
                  className="truncate text-base font-semibold tracking-[-0.005em] text-ink"
                >
                  {peer?.name ?? "Chat"}
                </h2>
                {peer && (
                  <Badge tone="navy" size="sm">
                    {peer.role === "consultant" ? "Consultant" : "Taxpayer"}
                  </Badge>
                )}
              </div>
              {peer?.subline && (
                <p className="mt-0.5 truncate text-xs text-ink-muted">{peer.subline}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close chat"
            className="rounded-md p-1.5 text-ink-muted hover:bg-surface-sunken hover:text-ink"
          >
            <Icon.X size={16} />
          </button>
        </header>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-5 py-4"
          aria-live="polite"
        >
          {loading ? (
            <p className="text-sm text-ink-muted">Loading conversation…</p>
          ) : messages.length === 0 ? (
            <EmptyConversation />
          ) : (
            <ul className="flex flex-col gap-3">
              {messages.map((m, idx) => {
                const prev = messages[idx - 1] ?? null;
                const showHeader =
                  !prev ||
                  prev.senderId !== m.senderId ||
                  diffMinutes(prev.createdAt, m.createdAt) > 5;
                return (
                  <MessageRow
                    key={m.id}
                    msg={m}
                    showHeader={showHeader}
                    onReact={(e) => handleReact(m.id, e)}
                  />
                );
              })}
            </ul>
          )}
        </div>

        {error && (
          <div className="border-t border-line-subtle bg-signal-error-soft px-5 py-2">
            <Alert tone="error" compact>
              {error}
            </Alert>
          </div>
        )}

        <footer className="border-t border-line-subtle bg-surface-raised px-4 py-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSendText();
            }}
            className="flex items-end gap-2"
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ALLOWED_EXTENSIONS.join(",")}
              className="hidden"
              onChange={(e) => void handleFiles(e.target.files)}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending}
              aria-label="Attach files"
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-line-strong bg-surface-raised text-ink-muted hover:text-ink hover:bg-surface-sunken disabled:opacity-50"
            >
              <Icon.Paperclip size={16} />
            </button>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSendText();
                }
              }}
              placeholder="Type a message…"
              rows={1}
              maxLength={4000}
              className="block min-h-[40px] max-h-32 w-full resize-y rounded-lg border border-line-strong bg-surface-raised px-3 py-2 text-[15px] text-ink placeholder:text-ink-subtle/80 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
            <Button
              type="submit"
              size="md"
              disabled={!draft.trim() || sending}
              loading={sending}
              leftIcon={<Icon.Send size={14} />}
            >
              Send
            </Button>
          </form>
          <p className="mt-1.5 text-2xs text-ink-subtle">
            Enter to send · Shift+Enter for new line · Files capped at 10 MB
          </p>
        </footer>
      </aside>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function MessageRow({
  msg,
  showHeader,
  onReact,
}: {
  msg: ChatMessageDTO;
  showHeader: boolean;
  onReact: (emoji: ChatReactionEmoji) => void;
}) {
  const mine = msg.mine;
  return (
    <li
      className={cn(
        "group flex w-full",
        mine ? "justify-end" : "justify-start",
      )}
    >
      <div
        className={cn(
          "flex max-w-[82%] flex-col gap-1",
          mine ? "items-end" : "items-start",
        )}
      >
        {showHeader && (
          <span
            className={cn(
              "text-2xs font-medium uppercase tracking-widest text-ink-subtle",
              mine && "text-right",
            )}
          >
            {mine ? "You" : "Them"} · {formatRelative(msg.createdAt)}
          </span>
        )}
        <div
          className={cn(
            "relative rounded-2xl px-3.5 py-2.5 text-[15px] text-pretty",
            mine
              ? "bg-navy text-white"
              : "border border-line-subtle bg-surface-sunken text-ink",
          )}
        >
          {msg.body && (
            <p className="whitespace-pre-wrap break-words">{msg.body}</p>
          )}
          {msg.attachments.length > 0 && (
            <ul
              className={cn(
                "flex flex-col gap-1.5",
                msg.body && "mt-2",
              )}
            >
              {msg.attachments.map((a) => (
                <li key={a.id}>
                  <a
                    href={a.downloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                      mine
                        ? "border-white/20 bg-white/10 text-white hover:bg-white/20"
                        : "border-line bg-surface-raised text-ink hover:bg-surface-sunken",
                    )}
                  >
                    <Icon.Doc size={14} />
                    <span className="min-w-0 flex-1 truncate">{a.fileName}</span>
                    <span
                      className={cn(
                        "text-2xs",
                        mine ? "text-white/70" : "text-ink-muted",
                      )}
                    >
                      {humanBytes(a.byteSize)}
                    </span>
                    <Icon.Download size={12} className="flex-shrink-0" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {msg.reactions.length > 0 && (
            <ul className="flex items-center gap-1">
              {msg.reactions.map((r) => (
                <li key={r.emoji}>
                  <button
                    type="button"
                    onClick={() => onReact(r.emoji)}
                    aria-label={`${r.emoji.replace("_", " ")} reaction`}
                    aria-pressed={r.mine}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-2xs font-medium tabular",
                      r.mine
                        ? "border-navy/40 bg-navy/5 text-navy"
                        : "border-line bg-surface-raised text-ink-muted hover:bg-surface-sunken",
                    )}
                  >
                    <ReactionIcon emoji={r.emoji} />
                    <span>{r.count}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div
            className={cn(
              "opacity-0 transition-opacity group-hover:opacity-100",
              "focus-within:opacity-100",
            )}
          >
            <ul className="flex items-center gap-1">
              {REACTION_BAR.map((r) => (
                <li key={r.emoji}>
                  <button
                    type="button"
                    onClick={() => onReact(r.emoji)}
                    aria-label={`React ${r.label}`}
                    className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-line bg-surface-raised text-ink-muted hover:text-ink hover:bg-surface-sunken"
                  >
                    {r.icon}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </li>
  );
}

function ReactionIcon({ emoji }: { emoji: ChatReactionEmoji }) {
  if (emoji === "heart") return <Icon.Heart size={10} />;
  if (emoji === "thumbs_up") return <Icon.ThumbsUp size={10} />;
  return <Icon.Star size={10} />;
}

function EmptyConversation() {
  return (
    <div className="grid h-full place-items-center">
      <div className="flex max-w-xs flex-col items-center gap-2 text-center">
        <span
          aria-hidden
          className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface-sunken text-navy"
        >
          <Icon.Chat size={16} />
        </span>
        <p className="text-sm font-medium text-ink">No messages yet</p>
        <p className="text-xs text-ink-muted">
          Say hi, share a document, or ask a quick question. Both sides see
          everything you send here.
        </p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  helpers                                                                   */
/* -------------------------------------------------------------------------- */

function mergeMessages(
  prev: ChatMessageDTO[],
  incoming: ChatMessageDTO[],
): ChatMessageDTO[] {
  if (incoming.length === 0) return prev;
  const byId = new Map(prev.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return Array.from(byId.values()).sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0,
  );
}

function diffMinutes(a: string, b: string): number {
  return Math.abs((new Date(b).getTime() - new Date(a).getTime()) / 60_000);
}

function initials(name: string): string {
  return name
    .replace(/^CA\s+/i, "")
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
