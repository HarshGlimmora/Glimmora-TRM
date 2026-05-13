import * as React from "react";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/shared/Icon";
import { cn } from "@/lib/utils/cn";

interface SecurityNoteProps {
  title?: string;
  items: { title: string; body: string }[];
  className?: string;
}

export function SecurityNote({
  title = "How your data is handled",
  items,
  className,
}: SecurityNoteProps) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <div className="border-b border-line-subtle bg-surface-sunken/60 px-5 py-3">
        <p className="flex items-center gap-2 text-2xs font-medium uppercase tracking-widest text-navy">
          <Icon.Shield size={12} />
          {title}
        </p>
      </div>
      <ul className="grid gap-4 px-5 py-4">
        {items.map((it) => (
          <li key={it.title}>
            <p className="text-sm font-medium text-ink">{it.title}</p>
            <p className="mt-1 text-xs text-ink-muted text-pretty">{it.body}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

interface InfoAsideProps {
  title: string;
  body: string;
  cta?: { label: string; href: string };
  className?: string;
}

export function InfoAside({ title, body, cta, className }: InfoAsideProps) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <div className="px-5 py-4">
        <p className="micro-label text-navy/70">Why we ask</p>
        <p className="mt-1 text-sm font-medium text-ink">{title}</p>
        <p className="mt-1.5 text-xs text-ink-muted text-pretty">{body}</p>
        {cta && (
          <a
            href={cta.href}
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-navy hover:underline underline-offset-4"
          >
            {cta.label}
            <Icon.ChevronRight size={12} />
          </a>
        )}
      </div>
    </Card>
  );
}
