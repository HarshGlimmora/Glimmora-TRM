"use client";

import * as React from "react";
import {
  Card,
  CardBody,
} from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Icon } from "@/components/shared/Icon";
import {
  connectConsultantById,
  listDirectoryConsultants,
  type DirectoryConsultantDTO,
} from "@/lib/api";
import { SPECIALIZATION_LABELS } from "@/lib/types";
import type { Specialization } from "@/lib/types";

const SPEC_KEYS = Object.keys(SPECIALIZATION_LABELS) as Specialization[];
function isKnownSpec(s: string): s is Specialization {
  return (SPEC_KEYS as readonly string[]).includes(s);
}

/**
 * Marketplace-style consultant cards. Used by taxpayers on the Connections
 * page. A single-click "Connect" sends a pending grant request — same
 * accept/decline semantics as the existing PAN-link flow, just keyed by
 * the consultant's id.
 */
export function BrowseConsultants(props: {
  /** Called after a successful connect so the parent can refresh its
   *  server-side connection list and show the new pending grant. */
  onConnected: (consultantName: string) => void;
}) {
  const [consultants, setConsultants] = React.useState<DirectoryConsultantDTO[] | null>(
    null,
  );
  const [error, setError] = React.useState<string | null>(null);
  const [connecting, setConnecting] = React.useState<string | null>(null);
  const [connected, setConnected] = React.useState<Set<string>>(new Set());

  const refresh = React.useCallback(async () => {
    setError(null);
    try {
      const list = await listDirectoryConsultants();
      setConsultants(list);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not load consultants.";
      setError(msg);
      setConsultants([]);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleConnect = async (c: DirectoryConsultantDTO) => {
    setError(null);
    setConnecting(c.id);
    try {
      await connectConsultantById({ consultantId: c.id });
      setConnected((prev) => {
        const next = new Set(prev);
        next.add(c.id);
        return next;
      });
      props.onConnected(c.displayName);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not connect.";
      setError(msg);
    } finally {
      setConnecting(null);
    }
  };

  return (
    <section
      aria-label="Browse consultants"
      className="flex flex-col gap-4 rounded-2xl border border-line bg-surface-raised p-5"
    >
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <p className="text-2xs font-medium uppercase tracking-widest text-ink-subtle">
            Browse consultants
          </p>
          <h2 className="mt-1 text-base font-semibold tracking-[-0.005em] text-ink">
            Pick a CA from the directory
          </h2>
          <p className="mt-1 text-xs text-ink-muted">
            Send a request with one click. They have 14 days to accept.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void refresh()}
          leftIcon={<Icon.Refresh size={12} />}
        >
          Refresh
        </Button>
      </header>

      {error && (
        <Alert tone="error" compact>
          {error}
        </Alert>
      )}

      {consultants === null ? (
        <p className="text-sm text-ink-muted">Loading directory…</p>
      ) : consultants.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-surface-sunken/40 px-5 py-8 text-center">
          <p className="text-sm font-medium text-ink">
            No consultants are listed yet
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            Try the "Connect via code" panel — your CA can send you a 5-digit
            invite code directly.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {consultants.map((c) => (
            <ConsultantCard
              key={c.id}
              consultant={c}
              loading={connecting === c.id}
              done={connected.has(c.id)}
              onConnect={() => void handleConnect(c)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ConsultantCard({
  consultant,
  loading,
  done,
  onConnect,
}: {
  consultant: DirectoryConsultantDTO;
  loading: boolean;
  done: boolean;
  onConnect: () => void;
}) {
  const specLabel = (s: string) =>
    isKnownSpec(s) ? SPECIALIZATION_LABELS[s] : s.replace(/_/g, " ");
  const location = [consultant.city, consultant.state]
    .filter(Boolean)
    .join(", ");
  const initials = consultant.displayName
    .replace(/^CA\s+/i, "")
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <Card>
      <CardBody className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-navy text-white text-sm font-semibold"
          >
            {initials || <Icon.User size={18} />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-base font-semibold tracking-[-0.005em] text-ink">
                {consultant.displayName}
              </p>
              {consultant.acceptingClients ? (
                <Badge tone="success" size="sm" withDot>
                  Accepting clients
                </Badge>
              ) : (
                <Badge tone="neutral" size="sm">
                  Waitlist
                </Badge>
              )}
            </div>
            <p className="mt-0.5 truncate text-sm text-ink-muted">
              {consultant.firmName ?? "Independent practice"}
              {location ? ` · ${location}` : ""}
            </p>
          </div>
        </div>

        {consultant.specializations.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {consultant.specializations.map((s) => (
              <span
                key={s}
                className="inline-flex items-center rounded-md border border-line bg-surface-sunken px-2 py-0.5 text-2xs font-medium text-ink-muted"
              >
                {specLabel(s)}
              </span>
            ))}
          </div>
        )}

        <dl className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
          <span className="inline-flex items-center gap-1.5">
            <Icon.Check size={11} className="text-signal-success" />
            <dt className="text-2xs font-medium uppercase tracking-widest text-ink-subtle">
              Experience
            </dt>
            <dd className="font-medium text-ink">
              {consultant.yearsExperience ?? 0} years
            </dd>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Icon.Lock size={11} className="text-navy" />
            <dt className="text-2xs font-medium uppercase tracking-widest text-ink-subtle">
              Trust
            </dt>
            <dd className="font-medium text-ink">ICAI verified</dd>
          </span>
        </dl>

        <div className="flex items-center justify-end gap-2 pt-1">
          {done ? (
            <Badge tone="success" size="sm" withDot>
              Request sent
            </Badge>
          ) : (
            <Button
              size="sm"
              onClick={onConnect}
              loading={loading}
              disabled={loading || !consultant.acceptingClients}
              leftIcon={<Icon.Link size={12} />}
            >
              Connect
            </Button>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
