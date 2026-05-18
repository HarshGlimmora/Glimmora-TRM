"use client";

import * as React from "react";
import { Icon } from "@/components/shared/Icon";
import { cn } from "@/lib/utils/cn";

interface AssistantFabProps {
  onOpen: () => void;
  visible: boolean;
}

/**
 * The floating launcher pinned to the bottom-right of the viewport.
 *
 *   - `position: fixed` plus explicit `right`/`bottom` inline styles so no
 *     parent transform / RTL inheritance / anim utility can push it off-axis.
 *   - Two concentric ripple rings + a navy halo behind the pill so it
 *     clearly announces itself without being shouty.
 *   - Stays mounted at all times on non-suppressed screens; the entrance
 *     animation only fires once per mount, not on every navigation.
 */
export function AssistantFab({ onOpen, visible }: AssistantFabProps) {
  return (
    <div
      data-testid="assistant-fab"
      aria-hidden={!visible}
      style={{
        position: "fixed",
        right: "1.5rem",
        bottom: "1.5rem",
        zIndex: 45,
        pointerEvents: visible ? "auto" : "none",
      }}
      className={cn(
        "transition-opacity duration-200",
        visible ? "opacity-100" : "opacity-0",
      )}
    >
      <div className="relative">
        {/* Ripple rings — behind the button, never intercept clicks. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full bg-navy/30 animate-fab-ripple motion-reduce:hidden"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full bg-accent/25 animate-fab-ripple motion-reduce:hidden"
          style={{ animationDelay: "1.2s" }}
        />

        <button
          type="button"
          onClick={onOpen}
          aria-label="Open Glimmora assistant"
          className={cn(
            "relative z-10 flex items-center gap-2",
            "rounded-full border border-navy-deep/40 bg-navy pl-2.5 pr-4 py-2.5 text-white",
            "shadow-elevated animate-fab-glow motion-reduce:animate-none",
            "transition-transform duration-150",
            "hover:bg-navy-deep hover:-translate-y-[1px]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
          )}
        >
          <span
            aria-hidden
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/12 ring-1 ring-inset ring-white/20"
          >
            <Icon.Sparkle size={15} />
          </span>
          <span className="text-[13px] font-medium tracking-[-0.005em]">
            Ask Glimmora
          </span>
          <span
            aria-hidden
            className="ml-0.5 flex h-2 w-2 items-center justify-center"
          >
            <span className="block h-1.5 w-1.5 rounded-full bg-seal shadow-[0_0_8px_hsl(var(--seal))]" />
          </span>
        </button>
      </div>
    </div>
  );
}
