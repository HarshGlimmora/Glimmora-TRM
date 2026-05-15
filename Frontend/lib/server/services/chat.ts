/**
 * Chat service.
 *
 * Sits between API routes and the chat repo. Owns:
 *   - the "you must share an active grant" gate before opening a thread
 *   - on-disk attachment storage (Frontend/.data/chat-attachments/)
 *   - DTO shaping so route handlers stay thin
 *
 * Real-time is intentionally out of scope here — the client polls
 * `/api/chat/threads/[id]/messages?after=…`. That keeps deploys simple and
 * the request budget predictable; it can be swapped for SSE/WebSockets
 * later without touching the schema.
 */
import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { withTransaction } from "@/lib/server/db/client";
import { caGrantsRepo } from "@/lib/server/repos/links";
import {
  chatRepo,
  type ChatAttachmentRow,
  type ChatMessageRow,
  type ChatReactionEmoji,
  type ChatThreadListRow,
  type ChatThreadRow,
} from "@/lib/server/repos/chat";
import { auditRepo } from "@/lib/server/repos/audit";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "@/lib/server/services/auth";
import { usersRepo } from "@/lib/server/repos/identity";

/** 10 MB cap, matches the existing document-upload limit. */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
/** Allow-list of MIME types we accept in chat attachments. */
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/csv",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.ms-excel",
  "application/zip",
]);
const REACTION_EMOJI: ChatReactionEmoji[] = ["like", "heart", "thumbs_up"];

export interface ThreadDTO {
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

export interface MessageDTO {
  id: string;
  threadId: string;
  senderId: string;
  mine: boolean;
  body: string | null;
  createdAt: string;
  attachments: AttachmentDTO[];
  reactions: ReactionAggregateDTO[];
}

export interface AttachmentDTO {
  id: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  downloadUrl: string;
}

export interface ReactionAggregateDTO {
  emoji: ChatReactionEmoji;
  count: number;
  mine: boolean;
  userIds: string[];
}

function storageRoot(): string {
  return path.resolve(process.cwd(), ".data", "chat-attachments");
}

/** Defence in depth — strip path separators and trim to a safe length. */
function safeBaseName(name: string): string {
  const cleaned = name
    .replace(/[\\/]/g, "_")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim();
  const out = cleaned.length > 0 ? cleaned : "file";
  return out.length > 200 ? out.slice(0, 200) : out;
}

async function writeAttachmentToDisk(args: {
  storageKey: string;
  fileName: string;
  bytes: Buffer;
}): Promise<void> {
  const dir = path.join(storageRoot(), args.storageKey);
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, safeBaseName(args.fileName));
  await fs.writeFile(target, args.bytes);
}

async function readAttachmentFromDisk(args: {
  storageKey: string;
  fileName: string;
}): Promise<Buffer> {
  const target = path.join(storageRoot(), args.storageKey, safeBaseName(args.fileName));
  return fs.readFile(target);
}

function aggregateReactions(
  rows: { message_id: string; user_id: string; emoji: ChatReactionEmoji }[],
  myUserId: string,
): Map<string, ReactionAggregateDTO[]> {
  const out = new Map<string, ReactionAggregateDTO[]>();
  for (const r of rows) {
    const list = out.get(r.message_id) ?? [];
    let agg = list.find((a) => a.emoji === r.emoji);
    if (!agg) {
      agg = { emoji: r.emoji, count: 0, mine: false, userIds: [] };
      list.push(agg);
    }
    agg.count += 1;
    agg.userIds.push(r.user_id);
    if (r.user_id === myUserId) agg.mine = true;
    out.set(r.message_id, list);
  }
  return out;
}

function messageToDto(args: {
  row: ChatMessageRow;
  attachments: ChatAttachmentRow[];
  reactions: ReactionAggregateDTO[];
  myUserId: string;
}): MessageDTO {
  return {
    id: args.row.id,
    threadId: args.row.thread_id,
    senderId: args.row.sender_id,
    mine: args.row.sender_id === args.myUserId,
    body: args.row.deleted_at ? null : args.row.body,
    createdAt: args.row.created_at,
    attachments: args.attachments.map((a) => ({
      id: a.id,
      fileName: a.file_name,
      mimeType: a.mime_type,
      byteSize: a.byte_size,
      downloadUrl: `/api/chat/attachments/${a.id}/download`,
    })),
    reactions: args.reactions,
  };
}

