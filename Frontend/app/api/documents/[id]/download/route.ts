import { proxyBinaryToBackend } from "@/lib/server/backendProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  return proxyBinaryToBackend(
    `/api/v1/documents/${encodeURIComponent(params.id)}/download`,
  );
}
