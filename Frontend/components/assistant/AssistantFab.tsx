"use client";

import * as React from "react";
import { Icon } from "@/components/shared/Icon";
import { cn } from "@/lib/utils/cn";

interface AssistantFabProps {
  onOpen: () => void;
  visible: boolean;
}

/**
 * The floating launcher pinned to the bottom-right of the viewport. Stays
 * out of the way of the main flow and is dismissed by clicking the panel's
 * minimise / close buttons.
 */
export function AssistantFab({ onOpen, visible }: AssistantFabProps) {
  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Open Glimmora assistant"
      className={cn(
        "fixed bottom-6 right-6 z-40 flex items-center gap-2",
        "rounded-full border border-navy-deep/30 bg-navy pl-3 pr-4 py-2.5 text-white",
        "shadow-elevated transition-all duration-200",
        "hover:bg-navy-deep hover:shadow-[0_12px_32px_-10px_hsl(var(--shadow)/0.35)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
        "animate-fade-up",
      )}
    >
      <span
        aria-hidden
        className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 ring-1 ring-inset ring-white/15"
      >
        <Icon.Sparkle size={14} />
      </span>
      <span className="text-[13px] font-medium tracking-[-0.005em]">Ask Glimmora</span>
    </button>
  );
}
