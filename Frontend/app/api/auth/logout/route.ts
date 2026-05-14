import { NextResponse } from "next/server";
import { authService } from "@/lib/server/services/auth";
import { jsonError } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await authService.logout();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
