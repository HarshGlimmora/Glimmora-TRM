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

export async function GET(
  req: Request,
  ctx: { params: { id: string } },
) {
  try {
    const session = await authService.resolveCookieSession();
    if (!session) throw new UnauthorizedError("UNAUTHENTICATED", "Sign in first.");
    const url = new URL(req.url);
    const after = url.searchParams.get("after");
    const messages = await chatService.listMessages({
      threadId: ctx.params.id,
      userId: session.user.id,
      after,
    });
    return NextResponse.json({ messages });
  } catch (err) {
    return jsonError(err);
  }
}

interface SendBody {
  body?: string;
}

export async function POST(
  req: Request,
  ctx: { params: { id: string } },
) {
  try {
    const session = await authService.resolveCookieSession();
    if (!session) throw new UnauthorizedError("UNAUTHENTICATED", "Sign in first.");
    const payload = await readJson<SendBody>(req);
    if (!payload.body || typeof payload.body !== "string") {
      throw new BadRequestError("CHAT_EMPTY", "Type a message before sending.");
    }
    const message = await chatService.sendTextMessage({
      threadId: ctx.params.id,
      userId: session.user.id,
      body: payload.body,
    });
    return NextResponse.json({ message });
  } catch (err) {
    return jsonError(err);
  }
}
