import { NextResponse } from "next/server";
import { authService, UnauthorizedError } from "@/lib/server/services/auth";
import { onboardingService } from "@/lib/server/services/onboarding";
import { jsonError, readJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  step?: number;
  personal?: Record<string, unknown>;
  contact?: Record<string, unknown>;
  address?: Record<string, unknown>;
  taxProfile?: Record<string, unknown>;
  credentials?: Record<string, unknown>;
  identityFlags?: Record<string, unknown>;
}

export async function GET() {
  try {
    const ctx = await authService.resolveCookieSession();
    if (!ctx) throw new UnauthorizedError("UNAUTHENTICATED", "Sign in first.");
    const row = await onboardingService.getProgress(ctx.user.id);
    return NextResponse.json({
      role: row.role,
      step: row.step,
      personal: row.personal,
      contact: row.contact,
      address: row.address,
      taxProfile: row.tax_profile,
      credentials: row.credentials,
      identityFlags: row.identity_flags,
    });
  } catch (err) {
    return jsonError(err);
  }
}

export async function PUT(req: Request) {
  try {
    const ctx = await authService.resolveCookieSession();
    if (!ctx) throw new UnauthorizedError("UNAUTHENTICATED", "Sign in first.");
    const body = await readJson<Body>(req);
    const row = await onboardingService.patchProgress({
      userId: ctx.user.id,
      step: typeof body.step === "number" ? body.step : undefined,
      personal: body.personal,
      contact: body.contact,
      address: body.address,
      tax_profile: body.taxProfile,
      credentials: body.credentials,
      identity_flags: body.identityFlags,
    });
    return NextResponse.json({
      role: row.role,
      step: row.step,
      personal: row.personal,
      contact: row.contact,
      address: row.address,
      taxProfile: row.tax_profile,
      credentials: row.credentials,
      identityFlags: row.identity_flags,
    });
  } catch (err) {
    return jsonError(err);
  }
}
