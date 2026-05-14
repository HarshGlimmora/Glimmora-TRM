import "server-only";
import { query, type DbClient } from "@/lib/server/db/client";

export interface TaxpayerProfileRow {
  user_id: string;
  father_name: string | null;
  date_of_birth: string | null;
  gender: string | null;
  residential_status: string | null;
  primary_income_type: string | null;
  regime_preference: "old" | "new" | null;
  aadhaar_last4: string | null;
  aadhaar_verified_at: string | null;
  address_line1: string | null;
  address_line2: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  age: number | null;
  marital_status:
    | "single"
    | "married"
    | "divorced"
    | "widowed"
    | "separated"
    | null;
  created_at: string;
  updated_at: string;
}

export interface ConsultantProfileRow {
  user_id: string;
  icai_membership: string | null;
  bio: string | null;
  specializations: string[] | null;
  years_experience: number | null;
  languages: string[] | null;
  fee_range_indicator: string | null;
  photo_url: string | null;
  listed_in_directory: boolean;
  accepting_clients: boolean;
  serves_cities: string[] | null;
  contact_email: string | null;
  contact_phone: string | null;
  created_at: string;
  updated_at: string;
}

const TAXPAYER_UPSERT_SQL = `INSERT INTO taxpayer_profiles(
    user_id, father_name, date_of_birth, gender, residential_status,
    primary_income_type, regime_preference, aadhaar_last4,
    aadhaar_verified_at, address_line1, address_line2,
    contact_email, contact_phone, age, marital_status
 )
 VALUES($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $9::bool THEN NOW() ELSE NULL END, $10, $11, $12, $13, $14, $15)
 ON CONFLICT(user_id) DO UPDATE SET
    father_name         = COALESCE(EXCLUDED.father_name,         taxpayer_profiles.father_name),
    date_of_birth       = COALESCE(EXCLUDED.date_of_birth,       taxpayer_profiles.date_of_birth),
    gender              = COALESCE(EXCLUDED.gender,              taxpayer_profiles.gender),
    residential_status  = COALESCE(EXCLUDED.residential_status,  taxpayer_profiles.residential_status),
    primary_income_type = COALESCE(EXCLUDED.primary_income_type, taxpayer_profiles.primary_income_type),
    regime_preference   = COALESCE(EXCLUDED.regime_preference,   taxpayer_profiles.regime_preference),
    aadhaar_last4       = COALESCE(EXCLUDED.aadhaar_last4,       taxpayer_profiles.aadhaar_last4),
    aadhaar_verified_at = COALESCE(EXCLUDED.aadhaar_verified_at, taxpayer_profiles.aadhaar_verified_at),
    address_line1       = COALESCE(EXCLUDED.address_line1,       taxpayer_profiles.address_line1),
    address_line2       = COALESCE(EXCLUDED.address_line2,       taxpayer_profiles.address_line2),
    contact_email       = COALESCE(EXCLUDED.contact_email,       taxpayer_profiles.contact_email),
    contact_phone       = COALESCE(EXCLUDED.contact_phone,       taxpayer_profiles.contact_phone),
    age                 = COALESCE(EXCLUDED.age,                 taxpayer_profiles.age),
    marital_status      = COALESCE(EXCLUDED.marital_status,      taxpayer_profiles.marital_status)
 RETURNING *`;

