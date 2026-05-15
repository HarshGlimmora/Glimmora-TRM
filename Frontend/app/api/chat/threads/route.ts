import { NextResponse } from "next/server";
import {
  authService,
  BadRequestError,
  UnauthorizedError,
} from "@/lib/server/services/auth";
import { chatService } from "@/lib/server/services/chat";
import { jsonError, readJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await authService.resolveCookieSession();
    if (!ctx) throw new UnauthorizedError("UNAUTHENTICATED", "Sign in first.");
    const threads = await chatService.listMyThreads(ctx.user.id);
    return NextResponse.json({ threads });
  } catch (err) {
    return jsonError(err);
  }
}

interface OpenThreadBody {
  counterpartyId?: string;
}

export async function POST(req: Request) {
  try {
    const ctx = await authService.resolveCookieSession();
    if (!ctx) throw new UnauthorizedError("UNAUTHENTICATED", "Sign in first.");
    const role = ctx.user.role;
    if (role !== "taxpayer" && role !== "consultant") {
      throw new BadRequestError("ROLE_REQUIRED", "Pick a role before chatting.");
    }
    const body = await readJson<OpenThreadBody>(req);
    if (!body.counterpartyId || typeof body.counterpartyId !== "string") {
      throw new BadRequestError("COUNTERPARTY_REQUIRED", "Missing counterpartyId.");
    }
    const thread = await chatService.openThread({
      actorUserId: ctx.user.id,
      actorRole: role,
      counterpartyId: body.counterpartyId,
    });
    return NextResponse.json({
      thread: {
        id: thread.id,
        consultantId: thread.consultant_id,
        taxpayerId: thread.taxpayer_id,
        grantId: thread.grant_id,
        createdAt: thread.created_at,
        lastMessageAt: thread.last_message_at,
      },
    });
  } catch (err) {
    return jsonError(err);
  }
}