function threadToDto(row: ChatThreadListRow, myUserId: string): ThreadDTO {
  const myRole: "consultant" | "taxpayer" =
    row.consultant_id === myUserId ? "consultant" : "taxpayer";
  const counterpartyName =
    row.counterparty_display_name ?? row.counterparty_name ?? "User";
  const lastBody = row.last_body ?? null;
  const preview = lastBody
    ? lastBody.length > 120
      ? lastBody.slice(0, 117) + "…"
      : lastBody
    : row.last_has_attachment
      ? "Attachment"
      : null;
  const unread = Boolean(
    row.last_message_at &&
      row.last_sender_id !== myUserId &&
      (!row.last_read_at || row.last_read_at < row.last_message_at),
  );
  return {
    id: row.id,
    consultantId: row.consultant_id,
    taxpayerId: row.taxpayer_id,
    counterpartyId: row.counterparty_id,
    counterpartyName,
    counterpartyRole: row.counterparty_role,
    myRole,
    lastMessageAt: row.last_message_at,
    lastMessagePreview: preview,
    lastMessageMine: row.last_sender_id === myUserId,
    hasAttachment: row.last_has_attachment,
    unread,
    createdAt: row.created_at,
  };
}

export const chatService = {
  MAX_ATTACHMENT_BYTES,
  ALLOWED_MIME,
  REACTION_EMOJI,

  async listMyThreads(userId: string): Promise<ThreadDTO[]> {
    const rows = await chatRepo.listThreadsForUser(userId);
    return rows.map((r) => threadToDto(r, userId));
  },

  /**
   * Open or fetch the thread between me and `counterpartyId`. Requires an
   * active grant between the two (in either direction). Idempotent.
   */
  async openThread(args: {
    actorUserId: string;
    actorRole: "consultant" | "taxpayer";
    counterpartyId: string;
  }): Promise<ChatThreadRow> {
    if (args.actorUserId === args.counterpartyId) {
      throw new BadRequestError("CHAT_SELF", "You can't chat with yourself.");
    }
    const counterparty = await usersRepo.findById(args.counterpartyId);
    if (!counterparty) {
      throw new NotFoundError("USER_NOT_FOUND", "That user no longer exists.");
    }
    // Counterparty must hold the opposite role for the canonical pair.
    let consultantId: string;
    let taxpayerId: string;
    if (args.actorRole === "consultant") {
      consultantId = args.actorUserId;
      taxpayerId = args.counterpartyId;
    } else {
      consultantId = args.counterpartyId;
      taxpayerId = args.actorUserId;
    }
    // Permission gate: we only let two parties chat when they share a live
    // (pending OR active) grant. Pending lets the requested CA introduce
    // themselves before formally accepting; once revoked/expired the chat
    // is locked and the UI doesn't surface a "chat" button anyway.
    const grant = await caGrantsRepo.findLiveBetween(consultantId, taxpayerId);
    if (!grant) {
      throw new ForbiddenError(
        "CHAT_NO_GRANT",
        "You can only chat with users you have an active connection with.",
      );
    }
    return chatRepo.getOrCreateThread({
      consultantId,
      taxpayerId,
      grantId: grant.id,
    });
  },

  async getThreadOr403(threadId: string, userId: string): Promise<ChatThreadRow> {
    const allowed = await chatRepo.userCanAccessThread(threadId, userId);
    if (!allowed) {
      throw new ForbiddenError("CHAT_FORBIDDEN", "You don't have access to this chat.");
    }
    const thread = await chatRepo.findThreadById(threadId);
    if (!thread) {
      throw new NotFoundError("CHAT_NOT_FOUND", "That chat does not exist.");
    }
    return thread;
  },

  async listMessages(args: {
    threadId: string;
    userId: string;
    after?: string | null;
  }): Promise<MessageDTO[]> {
    await this.getThreadOr403(args.threadId, args.userId);
    const rows = await chatRepo.listMessages({
      threadId: args.threadId,
      after: args.after ?? null,
    });
    const ids = rows.map((r) => r.id);
    const [attachments, reactions] = await Promise.all([
      chatRepo.listAttachmentsForMessages(ids),
      chatRepo.listReactionsForMessages(ids),
    ]);
    const attachIndex = new Map<string, ChatAttachmentRow[]>();
    for (const a of attachments) {
      const list = attachIndex.get(a.message_id) ?? [];
      list.push(a);
      attachIndex.set(a.message_id, list);
    }
    const reactionIndex = aggregateReactions(reactions, args.userId);
    return rows.map((row) =>
      messageToDto({
        row,
        attachments: attachIndex.get(row.id) ?? [],
        reactions: reactionIndex.get(row.id) ?? [],
        myUserId: args.userId,
      }),
    );
  },

  async sendTextMessage(args: {
    threadId: string;
    userId: string;
    body: string;
  }): Promise<MessageDTO> {
    await this.getThreadOr403(args.threadId, args.userId);
    const body = sanitizeChatBody(args.body);
    if (!body) {
      throw new BadRequestError("CHAT_EMPTY", "Type a message before sending.");
    }
    const row = await withTransaction(async (client) => {
      const msg = await chatRepo.insertMessage(
        { threadId: args.threadId, senderId: args.userId, body },
        client,
      );
      await chatRepo.touchThreadLastMessage(args.threadId, msg.created_at, client);
      return msg;
    });
    await chatRepo.markThreadRead(args.threadId, args.userId);
    return messageToDto({
      row,
      attachments: [],
      reactions: [],
      myUserId: args.userId,
    });
  },

  /**
   * Multipart upload entry point. Validates each file against the allow-list,
   * persists bytes to disk, then creates one message row with one or more
   * attachments. `body` may be empty when only files are sent.
   */
  async sendAttachmentsMessage(args: {
    threadId: string;
    userId: string;
    body: string | null;
    files: { fileName: string; mimeType: string; bytes: Buffer }[];
  }): Promise<MessageDTO> {
    await this.getThreadOr403(args.threadId, args.userId);
    if (args.files.length === 0) {
      throw new BadRequestError("CHAT_NO_FILES", "Attach at least one file.");
    }
    for (const f of args.files) {
      if (f.bytes.length === 0) {
        throw new BadRequestError("CHAT_FILE_EMPTY", `Empty file: ${f.fileName}.`);
      }
      if (f.bytes.length > MAX_ATTACHMENT_BYTES) {
        throw new BadRequestError(
          "CHAT_FILE_TOO_LARGE",
          `${f.fileName} is larger than 10 MB.`,
        );
      }
      if (!ALLOWED_MIME.has(f.mimeType)) {
        throw new BadRequestError(
          "CHAT_FILE_TYPE",
          `${f.fileName} is not a supported file type.`,
        );
      }
    }
    const body = args.body ? sanitizeChatBody(args.body) : null;

    const result = await withTransaction(async (client) => {
      const msg = await chatRepo.insertMessage(
        { threadId: args.threadId, senderId: args.userId, body },
        client,
      );
      const attachments: ChatAttachmentRow[] = [];
      for (const f of args.files) {
        const storageKey = crypto.randomUUID();
        await writeAttachmentToDisk({
          storageKey,
          fileName: f.fileName,
          bytes: f.bytes,
        });
        const row = await chatRepo.insertAttachment(
          {
            messageId: msg.id,
            fileName: safeBaseName(f.fileName),
            mimeType: f.mimeType,
            byteSize: f.bytes.length,
            storageKey,
          },
          client,
        );
        attachments.push(row);
      }
      await chatRepo.touchThreadLastMessage(args.threadId, msg.created_at, client);
      return { msg, attachments };
    });

    await chatRepo.markThreadRead(args.threadId, args.userId);
    // Best-effort audit row — keeps the file-share auditable per spec §10.
    await auditRepo.write({
      actorUserId: args.userId,
      action: "chat_attachment_shared",
      entityType: "chat_messages",
      entityId: result.msg.id,
      metadata: {
        threadId: args.threadId,
        files: result.attachments.map((a) => ({
          name: a.file_name,
          size: a.byte_size,
          mime: a.mime_type,
        })),
      },
    });

    return messageToDto({
      row: result.msg,
      attachments: result.attachments,
      reactions: [],
      myUserId: args.userId,
    });
  },

  async toggleReaction(args: {
    messageId: string;
    userId: string;
    emoji: string;
  }): Promise<{ added: boolean }> {
    if (!REACTION_EMOJI.includes(args.emoji as ChatReactionEmoji)) {
      throw new BadRequestError("CHAT_REACTION_INVALID", "Unsupported reaction.");
    }
    const msg = await chatRepo.findMessageById(args.messageId);
    if (!msg) {
      throw new NotFoundError("CHAT_MSG_NOT_FOUND", "Message not found.");
    }
    await this.getThreadOr403(msg.thread_id, args.userId);
    return chatRepo.toggleReaction({
      messageId: msg.id,
      userId: args.userId,
      emoji: args.emoji as ChatReactionEmoji,
    });
  },

  async markRead(threadId: string, userId: string): Promise<void> {
    await this.getThreadOr403(threadId, userId);
    await chatRepo.markThreadRead(threadId, userId);
  },

  async downloadAttachment(attachmentId: string, userId: string): Promise<{
    bytes: Buffer;
    mimeType: string;
    fileName: string;
  }> {
    const att = await chatRepo.findAttachmentById(attachmentId);
    if (!att) {
      throw new NotFoundError("CHAT_FILE_NOT_FOUND", "File not found.");
    }
    const msg = await chatRepo.findMessageById(att.message_id);
    if (!msg) {
      throw new NotFoundError("CHAT_FILE_NOT_FOUND", "File not found.");
    }
    await this.getThreadOr403(msg.thread_id, userId);
    const bytes = await readAttachmentFromDisk({
      storageKey: att.storage_key,
      fileName: att.file_name,
    });
    return { bytes, mimeType: att.mime_type, fileName: att.file_name };
  },
};

/** Strip control chars and rudimentary HTML; cap at 4000 chars per send. */
export function sanitizeChatBody(input: string): string {
  return String(input ?? "")
    .normalize("NFC")
    // strip C0/C1 control chars except newline and tab
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .trim()
    .slice(0, 4000);
}