export const taxpayerProfilesRepo = {
  async upsert(args: {
    userId: string;
    fatherName?: string | null;
    dateOfBirth?: string | null;
    gender?: string | null;
    residentialStatus?: string | null;
    primaryIncomeType?: string | null;
    regimePreference?: "old" | "new" | null;
    aadhaarLast4?: string | null;
    aadhaarVerified?: boolean;
    addressLine1?: string | null;
    addressLine2?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
    age?: number | null;
    maritalStatus?:
      | "single"
      | "married"
      | "divorced"
      | "widowed"
      | "separated"
      | null;
    client?: DbClient;
  }): Promise<TaxpayerProfileRow> {
    const params: unknown[] = [
      args.userId,
      args.fatherName ?? null,
      args.dateOfBirth ?? null,
      args.gender ?? null,
      args.residentialStatus ?? null,
      args.primaryIncomeType ?? null,
      args.regimePreference ?? null,
      args.aadhaarLast4 ?? null,
      Boolean(args.aadhaarVerified),
      args.addressLine1 ?? null,
      args.addressLine2 ?? null,
      args.contactEmail ?? null,
      args.contactPhone ?? null,
      args.age ?? null,
      args.maritalStatus ?? null,
    ];
    const r = args.client
      ? await args.client.query<TaxpayerProfileRow>(TAXPAYER_UPSERT_SQL, params)
      : await query<TaxpayerProfileRow>(TAXPAYER_UPSERT_SQL, params);
    const row = r.rows[0];
    if (!row) throw new Error("Taxpayer profile upsert returned no row");
    return row;
  },

  async get(userId: string): Promise<TaxpayerProfileRow | null> {
    const r = await query<TaxpayerProfileRow>(
      "SELECT * FROM taxpayer_profiles WHERE user_id = $1",
      [userId],
    );
    return r.rows[0] ?? null;
  },
};

const CA_UPSERT_SQL = `INSERT INTO ca_profiles(
    user_id, icai_membership, bio, specializations, years_experience,
    languages, fee_range_indicator, listed_in_directory,
    accepting_clients, serves_cities, contact_email, contact_phone
 )
 VALUES($1, $2, $3, $4, $5, $6, $7, COALESCE($8, FALSE), COALESCE($9, TRUE), $10, $11, $12)
 ON CONFLICT(user_id) DO UPDATE SET
    icai_membership     = COALESCE(EXCLUDED.icai_membership,     ca_profiles.icai_membership),
    bio                 = COALESCE(EXCLUDED.bio,                 ca_profiles.bio),
    specializations     = COALESCE(EXCLUDED.specializations,     ca_profiles.specializations),
    years_experience    = COALESCE(EXCLUDED.years_experience,    ca_profiles.years_experience),
    languages           = COALESCE(EXCLUDED.languages,           ca_profiles.languages),
    fee_range_indicator = COALESCE(EXCLUDED.fee_range_indicator, ca_profiles.fee_range_indicator),
    listed_in_directory = COALESCE(EXCLUDED.listed_in_directory, ca_profiles.listed_in_directory),
    accepting_clients   = COALESCE(EXCLUDED.accepting_clients,   ca_profiles.accepting_clients),
    serves_cities       = COALESCE(EXCLUDED.serves_cities,       ca_profiles.serves_cities),
    contact_email       = COALESCE(EXCLUDED.contact_email,       ca_profiles.contact_email),
    contact_phone       = COALESCE(EXCLUDED.contact_phone,       ca_profiles.contact_phone)
 RETURNING *`;

export const consultantProfilesRepo = {
  async upsert(args: {
    userId: string;
    icaiMembership?: string | null;
    bio?: string | null;
    specializations?: string[] | null;
    yearsExperience?: number | null;
    languages?: string[] | null;
    feeRange?: string | null;
    listedInDirectory?: boolean;
    acceptingClients?: boolean;
    servesCities?: string[] | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
    client?: DbClient;
  }): Promise<ConsultantProfileRow> {
    const params: unknown[] = [
      args.userId,
      args.icaiMembership ?? null,
      args.bio ?? null,
      args.specializations ?? null,
      args.yearsExperience ?? null,
      args.languages ?? null,
      args.feeRange ?? null,
      args.listedInDirectory ?? null,
      args.acceptingClients ?? null,
      args.servesCities ?? null,
      args.contactEmail ?? null,
      args.contactPhone ?? null,
    ];
    const r = args.client
      ? await args.client.query<ConsultantProfileRow>(CA_UPSERT_SQL, params)
      : await query<ConsultantProfileRow>(CA_UPSERT_SQL, params);
    const row = r.rows[0];
    if (!row) throw new Error("CA profile upsert returned no row");
    return row;
  },

  async get(userId: string): Promise<ConsultantProfileRow | null> {
    const r = await query<ConsultantProfileRow>(
      "SELECT * FROM ca_profiles WHERE user_id = $1",
      [userId],
    );
    return r.rows[0] ?? null;
  },
};
