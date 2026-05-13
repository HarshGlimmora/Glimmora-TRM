"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { AnyProfile, Role } from "@/lib/types";

/**
 * The auth store carries only non-sensitive UI/session state.
 * Sensitive values (OTP, raw PAN/Aadhaar, tokens) never enter here.
 *
 * Persistence: sessionStorage only, with `partialize` to whitelist fields.
 * Tokens, OTPs, raw identifiers MUST be kept in memory and not persisted.
 */

interface SessionMeta {
  sessionId: string;
  signedInAt: string;
  /** Non-sensitive display target — masked email / mobile */
  displayIdentifier: string;
  /** Approximate session expiry (45 minutes from sign-in for demo) */
  expiresAt: string;
}

interface AuthState {
  bootstrapped: boolean;
  session: SessionMeta | null;
  role: Role | null;
  profileId: string | null;
  profile: AnyProfile | null;

  signIn: (args: {
    sessionId: string;
    displayIdentifier: string;
    role?: Role;
    profileId?: string;
  }) => void;
  setProfile: (profile: AnyProfile) => void;
  setRole: (role: Role) => void;
  signOut: () => void;
  isExpired: () => boolean;
  setBootstrapped: () => void;
}

const SESSION_TTL_MS = 45 * 60_000;

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      bootstrapped: false,
      session: null,
      role: null,
      profileId: null,
      profile: null,

      signIn: ({ sessionId, displayIdentifier, role, profileId }) => {
        const now = Date.now();
        set({
          session: {
            sessionId,
            signedInAt: new Date(now).toISOString(),
            expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
            displayIdentifier,
          },
          role: role ?? null,
          profileId: profileId ?? null,
        });
      },
      setProfile: (profile) => set({ profile, role: profile.role, profileId: profile.id }),
      setRole: (role) => set({ role }),
      signOut: () => {
        if (typeof window !== "undefined") {
          try {
            // Sweep any stray draft state on sign-out
            for (let i = window.sessionStorage.length - 1; i >= 0; i--) {
              const k = window.sessionStorage.key(i);
              if (k?.startsWith("glmra.")) window.sessionStorage.removeItem(k);
            }
          } catch {
            /* noop */
          }
        }
        set({ session: null, role: null, profileId: null, profile: null });
      },
      isExpired: () => {
        const { session } = get();
        if (!session) return true;
        return new Date(session.expiresAt).getTime() < Date.now();
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
      // Whitelist persisted fields — everything else is in-memory only
      partialize: (s) => ({
        session: s.session,
        role: s.role,
        profileId: s.profileId,
        // profile is intentionally NOT persisted; re-hydrate from API after reload
      }),
      onRehydrateStorage: () => (state) => {
        state?.setBootstrapped();
      },
    },
  ),
);
