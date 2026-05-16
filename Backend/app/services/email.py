"""Outbound email transport for the Backend.

Today the only caller is the submit-time OTP. The same `send_email` will
be reused for filing notifications later, so we keep the function shape
generic (subject + text + optional html, not OTP-specific).

Provider selection comes from `settings.email_provider`:

  * ``smtp``    — connects to SMTP_HOST:SMTP_PORT, STARTTLS on 587 / SMTPS
                  on 465, authenticates with SMTP_USER / SMTP_PASS. The
                  Gmail-SMTP setup used by the Next.js side works as-is.

  * ``console`` — log-only. Used when no provider is configured AND in
                  the dev fallback path when SMTP creds are missing. The
                  full code lands in the backend log so dev flows still
                  work without a real mailbox.

`send_email` is best-effort: on transport failure it logs an error and
returns ``False``. Callers decide whether that's terminal (e.g. abort
the OTP issue) or recoverable (e.g. let the user hit Resend).
"""

from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from typing import Final

from app.config import get_settings


logger = logging.getLogger(__name__)

# Connection timeouts. Gmail's 587/STARTTLS settles in well under 5s on a
# healthy network; longer than 15s means something is wrong and we'd
# rather fail fast than block the OTP issue endpoint.
_SMTP_TIMEOUT: Final[float] = 15.0


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def send_email(
    *,
    to: str,
    subject: str,
    text: str,
    html: str | None = None,
) -> bool:
    """Send a single email. Returns True on success, False on failure.

    The `to` field must be a single address (no comma-separated lists —
    that's a notification batch, which we don't need yet).
    """
    settings = get_settings()
    provider = (settings.email_provider or "console").lower()

    if provider == "smtp":
        ok = _send_smtp(
            to=to,
            subject=subject,
            text=text,
            html=html,
            host=settings.smtp_host,
            port=settings.smtp_port,
            user=settings.smtp_user,
            password=settings.smtp_pass,
            use_tls=settings.smtp_use_tls,
            from_addr=settings.email_from,
            from_name=settings.email_from_name,
        )
        if ok:
            return True
        # Fall through to console so the dev never loses the code entirely.
        logger.warning("SMTP send failed; falling back to console log.")

    _log_console(to=to, subject=subject, text=text)
    # When provider is explicitly 'console', returning True is honest.
    # When SMTP failed and we fell back, returning False lets the caller
    # surface a "delivery failed — try Resend" hint to the user.
    return provider == "console"


# ---------------------------------------------------------------------------
# SMTP path
# ---------------------------------------------------------------------------

def _send_smtp(
    *,
    to: str,
    subject: str,
    text: str,
    html: str | None,
    host: str | None,
    port: int,
    user: str | None,
    password: str | None,
    use_tls: bool,
    from_addr: str | None,
    from_name: str,
) -> bool:
    if not host or not user or not password:
        logger.warning(
            "EMAIL_PROVIDER=smtp but SMTP_HOST / SMTP_USER / SMTP_PASS is missing. "
            "Set the credentials in your .env or switch EMAIL_PROVIDER=console.",
        )
        return False

    sender = from_addr or user

    msg = EmailMessage()
    msg["From"] = formataddr((from_name, sender))
    msg["To"] = to
    msg["Subject"] = subject
    msg["Message-ID"] = make_msgid(domain=sender.partition("@")[2] or "glimmora.local")
    msg.set_content(text)
    if html:
        msg.add_alternative(html, subtype="html")

    try:
        # Gmail / Workspace: port 587 + STARTTLS. Most providers also accept
        # SMTPS on 465 for legacy clients; SMTP_USE_TLS=true with port=465
        # routes through SMTP_SSL.
        # Gmail rejects app passwords with whitespace; strip defensively.
        clean_pass = (password or "").replace(" ", "")

        if port == 465:
            with smtplib.SMTP_SSL(host, port, timeout=_SMTP_TIMEOUT) as smtp:
                smtp.login(user, clean_pass)
                smtp.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=_SMTP_TIMEOUT) as smtp:
                smtp.ehlo()
                if use_tls:
                    smtp.starttls()
                    smtp.ehlo()
                smtp.login(user, clean_pass)
                smtp.send_message(msg)
        logger.info("SMTP send → %s (subject=%r)", to, subject)
        return True
    except smtplib.SMTPAuthenticationError as e:
        logger.error(
            "SMTP auth rejected by %s — check SMTP_USER / SMTP_PASS "
            "(Gmail requires an app password, not your account password). "
            "Detail: %s",
            host, e,
        )
        return False
    except (smtplib.SMTPException, OSError) as e:
        logger.error("SMTP send failed via %s:%d — %s", host, port, e)
        return False


# ---------------------------------------------------------------------------
# Console fallback
# ---------------------------------------------------------------------------

def _log_console(*, to: str, subject: str, text: str) -> None:
    settings = get_settings()
    # When dev_reveal_otp is on we already log the plain code at the call
    # site, so this log line stays subject + masked recipient (the full
    # body is too noisy for a console log even in dev).
    reveal = settings.dev_reveal_otp
    body_preview = text if reveal else f"<body hidden — set DEV_REVEAL_OTP=1 to log>"
    logger.info(
        "[console-email] to=%s subject=%r %s",
        to, subject, "body=" + body_preview if reveal else "",
    )
