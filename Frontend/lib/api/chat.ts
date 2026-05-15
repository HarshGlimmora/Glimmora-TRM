/**
 * Browser-side client for the chat APIs.
 *
 * Mirrors the shape returned by `chatService` in
 * `Frontend/lib/server/services/chat.ts`. All requests run with
 * `credentials: same-origin` so the httpOnly session cookie is forwarded.
 */

export type ChatReactionEmoji = "like" | "heart" | "thumbs_up";

export interface ChatThreadDTO {
  id: string;
  consultantId: string;
  taxpayerId: string;
  counterpartyId: string;
  counterpartyName: string;
  counterpartyRole: "consultant" | "taxpayer";
  myRole: "consultant" | "taxpayer";
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastMessageMine: boolean;
  hasAttachment: boolean;
  unread: boolean;
  createdAt: string;
}

export interface ChatAttachmentDTO {
  id: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  downloadUrl: string;
}

export interface ChatReactionAggregateDTO {
  emoji: ChatReactionEmoji;
  count: number;
  mine: boolean;
  userIds: string[];
}

export interface ChatMessageDTO {
  id: string;
  threadId: string;
  senderId: string;
  mine: boolean;
  body: string | null;
  createdAt: string;
  attachments: ChatAttachmentDTO[];
  reactions: ChatReactionAggregateDTO[];
}

async function readError(res: Response): Promise<Error & { code?: string; status: number }> {
  let parsed: { error?: string; code?: string } | null = null;
  try {
    parsed = (await res.json()) as { error?: string; code?: string };
  } catch {
    /* keep null */
  }
  const message = parsed?.error ?? `Request failed (${res.status})`;
  const err = new Error(message) as Error & { code?: string; status: number };
  err.code = parsed?.code;
  err.status = res.status;
  return err;
}

export async function listChatThreads(): Promise<ChatThreadDTO[]> {
  const res = await fetch("/api/chat/threads", {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!res.ok) throw await readError(res);
  const data = (await res.json()) as { threads: ChatThreadDTO[] };
  return data.threads;
}

export async function openChatThread(
  counterpartyId: string,
): Promise<{ id: string }> {
  const res = await fetch("/api/chat/threads", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ counterpartyId }),
  });
  if (!res.ok) throw await readError(res);
  const data = (await res.json()) as { thread: { id: string } };
  return data.thread;
}

export async function listChatMessages(
  threadId: string,
  opts?: { after?: string },
): Promise<ChatMessageDTO[]> {
  const url = new URL(`/api/chat/threads/${threadId}/messages`, window.location.origin);
  if (opts?.after) url.searchParams.set("after", opts.after);
  const res = await fetch(url.toString().replace(window.location.origin, ""), {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!res.ok) throw await readError(res);
  const data = (await res.json()) as { messages: ChatMessageDTO[] };
  return data.messages;
}

export async function sendChatMessage(
  threadId: string,
  body: string,
): Promise<ChatMessageDTO> {
  const res = await fetch(`/api/chat/threads/${threadId}/messages`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw await readError(res);
  const data = (await res.json()) as { message: ChatMessageDTO };
  return data.message;
}

export async function sendChatAttachments(
  threadId: string,
  files: File[],
  body?: string,
): Promise<ChatMessageDTO> {
  const fd = new FormData();
  for (const f of files) fd.append("files", f, f.name);
  if (body && body.trim().length > 0) fd.append("body", body);
  const res = await fetch(`/api/chat/threads/${threadId}/attachments`, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    body: fd,
  });
  if (!res.ok) throw await readError(res);
  const data = (await res.json()) as { message: ChatMessageDTO };
  return data.message;
}

export async function toggleChatReaction(
  messageId: string,
  emoji: ChatReactionEmoji,
): Promise<{ added: boolean }> {
  const res = await fetch(`/api/chat/messages/${messageId}/reactions`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ emoji }),
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as { added: boolean };
}

export async function markChatThreadRead(threadId: string): Promise<void> {
  await fetch(`/api/chat/threads/${threadId}/read`, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
  });
}
