/**
 * Server-side proxy from Next.js route handlers to the FastAPI backend.
 *
 * Flow:
 *   1. Resolve the user from the httpOnly session cookie.
 *   2. Mint a short-lived HS256 JWT { sub, role, exp } signed with
 *      AUTH_SHARED_SECRET — must match FastAPI's auth_shared_secret.
 *   3. Forward to BACKEND_BASE_URL with `Authorization: Bearer <jwt>`.
 *
 * The browser never sees the backend token, and CORS stays simple because
 * the browser only ever talks to Next.js. See FILING_FLOW.md §3.1.
 */
import "server-only";
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { authService } from "@/lib/server/services/auth";

const DEFAULT_BACKEND_URL = "http://127.0.0.1:8000";
const TOKEN_TTL_SECONDS = 300; // 5 minutes

function backendBaseUrl(): string {
  if (process.env.BACKEND_BASE_URL) return process.env.BACKEND_BASE_URL;
  // On Vercel, the FastAPI serverless function lives at the same origin
  // as Next.js (mounted via vercel.json rewrites). VERCEL_URL is the
  // deployment-specific hostname injected automatically by Vercel.
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return DEFAULT_BACKEND_URL;
}

function sharedSecret(): string {
  const secret = process.env.AUTH_SHARED_SECRET;
  if (!secret) {
    throw new Error(
      "AUTH_SHARED_SECRET is not set. Add it to the centralized .env at the repo root (or to Vercel env vars for cloud).",
    );
  }
  return secret;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function signBackendJwt(payload: Record<string, unknown>, secret: string): string {
  const header = { alg: "HS256", typ: "JWT" };
  const h = b64url(Buffer.from(JSON.stringify(header), "utf8"));
  const p = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const signingInput = `${h}.${p}`;
  const sig = crypto.createHmac("sha256", secret).update(signingInput).digest();
  return `${signingInput}.${b64url(sig)}`;
}

export interface ProxyResult {
  status: number;
  body: unknown;
  headers: Headers;
}

/**
 * Resolve the session, mint a JWT, and call the backend. Never throws — every
 * failure path returns a structured JSON body with a `code` so the browser
 * sees a clean error instead of a Next.js stack trace.
 *
 * `path` must start with a leading slash (e.g. `/api/v1/workspace/years`).
 */
export async function proxyToBackend(
  path: string,
  init: RequestInit = {},
): Promise<ProxyResult> {
  let session;
  try {
    session = await authService.resolveCookieSession();
  } catch (e) {
    return errorResult(
      500,
      "session_lookup_failed",
      e instanceof Error ? e.message : "Could not resolve session.",
    );
  }
  if (!session) {
    return errorResult(401, "unauthorized", "No active session.");
  }

  let secret: string;
  try {
    secret = sharedSecret();
  } catch (e) {
    return errorResult(
      500,
      "auth_misconfigured",
      e instanceof Error ? e.message : "AUTH_SHARED_SECRET is not set.",
    );
  }

  const nowSec = Math.floor(Date.now() / 1000);
  // In addition to the canonical JWT claims (sub/role/exp), forward enough
  // identity fields for FastAPI to keep a local shadow `users` row when the
  // two services don't share a database. Removed once both apps point at the
  // same Postgres.
  const token = signBackendJwt(
    {
      sub: session.user.id,
      role: session.user.role,
      email: session.user.email,
      phone: session.user.phone,
      // UserRow uses snake_case (it's the DB shape, not the API shape).
      name: session.user.display_name ?? session.user.legal_name ?? session.user.name ?? null,
      iat: nowSec,
      exp: nowSec + TOKEN_TTL_SECONDS,
    },
    secret,
  );

  const url = `${backendBaseUrl()}${path}`;
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body != null && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  headers.set("accept", "application/json");

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      ...init,
      headers,
      cache: "no-store",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[backendProxy] fetch ${url} failed:`, msg);
    return errorResult(
      502,
      "backend_unreachable",
      `Could not reach FastAPI at ${backendBaseUrl()}. Is uvicorn running? (${msg})`,
    );
  }

  const text = await upstream.text();
  let body: unknown = text;
  const ct = upstream.headers.get("content-type") ?? "";
  if (ct.includes("application/json") && text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: upstream.status, body, headers: upstream.headers };
}

function errorResult(status: number, code: string, message: string): ProxyResult {
  return {
    status,
    body: { code, message, detail: { code, message } },
    headers: new Headers({ "content-type": "application/json" }),
  };
}

/**
 * Convenience wrapper that returns a NextResponse. Use this from route
 * handlers when you just want to relay status + JSON body straight to the
 * browser.
 */
export async function proxyAsNextResponse(
  path: string,
  init: RequestInit = {},
): Promise<NextResponse> {
  const { status, body } = await proxyToBackend(path, init);
  // 204 / 205 / 304 forbid a response body per RFC 9110 §15. Returning a JSON
  // payload here makes Node's response writer crash with a generic 500 — most
  // commonly seen on DELETE endpoints. Send an empty NextResponse instead.
  if (status === 204 || status === 205 || status === 304) {
    return new NextResponse(null, { status });
  }
  return NextResponse.json(body as object, { status });
}

/**
 * Forward to FastAPI for a binary download (PDF, CSV original). Returns the
 * upstream Response directly so the bytes are not re-decoded — the browser
 * sees the original file.
 */
export async function proxyBinaryToBackend(path: string): Promise<Response> {
  // Re-implement the auth flow inline so we can stream the upstream body
  // without going through proxyToBackend's text() decode path.
  let session;
  try {
    session = await authService.resolveCookieSession();
  } catch {
    return new Response(JSON.stringify({ code: "session_lookup_failed" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
  if (!session) {
    return new Response(JSON.stringify({ code: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  let secret: string;
  try {
    secret = sharedSecret();
  } catch {
    return new Response(JSON.stringify({ code: "auth_misconfigured" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const token = signBackendJwt(
    {
      sub: session.user.id,
      role: session.user.role,
      email: session.user.email,
      phone: session.user.phone,
      name: session.user.display_name ?? session.user.legal_name ?? session.user.name ?? null,
      iat: nowSec,
      exp: nowSec + TOKEN_TTL_SECONDS,
    },
    secret,
  );

  const upstream = await fetch(`${backendBaseUrl()}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "content-disposition": upstream.headers.get("content-disposition") ?? "attachment",
    },
  });
}

