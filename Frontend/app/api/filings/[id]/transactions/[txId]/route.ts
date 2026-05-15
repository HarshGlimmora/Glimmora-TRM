import { proxyAsNextResponse } from "@/lib/server/backendProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { id: string; txId: string } },
) {
  return proxyAsNextResponse(
    `/api/v1/filings/${encodeURIComponent(params.id)}/transactions/${encodeURIComponent(params.txId)}`,
  );
}

export async function PUT(
  req: Request,
  { params }: { params: { id: string; txId: string } },
) {
  const body = await req.text();
  return proxyAsNextResponse(
    `/api/v1/filings/${encodeURIComponent(params.id)}/transactions/${encodeURIComponent(params.txId)}`,
    {
      method: "PUT",
      body: body && body.length ? body : "{}",
      headers: { "content-type": "application/json" },
    },
  );
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; txId: string } },
) {
  return proxyAsNextResponse(
    `/api/v1/filings/${encodeURIComponent(params.id)}/transactions/${encodeURIComponent(params.txId)}`,
    { method: "DELETE" },
  );
}
