import * as React from "react";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Icon } from "@/components/shared/Icon";
import { formatDate } from "@/lib/utils/format";

export function UpcomingList({
  items,
}: {
  items: { title: string; dueOn: string; note?: string }[] | undefined;
}) {
  if (!items || items.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Upcoming</CardTitle>
        <CardDescription className="mt-1">
          Calendar items and obligations on your horizon.
        </CardDescription>
      </CardHeader>
      <CardBody className="pt-3">
        <ul className="grid gap-2">
          {items.map((it) => {
            const days = Math.ceil(
              (new Date(it.dueOn).getTime() - Date.now()) / 86_400_000,
            );
            const tone =
              days < 0
                ? "text-signal-error"
                : days <= 7
                  ? "text-signal-warning"
                  : "text-ink-muted";
            return (
              <li
                key={it.title}
                className="grid grid-cols-[auto_1fr_auto] items-start gap-3 rounded-lg border border-line bg-surface-raised px-4 py-3"
              >
                <span
                  aria-hidden
                  className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-md bg-navy-tint text-navy"
                >
                  <Icon.Clock size={14} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{it.title}</p>
                  {it.note && (
                    <p className="mt-0.5 text-xs text-ink-muted text-pretty">
                      {it.note}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-xs font-medium text-ink">
                    {formatDate(it.dueOn)}
                  </p>
                  <p className={`mt-0.5 text-2xs uppercase tracking-widest ${tone}`}>
                    {days >= 0 ? `${days} days` : `${Math.abs(days)} days overdue`}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </CardBody>
    </Card>
  );
}
