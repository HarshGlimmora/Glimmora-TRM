"use client";

import * as React from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input, Field } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Icon } from "@/components/shared/Icon";
import { connectConsultantByCode } from "@/lib/api";
import { sanitizeDigits } from "@/lib/security/sanitize";

/**
 * Modal-driven 5-digit invite-code redemption. Opened from the
 * "Connect with code" button in the Connections-page header.
 *
 * The connection becomes `active` immediately because the CA already
 * pre-approved by issuing the code — no second-side accept needed. The
 * POST hits the existing `/api/ca-link/by-code` endpoint; nothing about
 * the linksService flow changes.
 */
export function ConnectViaCodeModal({
  open,
  onClose,
  onConnected,
}: {
  open: boolean;
  onClose: () => void;
  /** Called after a successful redemption so the parent can refresh its
   *  grant list + active-connections card. */
  onConnected: () => void;
}) {
  const [code, setCode] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Reset form state every time the modal opens so a previous attempt
  // doesn't leak into the next session.
  React.useEffect(() => {
    if (open) {
      setCode("");
      setSubmitting(false);
      setError(null);
    }
  }, [open]);

  const valid = /^\d{5}$/.test(code);

  const submit = async () => {
    setError(null);
    if (!valid) {
      setError("Enter a 5-digit code (digits only).");
      return;
    }
    try {
      setSubmitting(true);
      await connectConsultantByCode({ code });
      onConnected();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not redeem code.";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Connect with a 5-digit code"
      description="Your CA issued you a short numeric code. Pasting it links you immediately — no separate approval needed."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!valid || submitting}
            loading={submitting}
            leftIcon={<Icon.Link size={14} />}
          >
            Connect
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-5"
        noValidate
      >
        <Field label="Invite code" required htmlFor="invite-code">
          <Input
            id="invite-code"
            value={code}
            onChange={(e) => {
              setError(null);
              setCode(sanitizeDigits(e.target.value, 5));
            }}
            placeholder="12345"
            inputMode="numeric"
            autoComplete="off"
            maxLength={5}
            autoFocus
            className="tabular tracking-[0.45em] text-lg font-semibold uppercase"
          />
        </Field>

        {error && (
          <Alert tone="error" compact>
            {error}
          </Alert>
        )}

        <Alert tone="info" compact>
          The code can be shared on the consultant's invite panel. Each
          redemption is logged on both sides of the audit trail.
        </Alert>

        {/* Hidden submit so Enter inside the input triggers the form. */}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}
