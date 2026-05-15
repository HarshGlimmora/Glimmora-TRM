/**
 * Persistence for the 1:1 chat between a consultant and a taxpayer.
 *
 * Thread identity is the unordered pair (consultantId, taxpayerId) — guarded
 * by `uq_chat_thread_pair`. `getOrCreate` is the only entry point that
 * mints rows so we don't end up with two threads for the same pair.
 *
 * Reactions are constrained at the DB level to a small allow-list so the
 * UI never has to render arbitrary unicode.
 */
import "server-only";
import { query, type DbClient } from "@/lib/server/db/client";

export type ChatRole = "consultant" | "taxpayer";

export interface ChatThreadRow {
  id: string;
  consultant_id: string;
  taxpayer_id: string;
  grant_id: string | null;
  created_at: string;
  last_message_at: string | null;
}

export interface ChatThreadListRow extends ChatThreadRow {
  counterparty_id: string;
  counterparty_name: string | null;
  counterparty_display_name: string | null;
  counterparty_role: ChatRole;
  last_body: string | null;
  last_sender_id: string | null;
  last_has_attachment: boolean;
  last_read_at: string | null;
}

export interface ChatMessageRow {
  id: string;
  thread_id: string;
  sender_id: string;
  body: string | null;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
}

export interface ChatAttachmentRow {
  id: string;
  message_id: string;
  file_name: string;
  mime_type: string;
  byte_size: number;
  storage_key: string;
  created_at: string;
}

export interface ChatReactionRow {
  id: string;
  message_id: string;
  user_id: string;
  emoji: ChatReactionEmoji;
  created_at: string;
}

export type ChatReactionEmoji = "like" | "heart" | "thumbs_up";

