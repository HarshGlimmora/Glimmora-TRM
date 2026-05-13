"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  children?: React.ReactNode;
  footer?: React.ReactNode;
  dismissible?: boolean;
}

const SIZES = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
};

export function Modal({
  open,
  onClose,
  title,
  description,
  size = "md",
  children,
  footer,
  dismissible = true,
}: ModalProps) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissible) onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, dismissible, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? "modal-title" : undefined}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div
        aria-hidden
        onClick={() => dismissible && onClose()}
        className="absolute inset-0 bg-navy-deep/40 backdrop-blur-sm animate-fade-in"
      />
      <div
        className={cn(
          "relative w-full overflow-hidden rounded-2xl border border-line-strong bg-surface-raised shadow-elevated animate-scale-in",
          SIZES[size],
        )}
      >
        {(title || description) && (
          <header className="border-b border-line-subtle px-6 pb-4 pt-5">
            {title && (
              <h2
                id="modal-title"
                className="text-lg font-semibold tracking-[-0.005em] text-ink"
              >
                {title}
              </h2>
            )}
            {description && (
              <p className="mt-1 text-sm text-ink-muted text-pretty">
                {description}
              </p>
            )}
          </header>
        )}
        <div className="px-6 py-5">{children}</div>
        {footer && (
          <footer className="flex items-center justify-end gap-3 border-t border-line-subtle bg-surface-sunken/60 px-6 py-3.5">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
