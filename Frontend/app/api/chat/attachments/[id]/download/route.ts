import {
  authService,
  UnauthorizedError,
} from "@/lib/server/services/auth";
import { chatService } from "@/lib/server/services/chat";
import { jsonError } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: { id: string } },
) {
  try {
    const session = await authService.resolveCookieSession();
    if (!session) throw new UnauthorizedError("UNAUTHENTICATED", "Sign in first.");
    const { bytes, mimeType, fileName } = await chatService.downloadAttachment(
      ctx.params.id,
      session.user.id,
    );
    // Encode the filename per RFC 5987 so non-ASCII names don't break the header.
    const safeAscii = fileName.replace(/[^\x20-\x7e]+/g, "_");
    const encoded = encodeURIComponent(fileName);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "content-type": mimeType,
        "content-length": String(bytes.length),
        "content-disposition": `inline; filename="${safeAscii}"; filename*=UTF-8''${encoded}`,
        "cache-control": "private, max-age=300",
      },
    });
  } catch (err) {
    return jsonError(err);
  }
}
