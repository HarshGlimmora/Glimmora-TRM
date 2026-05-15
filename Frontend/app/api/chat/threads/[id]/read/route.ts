import { NextResponse } from "next/server";
import {
  authService,
  UnauthorizedError,
} from "@/lib/server/services/auth";
import { chatService } from "@/lib/server/services/chat";
import { jsonError } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  ctx: { params: { id: string } },
) {
  try {
    const session = await authService.resolveCookieSession();
    if (!session) throw new UnauthorizedError("UNAUTHENTICATED", "Sign in first.");
    await chatService.markRead(ctx.params.id, session.user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
