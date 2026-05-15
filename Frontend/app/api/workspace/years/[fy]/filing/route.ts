import { proxyAsNextResponse } from "@/lib/server/backendProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: { fy: string } },
) {
  // Forward any body the caller sent (e.g. { template_from_tax_year }). Falls
  // back to an empty object so FastAPI's Pydantic default kicks in.
  let body: string = "{}";
  try {
    const raw = await req.text();
    body = raw && raw.length ? raw : "{}";
  } catch {
    body = "{}";
  }
  return proxyAsNextResponse(
    `/api/v1/workspace/years/${encodeURIComponent(params.fy)}/filing`,
    { method: "POST", body },
  );
}