export const chatRepo = {
  /**
   * Look up the thread for an unordered pair, creating it lazily. The
   * unique index guarantees we never have two rows for the same pair, but
   * we still race-protect with ON CONFLICT to keep the call idempotent.
   */
  async getOrCreateThread(args: {
    consultantId: string;
    taxpayerId: string;
    grantId?: string | null;
  }): Promise<ChatThreadRow> {
    const r = await query<ChatThreadRow>(
      `INSERT INTO chat_threads(consultant_id, taxpayer_id, grant_id)
       VALUES($1, $2, $3)
       ON CONFLICT (consultant_id, taxpayer_id) DO UPDATE
         SET grant_id = COALESCE(chat_threads.grant_id, EXCLUDED.grant_id)
       RETURNING id, consultant_id, taxpayer_id, grant_id, created_at, last_message_at`,
      [args.consultantId, args.taxpayerId, args.grantId ?? null],
    );
    const row = r.rows[0];
    if (!row) throw new Error("chat_threads upsert returned no row");
    return row;
  },

  async findThreadById(id: string): Promise<ChatThreadRow | null> {
    const r = await query<ChatThreadRow>(
      `SELECT id, consultant_id, taxpayer_id, grant_id, created_at, last_message_at
         FROM chat_threads WHERE id = $1`,
      [id],
    );
    return r.rows[0] ?? null;
  },

  /**
   * Returns every thread the user participates in, joined with the last
   * message + the user's read cursor so the UI can render the list in a
   * single round-trip.
   */
  async listThreadsForUser(userId: string): Promise<ChatThreadListRow[]> {
    const r = await query<ChatThreadListRow>(
      `SELECT
          t.id, t.consultant_id, t.taxpayer_id, t.grant_id,
          t.created_at, t.last_message_at,
          CASE WHEN t.consultant_id = $1 THEN t.taxpayer_id ELSE t.consultant_id END AS counterparty_id,
          u.name           AS counterparty_name,
          u.display_name   AS counterparty_display_name,
          (CASE WHEN t.consultant_id = $1 THEN 'taxpayer' ELSE 'consultant' END)::text AS counterparty_role,
          last_msg.body    AS last_body,
          last_msg.sender_id AS last_sender_id,
          COALESCE(last_msg.has_attachment, false) AS last_has_attachment,
          rs.last_read_at
        FROM chat_threads t
        JOIN users u ON u.id = CASE WHEN t.consultant_id = $1 THEN t.taxpayer_id ELSE t.consultant_id END
        LEFT JOIN LATERAL (
          SELECT m.body, m.sender_id,
                 EXISTS(SELECT 1 FROM chat_attachments a WHERE a.message_id = m.id) AS has_attachment
            FROM chat_messages m
           WHERE m.thread_id = t.id AND m.deleted_at IS NULL
           ORDER BY m.created_at DESC
           LIMIT 1
        ) last_msg ON TRUE
        LEFT JOIN chat_read_state rs ON rs.thread_id = t.id AND rs.user_id = $1
       WHERE t.consultant_id = $1 OR t.taxpayer_id = $1
       ORDER BY COALESCE(t.last_message_at, t.created_at) DESC`,
      [userId],
    );
    return r.rows;
  },

  /** True if `userId` is either side of the thread. */
  async userCanAccessThread(threadId: string, userId: string): Promise<boolean> {
    const r = await query<{ ok: boolean }>(
      `SELECT TRUE AS ok FROM chat_threads
        WHERE id = $1 AND (consultant_id = $2 OR taxpayer_id = $2)`,
      [threadId, userId],
    );
    return r.rows.length > 0;
  },

  async insertMessage(
    args: {
      threadId: string;
      senderId: string;
      body: string | null;
    },
    client?: DbClient,
  ): Promise<ChatMessageRow> {
    const text = `INSERT INTO chat_messages(thread_id, sender_id, body)
       VALUES($1, $2, $3)
       RETURNING id, thread_id, sender_id, body, created_at, edited_at, deleted_at`;
    const params = [args.threadId, args.senderId, args.body];
    const r = client
      ? await client.query<ChatMessageRow>(text, params)
      : await query<ChatMessageRow>(text, params);
    const row = r.rows[0];
    if (!row) throw new Error("chat_messages insert returned no row");
    return row;
  },

  async touchThreadLastMessage(
    threadId: string,
    at: string,
    client?: DbClient,
  ): Promise<void> {
    const text = `UPDATE chat_threads
                     SET last_message_at = $2
                   WHERE id = $1`;
    const params = [threadId, at];
    if (client) {
      await client.query(text, params);
    } else {
      await query(text, params);
    }
  },

  /**
   * List messages newest-first capped at `limit`. `after` (an ISO timestamp)
   * is used by the polling loop to fetch only what the client hasn't seen.
   */
  async listMessages(args: {
    threadId: string;
    after?: string | null;
    limit?: number;
  }): Promise<ChatMessageRow[]> {
    const limit = Math.min(args.limit ?? 200, 500);
    if (args.after) {
      const r = await query<ChatMessageRow>(
        `SELECT id, thread_id, sender_id, body, created_at, edited_at, deleted_at
           FROM chat_messages
          WHERE thread_id = $1 AND created_at > $2
          ORDER BY created_at ASC
          LIMIT $3`,
        [args.threadId, args.after, limit],
      );
      return r.rows;
    }
    const r = await query<ChatMessageRow>(
      `SELECT id, thread_id, sender_id, body, created_at, edited_at, deleted_at
         FROM chat_messages
        WHERE thread_id = $1
        ORDER BY created_at ASC
        LIMIT $2`,
      [args.threadId, limit],
    );
    return r.rows;
  },

  async findMessageById(id: string): Promise<ChatMessageRow | null> {
    const r = await query<ChatMessageRow>(
      `SELECT id, thread_id, sender_id, body, created_at, edited_at, deleted_at
         FROM chat_messages WHERE id = $1`,
      [id],
    );
    return r.rows[0] ?? null;
  },

  async insertAttachment(
    args: {
      messageId: string;
      fileName: string;
      mimeType: string;
      byteSize: number;
      storageKey: string;
    },
    client?: DbClient,
  ): Promise<ChatAttachmentRow> {
    const text = `INSERT INTO chat_attachments(message_id, file_name, mime_type, byte_size, storage_key)
       VALUES($1, $2, $3, $4, $5)
       RETURNING id, message_id, file_name, mime_type, byte_size, storage_key, created_at`;
    const params = [
      args.messageId,
      args.fileName,
      args.mimeType,
      args.byteSize,
      args.storageKey,
    ];
    const r = client
      ? await client.query<ChatAttachmentRow>(text, params)
      : await query<ChatAttachmentRow>(text, params);
    const row = r.rows[0];
    if (!row) throw new Error("chat_attachments insert returned no row");
    return row;
  },

  async listAttachmentsForMessages(messageIds: string[]): Promise<ChatAttachmentRow[]> {
    if (messageIds.length === 0) return [];
    const r = await query<ChatAttachmentRow>(
      `SELECT id, message_id, file_name, mime_type, byte_size, storage_key, created_at
         FROM chat_attachments
        WHERE message_id = ANY($1::uuid[])
        ORDER BY created_at ASC`,
      [messageIds],
    );
    return r.rows;
  },

  async findAttachmentById(id: string): Promise<ChatAttachmentRow | null> {
    const r = await query<ChatAttachmentRow>(
      `SELECT id, message_id, file_name, mime_type, byte_size, storage_key, created_at
         FROM chat_attachments WHERE id = $1`,
      [id],
    );
    return r.rows[0] ?? null;
  },

  async listReactionsForMessages(messageIds: string[]): Promise<ChatReactionRow[]> {
    if (messageIds.length === 0) return [];
    const r = await query<ChatReactionRow>(
      `SELECT id, message_id, user_id, emoji, created_at
         FROM chat_reactions
        WHERE message_id = ANY($1::uuid[])`,
      [messageIds],
    );
    return r.rows;
  },

  /**
   * Toggle a reaction. Returns true if the row was inserted (added), false
   * if it was removed. We rely on the unique index for the conflict.
   */
  async toggleReaction(args: {
    messageId: string;
    userId: string;
    emoji: ChatReactionEmoji;
  }): Promise<{ added: boolean }> {
    const del = await query<{ id: string }>(
      `DELETE FROM chat_reactions
        WHERE message_id = $1 AND user_id = $2 AND emoji = $3
        RETURNING id`,
      [args.messageId, args.userId, args.emoji],
    );
    if (del.rows.length > 0) {
      return { added: false };
    }
    await query(
      `INSERT INTO chat_reactions(message_id, user_id, emoji)
       VALUES($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [args.messageId, args.userId, args.emoji],
    );
    return { added: true };
  },

  async markThreadRead(threadId: string, userId: string): Promise<void> {
    await query(
      `INSERT INTO chat_read_state(thread_id, user_id, last_read_at)
       VALUES($1, $2, NOW())
       ON CONFLICT (thread_id, user_id)
         DO UPDATE SET last_read_at = NOW()`,
      [threadId, userId],
    );
  },
};
