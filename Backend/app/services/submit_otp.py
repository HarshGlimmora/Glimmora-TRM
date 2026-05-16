"""Submit-time email OTP — issue, verify, consume.

Used by:
  - POST /api/v1/auth/request-submit-otp   → issue a 6-digit code bound to
    a filing; stored as sha256(code) in user_verifications with
    channel='email', purpose='submit_phone', filing_id=<filing>,
    TTL = settings.submit_otp_ttl_seconds.
  - POST /api/v1/filings/{id}/submit       → verify against the stored hash,
    increment attempts on mismatch (lock after `max_attempts`), and consume
    the row atomically with the status flip.

Note on the `submit_phone` purpose: it's the historical key kept by the
SCHEMA's CHECK constraints (`chk_verif_purpose`, `chk_verif_submit_has_filing`).
Renaming to `submit_email` would need a migration; we keep the constant
since the purpose value is never exposed in API responses or to users.

Production wires an email provider into `_dispatch_email()`. Dev / smoke
tests can set `DEV_REVEAL_OTP=1` to receive the plain code in the request
response (the only way to test the flow without a real gateway).

Spec: FILING_FLOW.md §3.7, API_CONTRACTS.md §2.9 + §6.7, SCHEMA.md §5.x.
"""

from __future__ import annotations

import hashlib
import logging
import re
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.identity import User, UserVerification
from app.services.email import send_email


logger = logging.getLogger(__name__)

# `submit_phone` is the canonical purpose value the SCHEMA's CHECK constraint
# accepts for submission OTPs — it predates the channel switch and we keep
# it for migration-free deployment. `CHANNEL` is what actually drives the
# delivery path (email today; could be 'phone' again later if needed).
PURPOSE = "submit_phone"
CHANNEL = "email"


# ---------------------------------------------------------------------------
# Public types
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class IssuedOtp:
    verification_id: str
    filing_id: str
    sent_to_masked: str
    expires_at: str
    # Plain code is only set when dev_reveal_otp is True. Never persist this.
    dev_plain_code: str | None = None


