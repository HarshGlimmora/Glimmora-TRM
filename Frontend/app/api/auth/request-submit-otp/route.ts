import { proxyAsNextResponse } from "@/lib/server/backendProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.text();
  return proxyAsNextResponse("/api/v1/auth/request-submit-otp", {
    method: "POST",
    body: body && body.length ? body : "{}",
    headers: { "content-type": "application/json" },
  });
}
