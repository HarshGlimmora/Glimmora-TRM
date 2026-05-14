"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AuthShell } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/Button";
import { Input, Field } from "@/components/ui/Input";
import { Alert } from "@/components/ui/Alert";
import { Icon } from "@/components/shared/Icon";
import { Badge } from "@/components/ui/Badge";
import { Divider } from "@/components/ui/Divider";
import { OtpInput } from "@/components/auth/OtpInput";
import { Checkbox } from "@/components/ui/Checkbox";
import { sanitizeEmail, sanitizeMobile } from "@/lib/security/sanitize";
import { validateEmail, validateMobile } from "@/lib/validation/identity";
import { adminLogin, beginLogin, resendOtp, verifyOtp } from "@/lib/api";
import { useAuthStore } from "@/lib/store/auth-store";
import { cn } from "@/lib/utils/cn";

const IS_DEV = process.env.NODE_ENV !== "production";

const REMEMBER_ME_KEY = "glmra.remember-me";

type Channel = "email" | "mobile";
type Phase = "identifier" | "otp";

interface OtpSession {
  otpId: string;
  channel: Channel;
  identifier: string;
  display: string;
  cooldownSec: number;
  hint?: string | null;
}

const CHANNELS: {
  id: Channel;
  label: string;
  hint: string;
  icon: React.ReactNode;
}[] = [
  {
    id: "email",
    label: "Email",
    hint: "We'll email you a one-time code",
    icon: <Icon.Mail size={16} />,
  },
  {
    id: "mobile",
    label: "Mobile",
    hint: "Indian mobile, 10 digits",
    icon: <Icon.Phone size={16} />,
  },
];

export default function LoginPage() {
  const [phase, setPhase] = React.useState<Phase>("identifier");
  const [session, setSession] = React.useState<OtpSession | null>(null);
  const [rememberMe, setRememberMe] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(REMEMBER_ME_KEY) === "1";
    } catch {
      return false;
    }
  });

  const onRememberChange = React.useCallback((v: boolean) => {
    setRememberMe(v);
    if (typeof window !== "undefined") {
      try {
        if (v) window.localStorage.setItem(REMEMBER_ME_KEY, "1");
        else window.localStorage.removeItem(REMEMBER_ME_KEY);
      } catch {
        /* ignore quota errors */
      }
    }
  }, []);

  return (
    <AuthShell>
      {phase === "identifier" ? (
        <IdentifierForm
          rememberMe={rememberMe}
          onRememberChange={onRememberChange}
          onSent={(s) => {
            setSession(s);
            setPhase("otp");
          }}
        />
      ) : (
        session && (
          <OtpForm
            session={session}
            rememberMe={rememberMe}
            onChangeIdentifier={() => setPhase("identifier")}
            onResent={(cd) =>
              setSession((prev) => (prev ? { ...prev, cooldownSec: cd } : prev))
            }
          />
        )
      )}
    </AuthShell>
  );
}

/* -------------------------------------------------------------------------- */
/*  Phase 1 — identifier entry + send                                         */
/* -------------------------------------------------------------------------- */