/**
 * Forward the original Request to FastAPI verbatim — body, content-type
 * (boundary included), and a small allow-list of pass-through headers.
 * Use this for multipart/form-data uploads where Next must not re-encode
 * the body. Returns a NextResponse with the upstream status + JSON body.
 *
 * The body is buffered into memory (size capped by the upstream backend's
 * 10 MB limit anyway), which avoids the half-duplex stream gotchas in
 * Node 18+ fetch and matches typical document-upload sizes.
 */
export async function proxyRequestAsNextResponse(
  req: Request,
  path: string,
  extra: { headers?: HeadersInit } = {},
): Promise<NextResponse> {
  const contentType = req.headers.get("content-type") ?? "application/octet-stream";
  const contentLength = req.headers.get("content-length");

  let body: ArrayBuffer;
  try {
    body = await req.arrayBuffer();
  } catch (e) {
    return NextResponse.json(
      {
        code: "bad_request_body",
        message: e instanceof Error ? e.message : "Could not read request body.",
      },
      { status: 400 },
    );
  }

  const headers = new Headers(extra.headers);
  headers.set("content-type", contentType);
  if (contentLength) headers.set("content-length", contentLength);
  // Forward optional hint header used by /documents/upload.
  const hintFy = req.headers.get("x-hint-tax-year");
  if (hintFy) headers.set("x-hint-tax-year", hintFy);

  const { status, body: upstreamBody } = await proxyToBackend(path, {
    method: req.method,
    body,
    headers,
  });
  return NextResponse.json(upstreamBody as object, { status });
}
