import { proxyAsNextResponse } from "@/lib/server/backendProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const body = await req.text();
  return proxyAsNextResponse(`/api/v1/filings/${encodeURIComponent(params.id)}`, {
    method: "PATCH",
    body: body && body.length ? body : "{}",
  });
}
