"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { OtpEntry } from "@/components/filings/OtpEntry";
import { SubmitPreconditions, type PreconditionItem } from "@/components/filings/SubmitPreconditions";
import { useFiling } from "@/lib/filings/context";
import { getProgress, type TxnProgress } from "@/lib/api/transactions";
import {
  requestSubmitOtp,
  submitFiling,
  type RequestSubmitOtpResponse,
  type SubmitResponse,
} from "@/lib/api/submit";

// Canonical accuracy acknowledgment text shown to the user. Audit trail
// records the act of acknowledgment via the boolean flag — the text itself
// is fixed here so the auditor knows exactly what the user agreed to.
const ACK_TEXT =
  "I declare that the information furnished above is true, complete, and " +
  "correct to the best of my knowledge and belief, and that I am authorised " +
  "to submit this return.";

type Stage = "review" | "otp" | "submitted";

function fmtTimeLeft(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function FilingSubmitPage() {
  const router = useRouter();
  const { filing, refresh: refreshFiling } = useFiling();

  const [progress, setProgress] = React.useState<TxnProgress | null>(null);
  const [loadingProgress, setLoadingProgress] = React.useState(true);
  const [progressError, setProgressError] = React.useState<string | null>(null);

  const [acknowledged, setAcknowledged] = React.useState(false);
  const [stage, setStage] = React.useState<Stage>("review");

  const [requestingOtp, setRequestingOtp] = React.useState(false);
  const [otpSession, setOtpSession] = React.useState<RequestSubmitOtpResponse | null>(null);
  const [otpError, setOtpError] = React.useState<{ code: string; message: string } | null>(null);

  const [otp, setOtp] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<{ code: string; message: string } | null>(null);
  const [submitted, setSubmitted] = React.useState<SubmitResponse | null>(null);

  const [secondsLeft, setSecondsLeft] = React.useState(0);

  // Load verify-progress once on mount.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingProgress(true);
      setProgressError(null);
      try {
        const p = await getProgress(filing.id);
        if (!cancelled) setProgress(p);
      } catch (e) {
        if (!cancelled) {
          setProgressError(e instanceof Error ? e.message : "Could not load progress.");
        }
      } finally {
        if (!cancelled) setLoadingProgress(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filing.id]);

  // OTP expiry countdown.
  React.useEffect(() => {
    if (!otpSession) {
      setSecondsLeft(0);
      return;
    }
    const tick = () => {
      const remaining = Math.max(
        0,
        Math.floor((new Date(otpSession.expires_at).getTime() - Date.now()) / 1000),
      );
      setSecondsLeft(remaining);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [otpSession]);

  const regimeCommitted = filing.regime_used === "old" || filing.regime_used === "new";
  const verifiedComplete =
    progress != null && progress.total > 0 && progress.unverified === 0;
  const filingSubmittable = ["draft", "revision_returned", "revision_requested"].includes(
    filing.status,
  );

  const preconditions: PreconditionItem[] = [
    {
      id: "txn_verified",
      label: "All transactions verified",
      status: loadingProgress ? "pending" : verifiedComplete ? "ok" : "blocked",
      detail:
        progress == null
          ? undefined
          : progress.total === 0
            ? "No transactions found. Upload your documents to begin."
            : `${progress.verified} of ${progress.total} verified (${progress.percent}%).`,
      fixHref: `/filings/${filing.id}/transactions`,
      fixLabel: "Verify transactions",
    },
    {
      id: "regime",
      label: "Tax regime chosen",
      status: regimeCommitted ? "ok" : "blocked",
      detail: regimeCommitted
        ? `Filing under the ${filing.regime_used?.toUpperCase()} regime.`
        : "Pick a regime on the Regime tab — the engine needs to know which slabs to apply.",
      fixHref: `/filings/${filing.id}/regime`,
      fixLabel: "Choose regime",
    },
    {
      id: "status",
      label: "Filing is in a submittable state",
      status: filingSubmittable ? "ok" : "blocked",
      detail: filingSubmittable
        ? `Current status: ${filing.status}.`
        : `This filing is in '${filing.status}' and cannot be re-submitted.`,
    },
    {
      id: "acknowledgment",
      label: "Accuracy declaration acknowledged",
      status: acknowledged ? "ok" : "blocked",
      detail:
        "Tick the box below to record your acknowledgment of the accuracy declaration.",
    },
  ];

  const blockers = preconditions.filter((p) => p.status === "blocked");
  const canRequestOtp = blockers.length === 0 && !requestingOtp;

  const handleRequestOtp = async () => {
    setRequestingOtp(true);
    setOtpError(null);
    setSubmitError(null);
    try {
      const session = await requestSubmitOtp(filing.id);
      setOtpSession(session);
      setOtp("");
      setStage("otp");
    } catch (e) {
      const code = (e as Error & { code?: string }).code ?? "request_failed";
      const message = e instanceof Error ? e.message : "Could not request OTP.";
      setOtpError({ code, message });
    } finally {
      setRequestingOtp(false);
    }
  };

  const handleSubmit = React.useCallback(
    async (codeToUse: string) => {
      if (!otpSession || codeToUse.length !== 6) return;
      setSubmitting(true);
      setSubmitError(null);
      try {
        const result = await submitFiling(filing.id, {
          acknowledgment: true,
          verification_id: otpSession.verification_id,
          otp: codeToUse,
        });
        setSubmitted(result);
        setStage("submitted");
        // Refresh the filing context so the layout reflects status='submitted'.
        await refreshFiling();
      } catch (e) {
        const code = (e as Error & { code?: string }).code ?? "submit_failed";
        const message = e instanceof Error ? e.message : "Submit failed.";
        setSubmitError({ code, message });
        // On an invalid OTP, clear the input so the user can retype.
        if (code === "invalid_or_expired_otp") setOtp("");
      } finally {
        setSubmitting(false);
      }
    },
    [filing.id, otpSession, refreshFiling],
  );

  // -- success view: filing submitted -----------------------------------
  if (stage === "submitted" && submitted) {
    return (
      <div className="flex flex-col gap-5">
        <Card>
          <CardBody className="flex flex-col items-start gap-4">
            <Badge tone="success" size="md" withDot>
              Submitted
            </Badge>
            <div>
              <h2 className="font-display text-2xl text-ink">
                Filing submitted.
              </h2>
              <p className="mt-1 text-sm text-ink-muted">
                Your return for FY {filing.tax_year} is now in officer L1
                review. We&apos;ll notify you when the status changes.
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
              <dt className="text-ink-muted">Submitted at</dt>
              <dd className="text-ink">{new Date(submitted.submitted_at).toLocaleString()}</dd>
              <dt className="text-ink-muted">Filing ID</dt>
              <dd className="font-mono text-ink">{submitted.id}</dd>
              <dt className="text-ink-muted">OTP verification</dt>
              <dd className="font-mono text-ink">
                {submitted.submit_otp_verification_id.slice(0, 8)}…
              </dd>
            </dl>
            <div className="flex gap-2">
              <Button onClick={() => router.push(`/filings/${filing.id}/summary`)}>
                View summary
              </Button>
              <Button variant="ghost" onClick={() => router.push("/dashboard")}>
                Back to dashboard
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  // -- review + OTP view -------------------------------------------------
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>Submit filing</CardTitle>
          <CardDescription>
            One last gate. We&apos;ll email you a 6-digit code, you confirm
            the accuracy declaration, and the return moves to officer review.
            Nothing here is reversible from the taxpayer side once submitted.
          </CardDescription>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          {progressError && (
            <Alert tone="warning" title="Could not load verify progress">
              {progressError}
            </Alert>
          )}

          <SubmitPreconditions items={preconditions} />

          <div className="rounded-lg border border-line bg-surface-sunken/30 p-4">
            <p className="text-sm font-medium text-ink">Accuracy declaration</p>
            <p className="mt-1 text-sm text-ink-muted text-pretty">{ACK_TEXT}</p>
            <div className="mt-3">
              <Checkbox
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.currentTarget.checked)}
                disabled={stage !== "review"}
                label="I acknowledge the declaration above."
                description="This action is recorded on the audit trail for this filing."
              />
            </div>
          </div>

          {otpError && (
            <Alert tone="error" title="Could not send OTP">
              {otpError.message}
              {otpError.code === "verification_required" && (
                <>
                  {" "}
                  Verify your email address under{" "}
                  <a
                    href="/settings/profile"
                    className="underline underline-offset-2"
                  >
                    profile settings
                  </a>{" "}
                  first.
                </>
              )}
            </Alert>
          )}
        </CardBody>
      </Card>

      {stage === "otp" && otpSession && (
        <Card>
          <CardHeader>
            <CardTitle>Enter the OTP we just sent</CardTitle>
            <CardDescription>
              Sent to <span className="font-medium text-ink">{otpSession.sent_to}</span>.
              {secondsLeft > 0 ? (
                <>
                  {" "}Code expires in{" "}
                  <span className="tabular-nums text-ink">
                    {fmtTimeLeft(secondsLeft)}
                  </span>
                  .
                </>
              ) : (
                <span className="text-signal-error"> Code expired. Request a new one.</span>
              )}
              {otpSession.dev_plain_code && (
                <span className="ml-2 rounded bg-signal-warning-soft px-1.5 py-0.5 font-mono text-xs text-signal-warning">
                  DEV {otpSession.dev_plain_code}
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <CardBody className="flex flex-col gap-4">
            <OtpEntry
              label="6-digit OTP"
              value={otp}
              onChange={setOtp}
              onComplete={(code) => void handleSubmit(code)}
              disabled={submitting || secondsLeft === 0}
              invalid={submitError?.code === "invalid_or_expired_otp"}
            />

            {submitError && (
              <Alert tone="error" title="Could not submit">
                {submitError.message}
              </Alert>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={() => handleSubmit(otp)}
                disabled={otp.length !== 6 || submitting || secondsLeft === 0}
                loading={submitting}
              >
                Submit filing
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setOtpSession(null);
                  setStage("review");
                  setOtp("");
                  setSubmitError(null);
                }}
                disabled={submitting}
              >
                Cancel
              </Button>
              <button
                type="button"
                onClick={() => void handleRequestOtp()}
                disabled={requestingOtp || submitting || secondsLeft > 540}
                className="text-sm text-navy underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                title={
                  secondsLeft > 540
                    ? "Wait a minute before requesting a new code."
                    : undefined
                }
              >
                Resend code
              </button>
            </div>
          </CardBody>
        </Card>
      )}

      {stage === "review" && (
        <div className="flex items-center justify-between border-t border-line-subtle pt-4">
          <Button
            variant="ghost"
            onClick={() => router.push(`/filings/${filing.id}/summary`)}
          >
            ← Back to summary
          </Button>
          <Button
            onClick={() => void handleRequestOtp()}
            disabled={!canRequestOtp}
            loading={requestingOtp}
          >
            Send OTP & continue →
          </Button>
        </div>
      )}
    </div>
  );
}
