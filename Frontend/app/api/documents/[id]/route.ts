import { proxyAsNextResponse } from "@/lib/server/backendProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  return proxyAsNextResponse(
    `/api/v1/documents/${encodeURIComponent(params.id)}`,
  );
}

export async function PUT(
  req: Request,
  { params }: { params: { id: string } },
) {
  const body = await req.text();
  return proxyAsNextResponse(
    `/api/v1/documents/${encodeURIComponent(params.id)}`,
    {
      method: "PUT",
      body: body && body.length ? body : "{}",
      headers: { "content-type": "application/json" },
    },
  );
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  return proxyAsNextResponse(
    `/api/v1/documents/${encodeURIComponent(params.id)}`,
    { method: "DELETE" },
  );
}
