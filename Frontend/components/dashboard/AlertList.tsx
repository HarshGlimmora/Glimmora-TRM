import * as React from "react";
import Link from "next/link";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import type { DashboardAlert } from "@/lib/types";
import { Icon } from "@/components/shared/Icon";

export function AlertList({ alerts }: { alerts: DashboardAlert[] }) {
  if (alerts.length === 0) return null;
  return (
    <div className="grid gap-3">
      {alerts.map((a) => (
        <Alert
          key={a.id}
          tone={a.level === "warning" ? "warning" : a.level === "error" ? "error" : "info"}
          title={a.title}
          action={
            a.cta && (
              <Link href={a.cta.href}>
                <Button
                  variant="outline"
                  size="sm"
                  rightIcon={<Icon.ChevronRight size={12} />}
                >
                  {a.cta.label}
                </Button>
              </Link>
            )
          }
        >
          {a.body}
        </Alert>
      ))}
    </div>
  );
}
