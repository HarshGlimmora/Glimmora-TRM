import * as React from "react";
import { cn } from "@/lib/utils/cn";

interface FormSectionProps {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

export function FormSection({
  eyebrow,
  title,
  description,
  children,
  footer,
  className,
}: FormSectionProps) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-2xl border border-line bg-surface-raised shadow-card",
        className,
      )}
    >
      <header className="border-b border-line-subtle px-7 pb-5 pt-6">
        {eyebrow && (
          <p className="micro-label text-navy/70">{eyebrow}</p>
        )}
        <h1 className="mt-1 font-display text-3xl leading-tight text-ink">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-2xl text-pretty text-sm/relaxed text-ink-muted">
            {description}
          </p>
        )}
      </header>
      <div className="px-7 py-6">{children}</div>
      {footer && (
        <footer className="flex items-center justify-between gap-3 border-t border-line-subtle bg-surface-sunken/40 px-7 py-4">
          {footer}
        </footer>
      )}
    </section>
  );
}

export function FormGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-5 sm:grid-cols-2", className)}>{children}</div>
  );
}

export function FormRow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-5", className)}>{children}</div>
  );
}
