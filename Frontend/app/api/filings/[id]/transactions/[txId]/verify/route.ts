import { proxyAsNextResponse } from "@/lib/server/backendProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: { id: string; txId: string } },
) {
  return proxyAsNextResponse(
    `/api/v1/filings/${encodeURIComponent(params.id)}/transactions/${encodeURIComponent(params.txId)}/verify`,
    { method: "POST" },
  );
}
