"use client";

import * as React from "react";
import { fetchProgress, saveProgress, type OnboardingProgress } from "@/lib/api";
import { useOnboardingStore } from "@/lib/store/onboarding-store";

/**
 * Bridge `useOnboardingStore` (sessionStorage cache) <-> `/api/onboarding/progress`
 * (Postgres source of truth).
 *
 * On mount we pull the server-saved draft and patch the local store so the
 * user resumes at the exact step they were last on. After mount we debounce
 * pushes to the server whenever the local store changes.
 *
 * Sensitive identity values (raw PAN, full Aadhaar) are never sent here —
 * the onboarding store only holds non-sensitive draft fields plus boolean
 * identityFlags.
 */
export function useOnboardingServerSync(args: { authReady: boolean }): {
  hydrated: boolean;
} {
  const store = useOnboardingStore();
  const [hydrated, setHydrated] = React.useState(false);
  const lastSerialised = React.useRef<string>("");
  const inFlight = React.useRef<boolean>(false);

  // Hydrate from server on mount.
  React.useEffect(() => {
    if (!args.authReady) return;
    let cancelled = false;
    (async () => {
      try {
        const server = await fetchProgress();
        if (cancelled) return;
        // Merge server-saved draft into the local store. We trust the
        // server over local when both exist.
        const s = useOnboardingStore.getState();
        if (server.role && !s.role) s.setRole(server.role);
        if (typeof server.step === "number" && server.step !== s.step) {
          s.setStep(server.step);
        }
        if (server.personal && Object.keys(server.personal).length) {
          s.patchPersonal(server.personal as Record<string, never>);
        }
        if (server.contact && Object.keys(server.contact).length) {
          s.patchContact(server.contact as Record<string, never>);
        }
        if (server.address && Object.keys(server.address).length) {
          s.patchAddress(server.address as Record<string, never>);
        }
        if (server.taxProfile && Object.keys(server.taxProfile).length) {
          s.patchTaxProfile(server.taxProfile as Record<string, never>);
        }
        if (server.credentials && Object.keys(server.credentials).length) {
          s.patchCredentials(server.credentials as Record<string, never>);
        }
        if (server.identityFlags && Object.keys(server.identityFlags).length) {
          s.patchIdentityFlags(server.identityFlags as Record<string, never>);
        }
      } catch {
        /* server save isn't load-bearing for the UI to render */
      } finally {
        if (!cancelled) {
          // Snapshot current state so the first push doesn't fire immediately.
          lastSerialised.current = serialiseDraft(useOnboardingStore.getState());
          setHydrated(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [args.authReady]);

  // Push to server on debounced change.
  React.useEffect(() => {
    if (!hydrated) return;
    const id = setTimeout(() => {
      const snap = serialiseDraft(store);
      if (snap === lastSerialised.current || inFlight.current) return;
      inFlight.current = true;
      const payload: Partial<OnboardingProgress> = {
        step: store.step,
        personal: store.personal as unknown as Record<string, unknown>,
        contact: store.contact as unknown as Record<string, unknown>,
        address: store.address as unknown as Record<string, unknown>,
        taxProfile: store.taxProfile as unknown as Record<string, unknown>,
        credentials: store.credentials as unknown as Record<string, unknown>,
        identityFlags: store.identityFlags as unknown as Record<string, unknown>,
      };
      saveProgress(payload)
        .then(() => {
          lastSerialised.current = snap;
        })
        .catch(() => {
          /* server save isn't load-bearing for UX */
        })
        .finally(() => {
          inFlight.current = false;
        });
    }, 800);
    return () => clearTimeout(id);
  }, [
    hydrated,
    store,
    store.step,
    store.personal,
    store.contact,
    store.address,
    store.taxProfile,
    store.credentials,
    store.identityFlags,
  ]);

  return { hydrated };
}

function serialiseDraft(s: ReturnType<typeof useOnboardingStore.getState>): string {
  return JSON.stringify({
    step: s.step,
    personal: s.personal,
    contact: s.contact,
    address: s.address,
    taxProfile: s.taxProfile,
    credentials: s.credentials,
    identityFlags: s.identityFlags,
  });
}
