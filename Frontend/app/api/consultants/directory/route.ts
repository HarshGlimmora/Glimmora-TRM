/**
 * GET /api/consultants/directory
 *
 * Public-after-login list of consultants visible in the "Browse" panel of
 * the Connections page. Authentication is required so anonymous scrapers
 * can't enumerate the directory; the payload itself only contains the
 * fields a taxpayer needs to *pick* a CA (no PAN, no Aadhaar, no contact).
 *
 * In dev, if the directory is empty on first hit we seed a small set of
 * sample consultants so the page has something to render. The seed is
 * gated by NODE_ENV and is a no-op in production.
 */
import { NextResponse } from "next/server";
import { authService, UnauthorizedError } from "@/lib/server/services/auth";
import { linksService } from "@/lib/server/services/links";
import { withTransaction } from "@/lib/server/db/client";
import { jsonError } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SeedConsultant {
  email: string;
  displayName: string;
  legalName: string;
  pan: string;
  bio: string;
  specializations: string[];
  yearsExperience: number;
  city: string;
  state: string;
}

const SEEDS: SeedConsultant[] = [
  {
    email: "sample-ca-1@glimmora.test",
    displayName: "CA Aanya Rao",
    legalName: "Aanya Rao",
    pan: "DEMOA1111A",
    bio: "Rao & Co.",
    specializations: ["individual_filing", "capital_gains"],
    yearsExperience: 9,
    city: "Bengaluru",
    state: "Karnataka",
  },
  {
    email: "sample-ca-2@glimmora.test",
    displayName: "CA Karthik Iyer",
    legalName: "Karthik Iyer",
    pan: "DEMOB2222B",
    bio: "Iyer & Narayan Associates",
    specializations: ["business_tax", "gst", "individual_filing"],
    yearsExperience: 17,
    city: "Mumbai",
    state: "Maharashtra",
  },
  {
    email: "sample-ca-3@glimmora.test",
    displayName: "CA Priya Menon",
    legalName: "Priya Menon",
    pan: "DEMOC3333C",
    bio: "Menon Tax Advisors",
    specializations: ["international_tax", "transfer_pricing"],
    yearsExperience: 14,
    city: "Pune",
    state: "Maharashtra",
  },
];

async function seedIfEmpty(): Promise<void> {
  if (process.env.NODE_ENV === "production") return;
  const existing = await linksService.listDirectory();
  if (existing.length > 0) return;

  await withTransaction(async (client) => {
    for (const s of SEEDS) {
      const u = await client.query<{ id: string }>(
        `INSERT INTO users(
            email, role, display_name, legal_name, pan,
            email_verified_at, pan_verified_at,
            city, state, pincode, profile_completed_at, last_login_at
         )
         VALUES($1, 'consultant', $2, $3, $4, NOW(), NOW(),
                $5, $6, '400001', NOW(), NOW())
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [s.email, s.displayName, s.legalName, s.pan, s.city, s.state],
      );
      let userId: string | undefined = u.rows[0]?.id;
      if (!userId) {
        const r = await client.query<{ id: string }>(
          `SELECT id FROM users WHERE email = $1 LIMIT 1`,
          [s.email],
        );
        userId = r.rows[0]?.id;
      }
      if (!userId) continue;

      await client.query(
        `INSERT INTO ca_profiles(
            user_id, icai_membership, bio, specializations,
            years_experience, listed_in_directory, accepting_clients
         )
         VALUES($1, $2, $3, $4, $5, TRUE, TRUE)
         ON CONFLICT(user_id) DO UPDATE SET
            listed_in_directory = TRUE,
            accepting_clients   = TRUE,
            bio                 = COALESCE(EXCLUDED.bio, ca_profiles.bio),
            specializations     = COALESCE(EXCLUDED.specializations, ca_profiles.specializations),
            years_experience    = COALESCE(EXCLUDED.years_experience, ca_profiles.years_experience)`,
        [
          userId,
          // ICAI numbers are 6-7 digits in the regex from 0001 — derive a stable
          // value from the PAN suffix so each seed has a unique one.
          `4${userId.replace(/[^0-9]/g, "").slice(-5).padStart(5, "0")}`,
          s.bio,
          s.specializations,
          s.yearsExperience,
        ],
      );
    }
  });
}

export async function GET() {
  try {
    const ctx = await authService.resolveCookieSession();
    if (!ctx) throw new UnauthorizedError("UNAUTHENTICATED", "Sign in first.");
    await seedIfEmpty();
    const consultants = await linksService.listDirectory();
    return NextResponse.json({ consultants });
  } catch (err) {
    return jsonError(err);
  }
}
