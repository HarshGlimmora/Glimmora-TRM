"use client";

import { usePathname } from "next/navigation";
import { resolvePageContext, type PageContext } from "@/lib/assistant/pageRegistry";

/** Resolves the assistant's current page context from the live pathname. */
export function usePageContext(): PageContext {
  const pathname = usePathname();
  return resolvePageContext(pathname);
}
