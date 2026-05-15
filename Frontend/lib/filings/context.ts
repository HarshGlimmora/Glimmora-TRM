"use client";

import * as React from "react";
import type { FilingDTO } from "@/lib/api/filings";

export interface FilingCtx {
  filing: FilingDTO;
  refresh: () => Promise<void>;
}

export const FilingContext = React.createContext<FilingCtx | null>(null);

export function useFiling(): FilingCtx {
  const ctx = React.useContext(FilingContext);
  if (!ctx) {
    throw new Error("useFiling must be used inside /filings/[id]/* pages");
  }
  return ctx;
}
