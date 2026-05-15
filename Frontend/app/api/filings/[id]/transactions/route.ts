import { proxyAsNextResponse } from "@/lib/server/backendProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const url = new URL(req.url);
  const qs = url.search ?? "";
  return proxyAsNextResponse(
    `/api/v1/filings/${encodeURIComponent(params.id)}/transactions${qs}`,
  );
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const body = await req.text();
  return proxyAsNextResponse(
    `/api/v1/filings/${encodeURIComponent(params.id)}/transactions`,
    {
      method: "POST",
      body: body && body.length ? body : "{}",
      headers: { "content-type": "application/json" },
    },
  );
}