function IdentifierForm({
  onSent,
  rememberMe,
  onRememberChange,
}: {
  onSent: (s: OtpSession) => void;
  rememberMe: boolean;
  onRememberChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const signIn = useAuthStore((s) => s.signIn);
  const loadMe = useAuthStore((s) => s.loadMe);
  const [channel, setChannel] = React.useState<Channel>("email");
  const [emailValue, setEmailValue] = React.useState("");
  const [mobileValue, setMobileValue] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [adminBusy, setAdminBusy] = React.useState<
    "taxpayer" | "consultant" | null
  >(null);

  const handleAdmin = async (role: "taxpayer" | "consultant") => {
    setError(null);
    setAdminBusy(role);
    try {
      const res = await adminLogin(role);
      signIn({
        displayIdentifier: res.user.email ?? `admin-${role}`,
        role: res.user.role ?? role,
        profileId: res.user.id,
      });
      await loadMe();
      router.push(res.next);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Admin login is unavailable.";
      setError(msg);
      setAdminBusy(null);
    }
  };

  const value = channel === "email" ? emailValue : mobileValue;
  const setValue = (v: string) => {
    if (channel === "email") setEmailValue(v);
    else setMobileValue(v);
    if (error) setError(null);
  };

  // Switch via direct setState — guaranteed not to be intercepted by anything.
  const pickEmail = () => {
    setChannel("email");
    setError(null);
  };
  const pickMobile = () => {
    setChannel("mobile");
    setError(null);
  };

  const handleSend = async () => {
    setError(null);
    const raw = value.trim();
    if (!raw) {
      setError(
        channel === "email"
          ? "Please enter your email address."
          : "Please enter your mobile number.",
      );
      return;
    }
    const sanitized =
      channel === "email" ? sanitizeEmail(raw) : sanitizeMobile(raw);
    const r =
      channel === "email"
        ? validateEmail(sanitized)
        : validateMobile(sanitized);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    try {
      setSubmitting(true);
      const res = await beginLogin(sanitized, channel);
      onSent({
        otpId: res.otpId,
        channel: res.channel,
        identifier: res.target,
        display: res.display,
        cooldownSec: res.cooldownSec,
        hint: res.hint,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unable to send code.";
      setError(msg);
      setSubmitting(false);
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void handleSend();
  };

  return (
    <div className="animate-fade-up">
      <Badge tone="navy" withDot size="sm">
        Sign in
      </Badge>
      <h2 className="mt-4 font-display text-4xl leading-tight text-ink">
        Verify yourself
        <br />
        <span className="text-ink-muted">to continue.</span>
      </h2>
      <p className="mt-3 text-pretty text-sm text-ink-muted">
        Choose how you&apos;d like to receive a 6-digit verification code. No
        passwords — your identifier is verified each time.
      </p>

      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-5" noValidate>
        <fieldset disabled={submitting} className="contents">
          <legend className="field-label mb-2 block">Receive code via</legend>

          <div
            role="tablist"
            aria-label="Choose identifier channel"
            className="grid grid-cols-2 gap-2"
          >
            <ChannelTab
              active={channel === "email"}
              onSelect={pickEmail}
              icon={<Icon.Mail size={16} />}
              label="Email"
              hint="We'll email you a code"
            />
            <ChannelTab
              active={channel === "mobile"}
              onSelect={pickMobile}
              icon={<Icon.Phone size={16} />}
              label="Mobile"
              hint="Indian mobile, 10 digits"
            />
          </div>

          <Field
            label={channel === "email" ? "Email address" : "Mobile number"}
            required
            htmlFor="identifier"
            hint={
              channel === "email"
                ? "We'll deliver a 6-digit code to this inbox."
                : "10 digits, no spaces. Demo: mobile OTPs are forwarded to the platform email."
            }
            trailingLabel={
              <span className="inline-flex items-center gap-1">
                <Icon.Lock size={11} />
                <span>Never stored on this device</span>
              </span>
            }
          >
            <Input
              id="identifier"
              name="identifier"
              type={channel === "email" ? "email" : "tel"}
              inputMode={channel === "email" ? "email" : "numeric"}
              autoComplete={channel === "email" ? "email" : "tel-national"}
              placeholder={
                channel === "email" ? "you@domain.in" : "98XXXXXXXX"
              }
              value={value}
              onChange={(e) => setValue(e.target.value)}
              leadingAddon={channel === "mobile" ? "+91" : undefined}
              maxLength={channel === "email" ? 254 : 10}
              autoFocus
            />
          </Field>

          {error && (
            <Alert tone="error" title="We couldn't send the code" compact>
              {error}
            </Alert>
          )}

          <Checkbox
            checked={rememberMe}
            onChange={(e) => onRememberChange(e.target.checked)}
            label="Remember me on this device"
            description="Keeps you signed in for 30 days. Don't tick this on a shared computer."
          />

          <Button
            type="submit"
            size="lg"
            fullWidth
            loading={submitting}
            rightIcon={<Icon.ArrowRight size={16} />}
          >
            {submitting ? "Sending code…" : "Send 6-digit code"}
          </Button>
        </fieldset>

        <Divider label="or" />

        <div className="rounded-xl border border-line bg-surface-sunken/60 p-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-navy text-white">
              <Icon.Sparkle size={14} />
            </span>
            <div className="flex-1">
              <p className="text-sm font-medium text-ink">First time here?</p>
              <p className="mt-0.5 text-xs text-ink-muted text-pretty">
                Continue with your email or mobile — we&apos;ll set up your
                taxpayer or consultant profile after verification.
              </p>
            </div>
          </div>
        </div>

        {IS_DEV && (
          <div className="rounded-xl border border-dashed border-line bg-surface-sunken/30 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium uppercase tracking-widest text-ink-subtle">
                Dev shortcuts
              </p>
              <Badge tone="warning" size="sm">
                Local only
              </Badge>
            </div>
            <p className="mt-1 text-xs text-ink-muted">
              Skip OTP and sign in as a pre-baked profile.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void handleAdmin("taxpayer")}
                loading={adminBusy === "taxpayer"}
                disabled={adminBusy !== null}
              >
                Login as Taxpayer
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void handleAdmin("consultant")}
                loading={adminBusy === "consultant"}
                disabled={adminBusy !== null}
              >
                Login as CA
              </Button>
            </div>
          </div>
        )}

        <p className="pt-2 text-center text-2xs text-ink-subtle">
          By continuing you accept Glimmora&apos;s{" "}
          <Link href="#" className="underline-offset-4 hover:underline">
            terms
          </Link>{" "}
          and acknowledge our{" "}
          <Link href="#" className="underline-offset-4 hover:underline">
            consent framework
          </Link>
          .
        </p>
      </form>
    </div>
  );
}

function ChannelTab({
  active,
  onSelect,
  icon,
  label,
  hint,
}: {
  active: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onSelect}
      className={cn(
        "group relative flex cursor-pointer select-none items-start gap-3 rounded-lg border bg-surface-raised p-3 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
        active
          ? "border-accent bg-accent-soft/50 ring-1 ring-accent/30"
          : "border-line hover:border-line-strong hover:bg-surface-sunken/40",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mt-0.5 inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border transition-colors",
          active
            ? "border-accent bg-accent text-white"
            : "border-line bg-surface-sunken text-navy",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold tracking-[-0.005em] text-ink">
            {label}
          </span>
          <span
            aria-hidden
            className={cn(
              "inline-flex h-4 w-4 items-center justify-center rounded-full border text-white transition-colors",
              active
                ? "border-accent bg-accent"
                : "border-line bg-surface-sunken text-transparent",
            )}
          >
            <Icon.Check size={10} />
          </span>
        </span>
        <span className="mt-0.5 block text-xs text-ink-muted">{hint}</span>
      </span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/*  Phase 2 — OTP entry (inline, no navigation)                               */
/* -------------------------------------------------------------------------- */

function useCountdown(initialSec: number, deps: React.DependencyList = []) {
  const [secs, setSecs] = React.useState(initialSec);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    setSecs(initialSec);
  }, deps);
  React.useEffect(() => {
    if (secs <= 0) return;
    const t = setTimeout(() => setSecs((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [secs]);
  return { secs, reset: (n: number) => setSecs(n) };
}

function OtpForm({
  session,
  rememberMe,
  onChangeIdentifier,
  onResent,
}: {
  session: OtpSession;
  rememberMe: boolean;
  onChangeIdentifier: () => void;
  onResent: (cooldownSec: number) => void;
}) {
  const router = useRouter();
  const signIn = useAuthStore((s) => s.signIn);
  const loadMe = useAuthStore((s) => s.loadMe);
  const [code, setCode] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [resending, setResending] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const { secs: cooldown, reset } = useCountdown(session.cooldownSec, [
    session.otpId,
  ]);

  const submit = React.useCallback(
    async (codeArg?: string) => {
      const c = codeArg ?? code;
      if (c.length !== 6) {
        setError("Enter the full 6-digit code first.");
        return;
      }
      setError(null);
      setSubmitting(true);
      try {
        const res = await verifyOtp({
          otpId: session.otpId,
          code: c,
          identifier: session.identifier,
          rememberMe,
        });
        signIn({
          displayIdentifier: session.display || session.identifier,
          role: res.user.role ?? undefined,
          profileId: res.user.id,
        });
        // Prime the auth-store cache before we navigate so the destination
        // page doesn't re-fetch /me from a cold cache.
        await loadMe();
        router.push(res.next);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Verification failed.";
        setError(msg);
        setCode("");
        setSubmitting(false);
      }
    },
    [code, router, signIn, session, rememberMe, loadMe],
  );

  const onResend = async () => {
    if (cooldown > 0 || resending) return;
    setResending(true);
    setError(null);
    setNotice(null);
    try {
      const r = await resendOtp(session.otpId);
      reset(r.cooldownSec);
      onResent(r.cooldownSec);
      setNotice("A fresh code is on the way.");
      setCode("");
      setTimeout(() => setNotice(null), 4500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unable to resend.";
      setError(msg);
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="animate-fade-up">
      <button
        type="button"
        onClick={onChangeIdentifier}
        className="mb-5 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium text-ink-muted hover:bg-surface-sunken hover:text-ink"
      >
        <Icon.ChevronLeft size={12} />
        Use a different {session.channel === "email" ? "email" : "mobile"}
      </button>

      <Badge tone="navy" withDot size="sm">
        Verify identity
      </Badge>
      <h2 className="mt-4 font-display text-4xl leading-tight text-ink">
        Enter the code
        <br />
        we just sent.
      </h2>
      <p className="mt-3 text-pretty text-sm text-ink-muted">
        We sent a 6-digit verification code to{" "}
        <span className="font-medium text-ink">{session.display}</span>. The
        code expires in 10 minutes.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="mt-8 flex flex-col gap-5"
        noValidate
      >
        <OtpInput
          length={6}
          value={code}
          onChange={setCode}
          invalid={Boolean(error)}
          autoFocus
          disabled={submitting}
          label="One-time passcode"
          onComplete={(v) => void submit(v)}
        />

        {error && (
          <Alert tone="error" compact title="Couldn't verify">
            {error}
          </Alert>
        )}
        {notice && (
          <Alert tone="success" compact>
            {notice}
          </Alert>
        )}

        <Button
          type="submit"
          size="lg"
          fullWidth
          loading={submitting}
          rightIcon={<Icon.ArrowRight size={16} />}
        >
          {submitting ? "Verifying…" : "Verify and continue"}
        </Button>

        <div className="flex items-center justify-between text-sm text-ink-muted">
          <button
            type="button"
            onClick={onResend}
            disabled={cooldown > 0 || resending}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-1 py-0.5 text-sm font-medium text-navy hover:underline underline-offset-4 disabled:cursor-not-allowed disabled:text-ink-subtle disabled:no-underline"
          >
            <Icon.Refresh size={14} />
            {cooldown > 0
              ? `Resend in ${cooldown}s`
              : resending
                ? "Sending…"
                : "Resend code"}
          </button>
          <button
            type="button"
            onClick={onChangeIdentifier}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-1 py-0.5 text-sm hover:text-ink hover:underline underline-offset-4"
          >
            <Icon.ChevronLeft size={14} /> Change{" "}
            {session.channel === "email" ? "email" : "mobile"}
          </button>
        </div>

        {session.hint && (
          <Alert tone="info" compact title="Mobile OTPs in demo">
            {session.hint}
          </Alert>
        )}

        <p className="text-2xs text-ink-subtle">
          After 5 wrong attempts, verification locks for 60 seconds. Resend
          unlocks the attempt counter and ships a fresh code.
        </p>
      </form>
    </div>
  );
}
