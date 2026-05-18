"use client";

import * as React from "react";
import { Icon } from "@/components/shared/Icon";
import { cn } from "@/lib/utils/cn";
import { useAuthStore } from "@/lib/store/auth-store";
import { askAssistant, AssistantError, type AssistantAnswer } from "@/lib/assistant/api";
import type { PageContext } from "@/lib/assistant/pageRegistry";

interface Turn {
  id: string;
  role: "user" | "assistant";
  body: string;
  citation?: string;
  kind?: AssistantAnswer["kind"];
}

interface AssistantPanelProps {
  open: boolean;
  onClose: () => void;
  onMinimize: () => void;
  page: PageContext;
}

const DEFAULT_SUGGESTIONS = [
  "Explain this screen",
  "What should I do next?",
  "What is CA linking?",
];

export function AssistantPanel({ open, onClose, onMinimize, page }: AssistantPanelProps) {
  const role = useAuthStore((s) => s.role);
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [draft, setDraft] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [suggestions, setSuggestions] = React.useState<string[]>(DEFAULT_SUGGESTIONS);

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  // Reset the thread whenever the user changes screens — context-bound chat
  // by design. Refill suggestions from the new page.
  React.useEffect(() => {
    setTurns([]);
    setError(null);
    setSuggestions(DEFAULT_SUGGESTIONS);
    abortRef.current?.abort();
  }, [page.id]);

  // Autoscroll on new turns.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [turns, pending]);

  // Focus the input when opened (after the open animation kicks in).
  React.useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 80);
    return () => window.clearTimeout(t);
  }, [open]);

  // ESC closes the panel.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onMinimize();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onMinimize]);

  const ask = React.useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || pending) return;

      const userTurn: Turn = {
        id: `u-${Date.now()}`,
        role: "user",
        body: q,
      };
      setTurns((prev) => [...prev, userTurn]);
      setDraft("");
      setError(null);
      setPending(true);

      abortRef.current?.abort();
      const ctl = new AbortController();
      abortRef.current = ctl;

      try {
        const res = await askAssistant({
          question: q,
          pageId: page.id,
          role: role ?? null,
          signal: ctl.signal,
        });
        const reply: Turn = {
          id: `a-${Date.now()}`,
          role: "assistant",
          body: res.answer,
          citation: res.citation,
          kind: res.kind,
        };
        setTurns((prev) => [...prev, reply]);
        if (Array.isArray(res.suggestions) && res.suggestions.length > 0) {
          setSuggestions(res.suggestions);
        }
      } catch (e) {
        if ((e as DOMException)?.name === "AbortError") return;
        setError(e instanceof AssistantError ? e.message : "I couldn't reach the help service — try again in a moment.");
      } finally {
        setPending(false);
      }
    },
    [page.id, pending, role],
  );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void ask(draft);
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="glimmora-assistant-title"
      data-testid="assistant-panel"
      style={{
        position: "fixed",
        right: "1.5rem",
        bottom: "1.5rem",
        zIndex: 50,
      }}
      className={cn(
        "flex w-[min(380px,calc(100vw-2rem))] flex-col",
        "max-h-[min(600px,calc(100dvh-6rem))] overflow-hidden",
        "rounded-2xl border border-line-strong bg-surface-raised shadow-elevated",
        "animate-scale-in",
      )}
    >
      <Header page={page} onClose={onClose} onMinimize={onMinimize} />

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-3"
        aria-live="polite"
      >
        {turns.length === 0 ? (
          <EmptyState page={page} />
        ) : (
          <ul className="flex flex-col gap-3">
            {turns.map((t) => (
              <li key={t.id} className={cn("flex", t.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[14px] leading-snug",
                    t.role === "user"
                      ? "bg-navy text-white"
                      : t.kind === "refusal"
                        ? "border border-signal-warning/35 bg-signal-warning-soft/60 text-ink"
                        : "border border-line-subtle bg-surface-sunken text-ink",
                  )}
                >
                  <p className="whitespace-pre-wrap break-words">{t.body}</p>
                  {t.role === "assistant" && t.citation && (
                    <p className="mt-2 flex items-center gap-1 text-[10.5px] uppercase tracking-[0.14em] text-ink-subtle">
                      <Icon.Info size={11} />
                      <span>Source · {t.citation}</span>
                    </p>
                  )}
                </div>
              </li>
            ))}
            {pending && (
              <li className="flex justify-start">
                <ThinkingBubble />
              </li>
            )}
          </ul>
        )}
      </div>

      {error && (
        <div className="border-t border-line-subtle bg-signal-error-soft px-4 py-2 text-xs text-signal-error">
          {error}
        </div>
      )}

      {suggestions.length > 0 && (
        <SuggestionChips
          chips={suggestions}
          disabled={pending}
          onPick={(c) => void ask(c)}
        />
      )}

      <form
        onSubmit={onSubmit}
        className="flex items-end gap-2 border-t border-line-subtle bg-surface-raised px-3 py-3"
      >
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void ask(draft);
            }
          }}
          placeholder={`Ask about ${page.label.toLowerCase()}…`}
          rows={1}
          maxLength={500}
          disabled={pending}
          className={cn(
            "block min-h-[40px] max-h-32 w-full resize-none rounded-lg border border-line-strong bg-surface-raised px-3 py-2 text-[14px] text-ink",
            "placeholder:text-ink-subtle/80 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20",
            "disabled:opacity-60",
          )}
        />
        <button
          type="submit"
          disabled={!draft.trim() || pending}
          aria-label="Send"
          className={cn(
            "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg",
            "bg-navy text-white hover:bg-navy-deep",
            "disabled:bg-line-strong disabled:text-ink-subtle",
          )}
        >
          <Icon.Send size={14} />
        </button>
      </form>
      <p className="px-4 pb-2 text-[10.5px] uppercase tracking-[0.14em] text-ink-subtle">
        Help · {page.section}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Header({
  page,
  onClose,
  onMinimize,
}: {
  page: PageContext;
  onClose: () => void;
  onMinimize: () => void;
}) {
  return (
    <header className="flex items-start justify-between gap-3 border-b border-line-subtle bg-surface-raised px-4 py-3">
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-navy text-white shadow-sm"
        >
          <Icon.Sparkle size={15} />
        </span>
        <div className="min-w-0">
          <h2
            id="glimmora-assistant-title"
            className="font-display text-[17px] leading-tight text-ink"
          >
            Glimmora Assistant
          </h2>
          <p className="mt-0.5 truncate text-[11px] uppercase tracking-[0.14em] text-ink-subtle">
            {page.section} · {page.label}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onMinimize}
          aria-label="Minimise assistant"
          className="rounded-md p-1.5 text-ink-muted hover:bg-surface-sunken hover:text-ink"
        >
          <Icon.ChevronRight size={14} className="rotate-90" />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close assistant"
          className="rounded-md p-1.5 text-ink-muted hover:bg-surface-sunken hover:text-ink"
        >
          <Icon.X size={14} />
        </button>
      </div>
    </header>
  );
}

