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

interface ReactBody {
  emoji?: string;
}

export async function POST(
  req: Request,
  ctx: { params: { id: string } },
) {
  try {
    const session = await authService.resolveCookieSession();
    if (!session) throw new UnauthorizedError("UNAUTHENTICATED", "Sign in first.");
    const body = await readJson<ReactBody>(req);
    if (!body.emoji) {
      throw new BadRequestError("REACTION_EMOJI_REQUIRED", "Pick a reaction.");
    }
    const result = await chatService.toggleReaction({
      messageId: ctx.params.id,
      userId: session.user.id,
      emoji: body.emoji,
    });
    return NextResponse.json(result);
  } catch (err) {
    return jsonError(err);
  }
}
