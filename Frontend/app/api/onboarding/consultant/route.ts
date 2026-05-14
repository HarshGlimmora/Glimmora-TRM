import { NextResponse } from "next/server";
import {
  authService,
  decideNext,
  UnauthorizedError,
} from "@/lib/server/services/auth";
import {
  onboardingService,
  type ConsultantSubmit,
} from "@/lib/server/services/onboarding";
import { jsonError, readJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const ctx = await authService.resolveCookieSession();
    if (!ctx) throw new UnauthorizedError("UNAUTHENTICATED", "Sign in first.");
    const payload = await readJson<ConsultantSubmit>(req);
    await onboardingService.submitConsultant({ userId: ctx.user.id, payload });
    const fresh = await authService.resolveCookieSession();
    const next = fresh ? await decideNext(fresh.user) : "/dashboard";
    return NextResponse.json({
      ok: true,
      next,
      user: fresh ? authService.rowToMe(fresh.user) : null,
    });
  } catch (err) {
    return jsonError(err);
  }
}