function EmptyState({ page }: { page: PageContext }) {
  return (
    <div className="flex flex-col gap-3 py-2">
      <div className="rounded-xl border border-line-subtle bg-surface-sunken/60 px-3.5 py-3">
        <p className="text-[14px] leading-snug text-ink">
          Hi — I&apos;m your Glimmora Tax assistant. I can explain what this
          screen does, what each field means, and what to do next.
        </p>
        <p className="mt-2 text-[12px] text-ink-muted">
          I answer in plain language and tell you where each answer comes from.
        </p>
      </div>
      <p className="text-[10.5px] uppercase tracking-[0.14em] text-ink-subtle">
        Try asking · {page.label}
      </p>
    </div>
  );
}

function SuggestionChips({
  chips,
  disabled,
  onPick,
}: {
  chips: string[];
  disabled: boolean;
  onPick: (chip: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5 border-t border-line-subtle bg-surface-sunken/40 px-3 py-2.5">
      {chips.slice(0, 4).map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onPick(c)}
          disabled={disabled}
          className={cn(
            "rounded-full border border-line bg-surface-raised px-3 py-1 text-[12px] text-ink",
            "hover:border-navy/40 hover:bg-navy-tint/60 hover:text-navy-deep",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          {c}
        </button>
      ))}
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div className="flex items-center gap-1.5 rounded-2xl border border-line-subtle bg-surface-sunken px-3.5 py-2.5">
      <span className="block h-1.5 w-1.5 animate-soft-pulse rounded-full bg-ink-subtle" />
      <span
        className="block h-1.5 w-1.5 animate-soft-pulse rounded-full bg-ink-subtle"
        style={{ animationDelay: "180ms" }}
      />
      <span
        className="block h-1.5 w-1.5 animate-soft-pulse rounded-full bg-ink-subtle"
        style={{ animationDelay: "360ms" }}
      />
    </div>
  );
}
