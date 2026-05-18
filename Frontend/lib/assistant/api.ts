"use client";

import type { AssistantPageId } from "@/lib/assistant/pageRegistry";

export type AssistantAnswerKind = "answer" | "refusal" | "miss";

export interface AssistantAnswer {
  answer: string;
  citation: string;
  kind: AssistantAnswerKind;
  page: { id: string; label: string; section: string };
  suggestions: string[];
}

export interface AskOptions {
  question: string;
  pageId: AssistantPageId;
  role: "taxpayer" | "consultant" | null;
  signal?: AbortSignal;
}

/**
 * Ask the assistant a question. The body shape mirrors FastAPI's pydantic
 * schema (snake_case keys). The Next.js proxy at /api/assistant/answer
 * forwards verbatim to /api/v1/chatbot/answer.
 */
export async function askAssistant(opts: AskOptions): Promise<AssistantAnswer> {
  const res = await fetch("/api/assistant/answer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    signal: opts.signal,
    body: JSON.stringify({
      question: opts.question,
      page_id: opts.pageId,
      role: opts.role,
    }),
  });

  if (!res.ok) {
    const err = await safeReadError(res);
    throw new AssistantError(err);
  }

  const data = (await res.json()) as AssistantAnswer;
  return data;
}

export class AssistantError extends Error {}

async function safeReadError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { message?: string; detail?: { message?: string } };
    return (
      data.message ??
      data.detail?.message ??
      `Assistant unreachable (${res.status}).`
    );
  } catch {
    return `Assistant unreachable (${res.status}).`;
  }
}
