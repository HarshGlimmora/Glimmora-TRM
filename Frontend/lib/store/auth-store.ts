"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { AnyProfile, Role } from "@/lib/types";

/**
 * Auth store — now a CACHE of the server-side session, not the source of
 * truth. The cookie is the source of truth; `loadMe()` is how we hydrate.
 *
 * What we persist in sessionStorage is non-sensitive: a display identifier,
 * a role, and a cached display name so we don't flash an empty TopBar on
 * page transitions. Anything sensitive (tokens, OTPs, PAN) MUST NEVER live
 * here.
 */

export interface MeUser {
  id: string;
  role: Role | null;
  email: string | null;
  phone: string | null;
  displayName: string | null;
  legalName: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  profileCompletedAt: string | null;
}

export interface MeResponse {
  authenticated: boolean;
  next: string;
  hasProfile: boolean;
  rememberMe?: boolean;
  user: MeUser;
}

interface SessionMeta {
  sessionId: string;        // synthetic; the real session id lives server-side
  signedInAt: string;
  expiresAt: string;        // synthetic; server is authoritative
  displayIdentifier: string;
}

interface AuthState {
  bootstrapped: boolean;
  loading: boolean;
  session: SessionMeta | null;
  me: MeUser | null;
  role: Role | null;
  profileId: string | null;
  profile: AnyProfile | null;
  /** Most recent next URL hint from the server. */
  next: string | null;
  /** In-flight /me Promise — used to de-dup concurrent callers
   *  (e.g. React StrictMode double-firing an effect in dev). Not persisted. */
  _meInFlight: Promise<MeResponse | null> | null;

  loadMe: () => Promise<MeResponse | null>;
  /** Kept for backward compatibility with the OTP form. Mostly a no-op now;
   *  the cookie set by verify-otp is what actually authenticates. */
  signIn: (args: {
    sessionId?: string;
    displayIdentifier: string;
    role?: Role;
    profileId?: string;
  }) => void;
  setProfile: (profile: AnyProfile) => void;
  setRole: (role: Role) => void;
  signOut: () => Promise<void>;
  isExpired: () => boolean;
  setBootstrapped: () => void;
}

function synthProfileFromMe(me: MeUser): AnyProfile | null {
  if (!me.profileCompletedAt || !me.role) return null;
  const common = {
    id: me.id,
    role: me.role,
    displayName: me.displayName ?? me.email ?? me.phone ?? "Member",
    email: me.email ?? "",
    mobile: me.phone ?? "",
    emailVerified: me.emailVerified,
    mobileVerified: me.phoneVerified,
    profileStatus: "verified" as const,
    profileCompleteness: 100,
    createdAt: new Date(0).toISOString(),
    lastLoginAt: new Date().toISOString(),
  };
  if (me.role === "taxpayer") {
    return {
      ...common,
      role: "taxpayer",
      personal: {
        legalName: me.legalName ?? me.displayName ?? "",
        dateOfBirth: "",
        gender: "prefer_not_to_say",
        residentialStatus: "resident",
      },
      identity: {
        panMasked: "•••••••••",
        panEntity: "Individual",
        aadhaarMasked: "XXXX XXXX ••••",
        panVerified: true,
        aadhaarVerified: true,
      },
      address: {
        line1: "",
        city: "",
        state: "",
        pin: "",
        country: "IN",
      },
      taxProfile: {
        primaryIncomeType: "salary",
        hasBusinessIncome: false,
        consents: {
          documentProcessing: true,
          aiAnalysis: false,
          dataRetention: true,
        },
      },
    };
  }
  return {
    ...common,
    role: "consultant",
    personal: {
      legalName: me.legalName ?? me.displayName ?? "",
      dateOfBirth: "",
      gender: "prefer_not_to_say",
    },
    credentials: {
      icaiMembership: "",
      cop: true,
      yearsExperience: 0,
      specializations: [],
    },
    identity: {
      panMasked: "•••••••••",
      aadhaarMasked: "XXXX XXXX ••••",
      panVerified: true,
      aadhaarVerified: true,
    },
    practice: {
      line1: "",
      city: "",
      state: "",
      pin: "",
      country: "IN",
    },
  };
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      bootstrapped: false,
      loading: false,
      session: null,
      me: null,
      role: null,
      profileId: null,
      profile: null,
      next: null,
      _meInFlight: null,

      loadMe: async () => {
        // De-duplicate concurrent callers (React StrictMode in dev calls
        // each effect twice; consumers also call loadMe from multiple
        // places). Returning the same Promise keeps everyone consistent.
        const inflight = get()._meInFlight;
        if (inflight) return inflight;

        const promise = (async (): Promise<MeResponse | null> => {
          set({ loading: true });
          try {
            const res = await fetch("/api/auth/me", {
              method: "GET",
              credentials: "same-origin",
              cache: "no-store",
            });
            if (res.status === 401) {
              set({
                session: null,
                me: null,
                role: null,
                profileId: null,
                profile: null,
                next: "/login",
              });
              return null;
            }
            if (!res.ok) return null;
            const data = (await res.json()) as MeResponse;
            const display =
              data.user.email ??
              (data.user.phone ? `+91 ${data.user.phone}` : "Signed in");
            set({
              me: data.user,
              role: data.user.role,
              profileId: data.user.id,
              profile: synthProfileFromMe(data.user),
              next: data.next,
              session: {
                sessionId: data.user.id,
                signedInAt: new Date().toISOString(),
                expiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(),
                displayIdentifier: display,
              },
            });
            return data;
          } catch {
            return null;
          } finally {
            set({ loading: false, _meInFlight: null });
          }
        })();
        set({ _meInFlight: promise });
        return promise;
      },

      signIn: ({ displayIdentifier, role, profileId }) => {
        // The cookie is already set server-side by verify-otp; this is just
        // a UI cache so the next render has a display identifier.
        const now = Date.now();
        set({
          session: {
            sessionId: profileId ?? "pending",
            signedInAt: new Date(now).toISOString(),
            expiresAt: new Date(now + 365 * 86_400_000).toISOString(),
            displayIdentifier,
          },
          role: role ?? null,
          profileId: profileId ?? null,
        });
      },
      setProfile: (profile) =>
        set({ profile, role: profile.role, profileId: profile.id }),
      setRole: (role) => set({ role }),
      signOut: async () => {
        try {
          await fetch("/api/auth/logout", {
            method: "POST",
            credentials: "same-origin",
          });
        } catch {
          /* fall through and clear local state anyway */
        }
        if (typeof window !== "undefined") {
          try {
            for (let i = window.sessionStorage.length - 1; i >= 0; i--) {
              const k = window.sessionStorage.key(i);
              if (k?.startsWith("glmra.")) window.sessionStorage.removeItem(k);
            }
          } catch {
            /* noop */
          }
        }
        set({
          session: null,
          me: null,
          role: null,
          profileId: null,
          profile: null,
          next: "/login",
        });
      },
      isExpired: () => {
        // Server owns expiry. Locally, "expired" just means "no live cache".
        return get().session === null;
      },
      setBootstrapped: () => set({ bootstrapped: true }),
    }),
    {
      name: "glmra.session",
      storage: createJSONStorage(() => {
        if (typeof window === "undefined") {
          return {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {},
          };
        }
        return window.sessionStorage;
      }),
      partialize: (s) => ({
        // Cache only non-sensitive UI hints; the cookie + /api/auth/me are
        // the source of truth. `me` is cached so first paint doesn't flash.
        me: s.me,
        session: s.session,
        role: s.role,
        profileId: s.profileId,
        next: s.next,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setBootstrapped();
      },
    },
  ),
);
