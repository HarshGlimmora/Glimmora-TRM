"use client";

import * as React from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input, Field } from "@/components/ui/Input";
import { Icon } from "@/components/shared/Icon";
import { connectConsultantByCode } from "@/lib/api";
import { sanitizeDigits } from "@/lib/security/sanitize";

/**
 * 5-digit invite-code redemption box. Used by taxpayers when their CA has
 * shared a code directly (game-ID style). On success the grant lands
 * `active` immediately because the CA already pre-approved by issuing the
 * code — no second-side accept needed.
 */
export function ConnectViaCode(props: {
  onConnected: () => void;
}) {
  const [code, setCode] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);

  const valid = /^\d{5}$/.test(code);

  const submit = async () => {
    setError(null);
    setSuccess(null);
    if (!valid) {
      setError("Enter a 5-digit code (digits only).");
      return;
    }
    try {
      setSubmitting(true);
      await connectConsultantByCode({ code });
      setSuccess("Linked. The consultant has been notified.");
      setCode("");
      props.onConnected();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not redeem code.";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      aria-label="Connect via code"
      className="flex flex-col gap-4 rounded-2xl border border-line bg-surface-raised p-5"
    >
      <header>
        <p className="text-2xs font-medium uppercase tracking-widest text-ink-subtle">
          Connect via code
        </p>
        <h2 className="mt-1 text-base font-semibold tracking-[-0.005em] text-ink">
          Got a 5-digit invite code from your CA?
        </h2>
        <p className="mt-1 text-xs text-ink-muted">
          Paste it below. The connection becomes active immediately because
          your CA pre-approved it.
        </p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        noValidate
      >
        <Field label="Invite code" required htmlFor="invite-code" className="flex-1">
          <Input
            id="invite-code"
            value={code}
            onChange={(e) => {
              setError(null);
              setSuccess(null);
              setCode(sanitizeDigits(e.target.value, 5));
            }}
            placeholder="12345"
            inputMode="numeric"
            autoComplete="off"
            maxLength={5}
            className="tabular tracking-[0.45em] text-lg font-semibold uppercase"
          />
        </Field>
        <Button
          type="submit"
          loading={submitting}
          disabled={!valid || submitting}
          leftIcon={<Icon.Link size={14} />}
        >
          Connect
        </Button>
      </form>

      {error && (
        <Alert tone="error" compact>
          {error}
        </Alert>
      )}
      {success && (
        <Alert tone="success" compact>
          {success}
        </Alert>
      )}
    </section>
  );
}
