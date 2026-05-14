import "server-only";
import { NextResponse } from "next/server";
import { HttpError } from "@/lib/server/services/auth";

export function requestMeta(req: Request): {
  userAgent: string | null;
  ipAddress: string | null;
} {
  const userAgent = req.headers.get("user-agent");
  const fwd = req.headers.get("x-forwarded-for");
  const ip = fwd ? fwd.split(",")[0]!.trim() : req.headers.get("x-real-ip") ?? null;
  return { userAgent, ipAddress: ip && ip.length ? ip : null };
}

export function jsonError(err: unknown): NextResponse {
  if (err instanceof HttpError) {
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status: err.statusCode },
    );
  }
  console.error("[api] unexpected error:", err);
  return NextResponse.json(
    { error: "Internal server error", code: "INTERNAL_ERROR" },
    { status: 500 },
  );
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw Object.assign(new Error("Malformed request body."), {
      code: "BAD_JSON",
      statusCode: 400,
    });
  }
}
