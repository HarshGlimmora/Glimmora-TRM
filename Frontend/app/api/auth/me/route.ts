import { NextResponse } from "next/server";
import { authService, decideNext } from "@/lib/server/services/auth";
import { onboardingService } from "@/lib/server/services/onboarding";
import { jsonError } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await authService.resolveCookieSession();
    if (!ctx) {
      return NextResponse.json(
        { authenticated: false, next: "/login" },
        { status: 401 },
      );
    }
    const next = await decideNext(ctx.user);
    const onb = ctx.user.profile_completed_at
      ? null
      : await onboardingService.getProgress(ctx.user.id);
    return NextResponse.json({
      authenticated: true,
      next,
      hasProfile: ctx.user.profile_completed_at != null,
      rememberMe: ctx.rememberMe,
      user: authService.rowToMe(ctx.user),
      onboarding: onb
        ? {
            role: onb.role,
            step: onb.step,
            personal: onb.personal,
            contact: onb.contact,
            address: onb.address,
            taxProfile: onb.tax_profile,
            credentials: onb.credentials,
            identityFlags: onb.identity_flags,
          }
        : null,
    });
  } catch (err) {
    return jsonError(err);
  }
}
