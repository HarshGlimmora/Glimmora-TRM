import { NextResponse } from "next/server";
import { authService, decideNext, UnauthorizedError } from "@/lib/server/services/auth";
import { onboardingService } from "@/lib/server/services/onboarding";
import { jsonError, readJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  role?: "taxpayer" | "consultant";
}

export async function POST(req: Request) {
  try {
    const ctx = await authService.resolveCookieSession();
    if (!ctx) throw new UnauthorizedError("UNAUTHENTICATED", "Sign in first.");
    const body = await readJson<Body>(req);
    if (body.role !== "taxpayer" && body.role !== "consultant") {
      return NextResponse.json(
        { error: "Pick taxpayer or consultant.", code: "ROLE_INVALID" },
        { status: 400 },
      );
    }
    await onboardingService.setRole({ userId: ctx.user.id, role: body.role });
    const fresh = (await authService.resolveCookieSession())!;
    return NextResponse.json({
      ok: true,
      next: await decideNext(fresh.user),
      user: authService.rowToMe(fresh.user),
    });
  } catch (err) {
    return jsonError(err);
  }
}
