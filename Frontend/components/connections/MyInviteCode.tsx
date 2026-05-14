"use client";

import * as React from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/shared/Icon";
import {
  getMyInviteCode,
  rotateMyInviteCode,
  type InviteCodeDTO,
} from "@/lib/api";

/**
 * Consultant-facing panel showing the CA's own 5-digit invite code. Auto-
 * issues a code on first view so the CA always has something to share.
 * "Rotate" issues a fresh code and revokes the previous one — useful if
 * the code was shared with the wrong person.
 */
export function MyInviteCode() {
  const [code, setCode] = React.useState<InviteCodeDTO | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [rotating, setRotating] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    (async () => {
      try {
        const c = await getMyInviteCode();
        setCode(c);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Could not load code.";
        setError(msg);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable */
    }
  };

  const rotate = async () => {
    setError(null);
    setRotating(true);
    try {
      const c = await rotateMyInviteCode();
      setCode(c);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not rotate code.";
      setError(msg);
    } finally {
      setRotating(false);
    }
  };

  return (
    <section
      aria-label="Your invite code"
      className="flex flex-col gap-3 rounded-2xl border border-line bg-surface-raised p-5"
    >
      <header className="flex items-start justify-between gap-2">
        <div>
          <p className="text-2xs font-medium uppercase tracking-widest text-ink-subtle">
            Your invite code
          </p>
          <h2 className="mt-1 text-base font-semibold tracking-[-0.005em] text-ink">
            Share this with prospective clients
          </h2>
          <p className="mt-1 text-xs text-ink-muted">
            Anyone who pastes this 5-digit code on Glimmora gets immediate
            review/edit access to their filing.
          </p>
        </div>
        {code && (
          <Badge tone="success" size="sm" withDot>
            Active
          </Badge>
        )}
      </header>

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : error ? (
        <Alert tone="error" compact>
          {error}
        </Alert>
      ) : code ? (
        <div className="flex flex-wrap items-center gap-3">
          <span
            className="tabular text-3xl font-semibold tracking-[0.45em] text-ink"
            aria-label={`Invite code ${code.code.split("").join(" ")}`}
          >
            {code.code}
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void copy()}
              leftIcon={<Icon.Check size={12} />}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void rotate()}
              loading={rotating}
              leftIcon={<Icon.Refresh size={12} />}
            >
              Rotate
            </Button>
          </div>
          <span className="text-2xs text-ink-subtle">
            Used {code.usedCount} / {code.maxUses}
          </span>
        </div>
      ) : null}
    </section>
  );
}
