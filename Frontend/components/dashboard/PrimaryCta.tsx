import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/shared/Icon";
import { Badge } from "@/components/ui/Badge";
import type { Role } from "@/lib/types";

export function PrimaryCta({
  role,
  displayName,
}: {
  role: Role;
  displayName: string;
}) {
  const first = displayName.split(" ")[0] ?? displayName;
  return (
    <section className="relative overflow-hidden rounded-2xl border border-navy/15 bg-sovereign text-white shadow-elevated">
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.08]"
        style={{
          backgroundImage:
            "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
          backgroundSize: "44px 44px",
        }}
      />
      <div className="absolute inset-0 bg-fine-noise opacity-40" aria-hidden />
      <div className="relative grid gap-6 px-7 py-8 sm:grid-cols-[1.4fr_1fr] sm:gap-10 sm:px-10 sm:py-10">
        <div>
          <Badge
            tone="seal"
            size="sm"
            className="border-white/20 bg-white/10 text-white"
            withDot
          >
            {role === "taxpayer" ? "FY 2024-25" : "Consultant"}
          </Badge>
          <h1 className="mt-4 font-display text-5xl leading-[1.05] text-white">
            Welcome back,
            <br />
            {first}.
          </h1>
          <p className="mt-3 max-w-prose text-pretty text-base/relaxed text-white/75">
            {role === "taxpayer"
              ? "Your verified profile is ready. Begin assembling your FY 2024-25 return — or invite a chartered accountant to help."
              : "Open client requests and active engagements appear below. Every action you take here is recorded in the taxpayer's audit trail."}
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link href="/connections">
              <Button
                variant="secondary"
                size="lg"
                className="border-white/20 bg-white text-navy-deep hover:bg-white/90"
                rightIcon={<Icon.ArrowRight size={16} />}
              >
                {role === "taxpayer" ? "Link a consultant" : "Open requests"}
              </Button>
            </Link>
            <Link href={role === "taxpayer" ? "/filings/new" : "#"}>
              <Button
                variant="ghost"
                size="lg"
                className="text-white hover:bg-white/10"
              >
                {role === "taxpayer" ? "Begin filing" : "Practice settings"}
              </Button>
            </Link>
          </div>
        </div>

        <div className="hidden flex-col gap-3 sm:flex">
          <SealCard
            title="Trust model"
            body="Rules decide. AI assists. RAG explains."
          />
          <SealCard
            title="Audit trail"
            body="Every grant, revocation & verification is append-only."
          />
          <SealCard
            title="Identity"
            body="PAN & Aadhaar masked across the platform."
          />
        </div>
      </div>
    </section>
  );
}

function SealCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-[2px]">
      <p className="text-2xs font-medium uppercase tracking-widest text-white/55">
        {title}
      </p>
      <p className="mt-1 text-sm text-white/85 text-pretty">{body}</p>
    </div>
  );
}
