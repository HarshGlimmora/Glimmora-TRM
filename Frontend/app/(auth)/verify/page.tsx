"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Back-compat: `/verify` used to be a separate page in an earlier draft.
 * The OTP step is now inline on `/login`, so any link or bookmark to
 * `/verify` simply lands the user back on `/login`.
 */
export default function VerifyRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/login");
  }, [router]);
  return null;
}
