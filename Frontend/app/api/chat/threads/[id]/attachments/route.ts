import { NextResponse } from "next/server";
import {
  authService,
  BadRequestError,
  UnauthorizedError,
} from "@/lib/server/services/auth";
import { chatService } from "@/lib/server/services/chat";
import { jsonError } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Cap the raw request body — defence-in-depth in addition to per-file checks.
export const maxDuration = 60;

const MAX_TOTAL_BYTES = 30 * 1024 * 1024;

export async function POST(
  req: Request,
  ctx: { params: { id: string } },
) {
  try {
    const session = await authService.resolveCookieSession();
    if (!session) throw new UnauthorizedError("UNAUTHENTICATED", "Sign in first.");

    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      throw new BadRequestError(
        "BAD_CONTENT_TYPE",
        "Expected multipart/form-data.",
      );
    }

    const form = await req.formData();
    const body = form.get("body");
    const files = form
      .getAll("files")
      .filter((f): f is File => f instanceof File);

    if (files.length === 0) {
      throw new BadRequestError("CHAT_NO_FILES", "Attach at least one file.");
    }

    let total = 0;
    const buffers: { fileName: string; mimeType: string; bytes: Buffer }[] = [];
    for (const file of files) {
      const ab = await file.arrayBuffer();
      const buf = Buffer.from(ab);
      total += buf.length;
      if (total > MAX_TOTAL_BYTES) {
        throw new BadRequestError(
          "CHAT_FILE_TOO_LARGE",
          "Total upload exceeds 30 MB.",
        );
      }
      buffers.push({
        fileName: file.name || "file",
        mimeType: file.type || "application/octet-stream",
        bytes: buf,
      });
    }

    const message = await chatService.sendAttachmentsMessage({
      threadId: ctx.params.id,
      userId: session.user.id,
      body: typeof body === "string" && body.length > 0 ? body : null,
      files: buffers,
    });
    return NextResponse.json({ message });
  } catch (err) {
    return jsonError(err);
  }
}
