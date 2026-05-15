"use client";

import * as React from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import type { PrecheckResponse } from "@/lib/api/regime";

interface Props {
  open: boolean;
  precheck: PrecheckResponse | null;
  filingYear: string;
  busy?: boolean;
  onCancel: () => void;
  /** Called only when the user has acknowledged. The page hashes the text. */
  onAcknowledge: (acknowledgmentText: string) => void;
}

/**
 * Section 115BAC(6) acknowledgment modal. Shown when /precheck-regime returns
 * `WARN_HIGH`. The body displays the server-supplied `acknowledgment_text`
 * verbatim so the client's sha256 matches what the server stores.
 */
export function Section115BACModal({
  open,
  precheck,
  filingYear,
  busy,
  onCancel,
  onAcknowledge,
}: Props) {
  const [agreed, setAgreed] = React.useState(false);

  React.useEffect(() => {
    if (!open) setAgreed(false);
  }, [open]);

  if (!precheck || precheck.level !== "WARN_HIGH") return null;

  const ackText = precheck.acknowledgment_text ?? "";
  const ref = precheck.section_referenced ?? "115BAC(6)";

  return (
    <Modal
      open={open}
      onClose={onCancel}
      dismissible={!busy}
      size="lg"
      title={
        <span className="flex items-center gap-2">
          <span aria-hidden>⚠</span>
          Section {ref} — One-time lifetime switch
        </span>
      }
      description={precheck.message ?? undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => onAcknowledge(ackText)}
            disabled={!agreed || busy}
            loading={busy}
          >
            I acknowledge — Proceed
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-line-subtle bg-surface-sunken/60 p-4 text-sm text-ink">
          <p className="text-xs uppercase tracking-wide text-ink-muted">
            Filing FY
          </p>
          <p className="font-medium">{filingYear}</p>
          <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-ink-muted">Previous regime</dt>
            <dd className="text-ink">
              {precheck.previous_regime ?? "—"}
            </dd>
            <dt className="text-ink-muted">Requested regime</dt>
            <dd className="text-ink">{precheck.requested_regime}</dd>
            <dt className="text-ink-muted">Lifetime switch-backs used</dt>
            <dd className="text-ink">
              {precheck.lifetime_switch_backs_used} of 1
            </dd>
            {precheck.form_10iea_required && (
              <>
                <dt className="text-ink-muted">Form 10-IEA</dt>
                <dd className="text-signal-warning">
                  Required before the §139(1) due date
                </dd>
              </>
            )}
          </dl>
        </div>

        <p className="text-sm text-ink text-pretty">
          Read the statement below carefully. Submitting your acknowledgment
          records a hashed copy of this exact text on your filing&apos;s audit
          trail.
        </p>

        <blockquote className="rounded-lg border border-line bg-surface-raised p-4 text-sm italic text-ink text-pretty">
          {ackText}
        </blockquote>

        <Checkbox
          checked={agreed}
          onChange={(e) => setAgreed(e.currentTarget.checked)}
          label="I have read and understood the statement above."
          description={`Source: Income Tax Act, 1961 — Section ${ref}.`}
        />
      </div>
    </Modal>
  );
}
