/**
 * Dev-only "admin" login. Skips the OTP loop and signs the caller in as a
 * pre-baked test taxpayer or test consultant so we don't burn real OTPs
 * during day-to-day development.
 *
 * Guarded by NODE_ENV !== "production". In prod this returns 404, which
 * also means the UI button (rendered with the same gate) and any direct
 * curl attempt both fail closed.
 *
 * The two pre-baked accounts are idempotent — repeated clicks just
 * re-mint a session against the same row. They use synthetic *.glimmora.test
 * emails so they can't collide with a real user signup.
 */
import { NextResponse } from "next/server";
import { withTransaction } from "@/lib/server/db/client";
import { runMigrations } from "@/lib/server/db/migrate";
import { auditRepo } from "@/lib/server/repos/audit";
import { usersRepo } from "@/lib/server/repos/identity";
import {
  consultantProfilesRepo,
  taxpayerProfilesRepo,
} from "@/lib/server/repos/profiles";
import { sessionsRepo } from "@/lib/server/repos/sessions";
import { LONG_TTL_SECONDS, setSessionCookie } from "@/lib/server/auth/cookies";
import { randomToken, sha256Hex } from "@/lib/server/auth/hash";
import { authService } from "@/lib/server/services/auth";
import { jsonError, readJson, requestMeta } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  role?: "taxpayer" | "consultant";
}

const TAXPAYER_EMAIL = "admin-taxpayer@glimmora.test";
const CONSULTANT_EMAIL = "admin-consultant@glimmora.test";

const TAXPAYER_PAN = "ADMNT1234A";
const CONSULTANT_PAN = "ADMNC5678B";

let migrationsReady: Promise<unknown> | null = null;
async function ensureMigrations(): Promise<void> {
  if (!migrationsReady) migrationsReady = runMigrations();
  await migrationsReady;
}

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "Not found.", code: "NOT_FOUND" },
      { status: 404 },
    );
  }
  try {
    await ensureMigrations();
    const body = await readJson<Body>(req);
    const role = body.role === "consultant" ? "consultant" : "taxpayer";
    const email = role === "consultant" ? CONSULTANT_EMAIL : TAXPAYER_EMAIL;

    // 1. Idempotently get/create the admin user, mark email verified,
    // and stamp profile_completed_at so the router sends us to /dashboard.
    const { user } = await usersRepo.findOrCreateByIdentifier({
      channel: "email",
      identifier: email,
    });
    const pan = role === "consultant" ? CONSULTANT_PAN : TAXPAYER_PAN;
    const displayName =
      role === "consultant" ? "Admin Consultant" : "Admin Taxpayer";
    const legalName =
      role === "consultant"
        ? "Admin Consultant User"
        : "Admin Taxpayer User";

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE users SET
            email_verified_at    = COALESCE(email_verified_at, NOW()),
            display_name         = COALESCE(display_name, $2),
            legal_name           = COALESCE(legal_name, $3),
            pan                  = COALESCE(pan, $4),
            pan_verified_at      = COALESCE(pan_verified_at, NOW()),
            role                 = $5,
            profile_completed_at = COALESCE(profile_completed_at, NOW()),
            last_login_at        = NOW(),
            city                 = COALESCE(city, 'Mumbai'),
            state                = COALESCE(state, 'Maharashtra'),
            pincode              = COALESCE(pincode, '400001')
         WHERE id = $1`,
        [user.id, displayName, legalName, pan, role],
      );
      if (role === "taxpayer") {
        await taxpayerProfilesRepo.upsert({
          userId: user.id,
          fatherName: "Admin Senior",
          dateOfBirth: "1990-01-01",
          gender: "prefer_not_to_say",
          residentialStatus: "resident",
          primaryIncomeType: "salary",
          regimePreference: "new",
          aadhaarLast4: "0000",
          aadhaarVerified: true,
          addressLine1: "1 Test Lane",
          addressLine2: null,
          contactEmail: TAXPAYER_EMAIL,
          contactPhone: null,
          age: 35,
          maritalStatus: "single",
          client,
        });
      } else {
        await consultantProfilesRepo.upsert({
          userId: user.id,
          icaiMembership: "123456",
          bio: "Test consultant",
          specializations: ["individual_tax"],
          yearsExperience: 10,
          contactEmail: CONSULTANT_EMAIL,
          contactPhone: null,
          client,
        });
      }
    });

    // 2. Mint a real session. Remember-me on (long TTL) so the dev workflow
    // doesn't ask us to log back in every few hours.
    const meta = requestMeta(req);
    const token = randomToken(32);
    const session = await sessionsRepo.create({
      userId: user.id,
      tokenHash: sha256Hex(token),
      rememberMe: true,
      ttlMs: LONG_TTL_SECONDS * 1000,
      userAgent: meta.userAgent ?? null,
      ipAddress: meta.ipAddress ?? null,
    });
    setSessionCookie({ token, rememberMe: true });

    await auditRepo.write({
      actorUserId: user.id,
      action: "admin_login",
      entityType: "sessions",
      entityId: session.id,
      metadata: { role, dev: true },
    });

    const fresh = await usersRepo.findById(user.id);
    if (!fresh) throw new Error("Admin user vanished mid-login");
    return NextResponse.json({
      ok: true,
      next: "/dashboard",
      user: authService.rowToMe(fresh),
    });
  } catch (err) {
    return jsonError(err);
  }
}
