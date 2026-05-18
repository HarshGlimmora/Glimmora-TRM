/**
 * Proxy for the in-product assistant.
 *
 *   POST /api/assistant/answer
 *
 * Forwards { question, page_id, role } to FastAPI's /api/v1/chatbot/answer.
 * Auth is handled by the same JWT-mint path as every other v1 proxy.
 */
import "server-only";
import { proxyAsNextResponse } from "@/lib/server/backendProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const raw = await req.text();
  return proxyAsNextResponse("/api/v1/chatbot/answer", {
    method: "POST",
    body: raw,
    headers: { "content-type": "application/json" },
  });
}
