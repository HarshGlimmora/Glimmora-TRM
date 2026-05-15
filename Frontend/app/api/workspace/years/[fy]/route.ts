import { proxyAsNextResponse } from "@/lib/server/backendProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { fy: string } },
) {
  return proxyAsNextResponse(
    `/api/v1/workspace/years/${encodeURIComponent(params.fy)}`,
  );
}