class OtpError(Exception):
    """Base error — exposes `.code` for the API layer to map to a status."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class OtpFilingMismatch(OtpError):
    def __init__(self) -> None:
        super().__init__(
            "otp_filing_mismatch",
            "This OTP was issued for a different filing. Request a fresh code "
            "for the filing you are submitting.",
        )


class OtpInvalidOrExpired(OtpError):
    def __init__(self) -> None:
        super().__init__(
            "invalid_or_expired_otp",
            "Invalid or expired OTP. Request a fresh code and try again.",
        )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat(timespec="seconds").replace("+00:00", "Z")


def _sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def _generate_code() -> str:
    """Cryptographically secure 6-digit code (000000–999999, zero-padded)."""
    return f"{secrets.randbelow(1_000_000):06d}"


def _mask_email(email: str | None) -> str:
    """Hide all but the first 2 characters of the local part and keep the
    domain intact: ``asha@example.com`` → ``as***@example.com``."""
    if not email or "@" not in email:
        return "email on file"
    local, _, domain = email.partition("@")
    if len(local) <= 2:
        head = local
    else:
        head = local[:2]
    return f"{head}***@{domain}"


def _dispatch_email(email: str, code: str, *, filing_id: str) -> None:
    """Send the OTP over email via `services.email.send_email`.

    Best-effort: a transport failure logs at error level but does NOT
    abort the OTP issue — the row is already in user_verifications and
    the user can hit Resend. In dev (`DEV_REVEAL_OTP=1`), the code is
    also returned in the API response so the flow keeps working even
    when no mailbox is wired up.
    """
    settings = get_settings()
    masked = _mask_email(email)

    if settings.dev_reveal_otp:
        logger.info("[DEV] Submit OTP for filing %s -> %s code=%s", filing_id, masked, code)

    ttl_minutes = max(1, settings.submit_otp_ttl_seconds // 60)
    subject = f"Glimmora TRM filing submit code {code}"
    text, html = _compose_otp_email(code=code, ttl_minutes=ttl_minutes)

    delivered = send_email(to=email, subject=subject, text=text, html=html)
    if not delivered:
        logger.warning(
            "OTP for filing %s issued but email delivery failed for %s. "
            "User can request a resend.",
            filing_id, masked,
        )


def _compose_otp_email(*, code: str, ttl_minutes: int) -> tuple[str, str]:
    """Plain-text + HTML OTP body. Matches the Glimmora TRM Next.js
    template visually (navy header, large mono code, security notes)."""
    text = (
        f"Your Glimmora TRM submit code is {code}.\n\n"
        f"Use this code to confirm submission of your tax filing. It "
        f"expires in {ttl_minutes} minutes and can be used once.\n\n"
        "If you didn't request this code, you can safely ignore this "
        "email — no further action is needed.\n\n"
        "— Glimmora TRM\n"
    )
    # Conservative table-based HTML for cross-client rendering (Gmail,
    # Outlook, Apple Mail). Kept inline; no <style> blocks since most
    # clients strip them.
    html = f"""<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f3f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#101a2b;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f3f5f9;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;background:#ffffff;border:1px solid #e6e9ef;border-radius:14px;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 16px 32px;background:linear-gradient(180deg,#0e1c34,#1a2c4e);color:#ffffff;">
                <div style="font-weight:600;letter-spacing:-0.01em;font-size:15px;">
                  Glimmora <span style="border:1px solid rgba(255,255,255,0.3);padding:1px 5px;border-radius:3px;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;margin-left:4px;">TRM</span>
                </div>
                <h1 style="margin:18px 0 6px 0;font-family:Georgia,serif;font-weight:400;font-size:30px;line-height:1.1;color:#ffffff;">
                  Confirm your filing submission.
                </h1>
                <p style="margin:0;color:rgba(255,255,255,0.78);font-size:14px;line-height:1.5;">
                  Use the code below to submit your tax filing.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 12px 32px;">
                <p style="margin:0 0 8px 0;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#6b7280;">Submit code</p>
                <div style="display:inline-block;padding:18px 22px;background:#f6f7fa;border:1px solid #e6e9ef;border-radius:10px;">
                  <span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:34px;letter-spacing:0.32em;font-weight:600;color:#101a2b;">{code}</span>
                </div>
                <p style="margin:18px 0 0 0;font-size:14px;line-height:1.55;color:#3b475a;">
                  This code expires in <strong>{ttl_minutes} minutes</strong> and is bound to the specific filing you just opened on Glimmora TRM. If you didn&rsquo;t request it, you can ignore this email.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 28px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f9fafc;border:1px solid #e6e9ef;border-radius:10px;">
                  <tr>
                    <td style="padding:14px 16px;font-size:13px;line-height:1.55;color:#3b475a;">
                      <strong style="color:#101a2b;">Security notes</strong><br/>
                      &bull; Glimmora will never ask for this code over phone or chat.<br/>
                      &bull; The code is single-use and locks after 5 wrong attempts.<br/>
                      &bull; This code only works for the filing it was issued for.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>"""
    return text, html


# ---------------------------------------------------------------------------
# Issue
# ---------------------------------------------------------------------------

def issue_submit_otp(db: Session, *, user: User, filing_id: str) -> IssuedOtp:
    """Mint a fresh OTP, invalidating any outstanding `submit_phone` row.

    The `uq_verif_outstanding` partial unique index forces at most one
    unconsumed row per (user, purpose) — so we explicitly consume any prior
    submit_phone challenge before inserting a new one. This also enforces
    "only the latest OTP works", matching user intuition.
    """
    settings = get_settings()

    # Invalidate any outstanding submit_phone row so the unique index doesn't
    # fire and the user can't accidentally consume an older code.
    db.execute(
        update(UserVerification)
        .where(
            UserVerification.user_id == user.id,
            UserVerification.purpose == PURPOSE,
            UserVerification.consumed_at.is_(None),
        )
        .values(consumed_at=_iso(_now()))
    )

    code = _generate_code()
    now = _now()
    expires = now + timedelta(seconds=settings.submit_otp_ttl_seconds)

    if not user.email:
        raise OtpError(
            "verification_required",
            "Your email is not on file. Add and verify it before submitting.",
        )

    row = UserVerification(
        user_id=user.id,
        channel=CHANNEL,
        purpose=PURPOSE,
        secret_hash=_sha256_hex(code),
        destination=user.email,
        expires_at=_iso(expires),
        attempts=0,
        max_attempts=settings.submit_otp_max_attempts,
        filing_id=filing_id,
        created_at=_iso(now),
    )
    db.add(row)
    db.flush()

    _dispatch_email(user.email, code, filing_id=filing_id)

    return IssuedOtp(
        verification_id=row.id,
        filing_id=filing_id,
        sent_to_masked=_mask_email(user.email),
        expires_at=row.expires_at,
        dev_plain_code=code if settings.dev_reveal_otp else None,
    )


# ---------------------------------------------------------------------------
# Verify + consume
# ---------------------------------------------------------------------------

def consume_submit_otp(
    db: Session,
    *,
    user_id: str,
    filing_id: str,
    verification_id: str,
    otp: str,
) -> UserVerification:
    """Look up the verification row, validate, and mark consumed.

    Returns the consumed UserVerification (caller will attach its `id` to
    `tax_returns.submit_otp_verification_id`). Raises `OtpError` on any
    failure path so the API can map to 422 with the canonical `code`.
    """
    if not isinstance(otp, str) or not re.fullmatch(r"\d{6}", otp):
        raise OtpInvalidOrExpired()

    stmt = select(UserVerification).where(
        UserVerification.id == verification_id,
        UserVerification.user_id == user_id,
        UserVerification.purpose == PURPOSE,
    )
    # Row-level lock on Postgres so two concurrent submits can't double-consume.
    # SQLite has no SELECT FOR UPDATE; the implicit transaction lock is sufficient.
    if db.bind.dialect.name != "sqlite":
        stmt = stmt.with_for_update(of=UserVerification)
    row = db.execute(stmt).scalar_one_or_none()

    if row is None or row.consumed_at is not None:
        raise OtpInvalidOrExpired()

    if row.filing_id != filing_id:
        raise OtpFilingMismatch()

    try:
        expires = datetime.fromisoformat(row.expires_at.replace("Z", "+00:00"))
    except ValueError:
        raise OtpInvalidOrExpired()
    if expires <= _now():
        # Consume the row so it doesn't linger as an outstanding challenge.
        row.consumed_at = _iso(_now())
        db.flush()
        raise OtpInvalidOrExpired()

    if row.attempts >= row.max_attempts:
        row.consumed_at = _iso(_now())
        db.flush()
        raise OtpInvalidOrExpired()

    if not secrets.compare_digest(row.secret_hash, _sha256_hex(otp)):
        row.attempts += 1
        if row.attempts >= row.max_attempts:
            row.consumed_at = _iso(_now())
        db.flush()
        raise OtpInvalidOrExpired()

    row.consumed_at = _iso(_now())
    db.flush()
    return row
