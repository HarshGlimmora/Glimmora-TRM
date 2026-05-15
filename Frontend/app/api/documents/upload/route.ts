import { proxyRequestAsNextResponse } from "@/lib/server/backendProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return proxyRequestAsNextResponse(req, "/api/v1/documents/upload");
}
