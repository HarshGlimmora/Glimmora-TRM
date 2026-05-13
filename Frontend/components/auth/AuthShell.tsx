import * as React from "react";
import Link from "next/link";
import { Logo } from "@/components/shared/Logo";
import { TrustMarks } from "@/components/shared/TrustMarks";
import { cn } from "@/lib/utils/cn";

interface AuthShellProps {
  children: React.ReactNode;
  step?: { current: number; total: number; label: string };
}

const PROOF_POINTS = [
  {
    eyebrow: "Identity",
    title: "PAN & Aadhaar verified at source",
    body: "Validators check format, checksum, and entity codes before a value ever leaves your device.",
  },
  {
    eyebrow: "Trust model",
    title: "Three-layer principle",
    body: "Deterministic rules decide every calculation. AI only assists. RAG explains, never executes.",
  },
  {
    eyebrow: "Consent",
    title: "Auditable by default",
    body: "Every grant, revocation, and identity check is recorded in an append-only audit log.",
  },
];

export function AuthShell({ children, step }: AuthShellProps) {
  return (
    <div className="min-h-dvh bg-vellum">
      <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
        {/* Brand / trust panel */}
        <aside className="relative hidden overflow-hidden bg-sovereign text-white lg:flex lg:flex-col lg:p-12 xl:p-16">
          <div className="absolute inset-0 bg-fine-noise opacity-50" aria-hidden />
          <div
            className="absolute inset-0 opacity-[0.06]"
            aria-hidden
            style={{
              backgroundImage:
                "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
              backgroundSize: "48px 48px",
            }}
          />

          <header className="relative z-10 flex items-center justify-between">
            <Logo size="md" inverse />
            <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-3 py-1 text-2xs font-medium uppercase tracking-widest text-white/75">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-soft-pulse rounded-full bg-emerald-300" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-300" />
              </span>
              Secure session
            </span>
          </header>

          <div className="relative z-10 mt-16 max-w-md">
            <p className="micro-label text-white/60">
              Sovereign Tax Resource Management
            </p>
            <h1 className="mt-3 font-display text-5xl leading-[1.05] text-white">
              Tax administration,
              <br />
              earned trust.
            </h1>
            <p className="mt-5 max-w-[42ch] text-pretty text-base/relaxed text-white/75">
              Verified identity, audited access, and deterministic rules — built
              for India&apos;s taxpayers and the consultants who advise them.
            </p>
          </div>

          <ul className="relative z-10 mt-12 grid max-w-md gap-5">
            {PROOF_POINTS.map((p) => (
              <li
                key={p.title}
                className="rounded-xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-[2px]"
              >
                <p className="text-2xs font-medium uppercase tracking-widest text-white/55">
                  {p.eyebrow}
                </p>
                <p className="mt-1 text-[15px] font-medium text-white">
                  {p.title}
                </p>
                <p className="mt-1 text-sm/relaxed text-white/65">{p.body}</p>
              </li>
            ))}
          </ul>

          <footer className="relative z-10 mt-auto flex items-center justify-between pt-12 text-2xs uppercase tracking-widest text-white/55">
            <span>© Glimmora TRM · India</span>
            <span>v0.1 Demo · Frontend preview</span>
          </footer>
        </aside>

        {/* Form panel */}
        <main
          id="main"
          className="relative flex flex-col"
        >
          <header className="flex items-center justify-between px-6 py-5 lg:px-12">
            <Link href="/" aria-label="Glimmora home" className="lg:hidden">
              <Logo size="sm" />
            </Link>
            <span className="hidden lg:inline-flex" />
            <nav className="flex items-center gap-3 text-sm text-ink-muted">
              <Link
                href="/login"
                className="rounded-md px-2 py-1 hover:text-ink hover:underline underline-offset-4"
              >
                Sign in
              </Link>
              <span aria-hidden className="h-3 w-px bg-line" />
              <a
                href="mailto:trust@glimmora.in"
                className="rounded-md px-2 py-1 hover:text-ink hover:underline underline-offset-4"
              >
                Help
              </a>
            </nav>
          </header>

          <div className="flex flex-1 items-center justify-center px-6 pb-12 pt-6 lg:px-12">
            <div className="w-full max-w-[440px]">
              {step && (
                <div className="mb-8">
                  <div className="flex items-baseline justify-between">
                    <span className="micro-label">
                      Step {step.current} of {step.total}
                    </span>
                    <span className="text-2xs font-medium uppercase tracking-widest text-ink">
                      {step.label}
                    </span>
                  </div>
                  <div className="mt-2.5 grid grid-flow-col gap-1.5">
                    {Array.from({ length: step.total }).map((_, i) => (
                      <span
                        key={i}
                        aria-hidden
                        className={cn(
                          "h-[3px] rounded-full",
                          i < step.current ? "bg-navy" : "bg-line",
                        )}
                      />
                    ))}
                  </div>
                </div>
              )}
              {children}
            </div>
          </div>

          <footer className="px-6 pb-8 pt-2 lg:px-12">
            <div className="mx-auto w-full max-w-[440px]">
              <TrustMarks className="opacity-90" />
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}
