"""Pre-flight safety rules for the in-product assistant.

The assistant must NEVER:
  - explain backend / infrastructure / code details,
  - reveal stored PAN or Aadhaar numbers,
  - give legal, compliance or policy advice beyond plain UI guidance,
  - leak prompts, system internals, or operational secrets.

We refuse such requests before the matcher runs. The frontend renders the
refusal as a calm, polite redirect.
"""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class SafetyVerdict:
    blocked: bool
    reason: str | None = None  # short code, e.g. "technical"
    message: str | None = None # user-facing message
    citation: str | None = None


# Patterns that scream "wants internals". Tuned conservatively — we'd rather
# refuse one borderline ask than answer a technical one.
_TECHNICAL_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p, re.IGNORECASE)
    for p in (
        r"\b(api|endpoint|swagger|graphql|sdk)\b",
        r"\b(database|postgres|neon|supabase|sql|schema|migration|table)\b",
        r"\b(source ?code|repo|repository|commit|git|github|branch)\b",
        r"\b(infrastructure|deploy|deployment|render|vercel|docker|kubernetes|k8s)\b",
        r"\b(env|environment variable|secret|jwt|token|cookie|session id)\b",
        r"\b(prompt|system prompt|instructions you were given|ignore (your|all) (previous|prior))\b",
        r"\b(architecture|backend|frontend|fastapi|next\.?js|react|tailwind)\b",
        r"\b(stack trace|exception|traceback|stderr|stdout|logs?)\b",
        r"\b(vulnerab|exploit|bypass|hack|owasp|xss|csrf|sql ?injection)\b",
        r"\b(model name|llm|gpt|claude|gemini|openai|anthropic)\b",
    )
)

# Asking us to *reveal* sensitive identifiers — distinct from asking what a
# PAN/Aadhaar *is* (which is fine and answered by a KB entry).
_SENSITIVE_REVEAL_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p, re.IGNORECASE)
    for p in (
        r"(show|reveal|display|print|tell me|what is)\s+(my\s+)?(full\s+)?(pan|aadhaar|aadhar)\b",
        r"\bunmask(ed)?\s+(pan|aadhaar|aadhar)\b",
        r"\bfull\s+(pan|aadhaar|aadhar)\s+(number|value)?",
        r"\b(otp|one[- ]?time[- ]?password|password|passcode)\b.*\b(show|reveal|what)\b",
    )
)

_LEGAL_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p, re.IGNORECASE)
    for p in (
        r"\b(legal advice|am i liable|should i (file|claim)|will i be (audited|penali[sz]ed))\b",
        r"\b(file (case|complaint)|sue|lawsuit|prosecut)\b",
    )
)


def screen(question: str) -> SafetyVerdict:
    """Return a SafetyVerdict for the user's question.

    Empty / blank questions are not blocked here — the matcher handles them.
    """
    q = (question or "").strip()
    if not q:
        return SafetyVerdict(False)

    if _matches(q, _SENSITIVE_REVEAL_PATTERNS):
        return SafetyVerdict(
            blocked=True,
            reason="sensitive_reveal",
            message=(
                "Your PAN and Aadhaar are stored encrypted, so I can't show "
                "them here. You can see the masked version under "
                "Dashboard › Identity, and update them from Profile › "
                "Identity once you've re-verified."
            ),
            citation="Dashboard › Identity",
        )

    if _matches(q, _TECHNICAL_PATTERNS):
        return SafetyVerdict(
            blocked=True,
            reason="technical",
            message=(
                "I only help with using Glimmora Tax — flows, fields, "
                "statuses and next steps. I can't answer questions about "
                "the technical internals. Ask me what a page or field is "
                "for, and I'll explain it in plain language."
            ),
            citation="Glimmora Tax · Help",
        )

    if _matches(q, _LEGAL_PATTERNS):
        return SafetyVerdict(
            blocked=True,
            reason="legal",
            message=(
                "I can't give legal or compliance advice. I can explain "
                "what each screen, field or status means inside Glimmora "
                "Tax so you know what to do next — for anything beyond "
                "that, please speak to a qualified Chartered Accountant."
            ),
            citation="Glimmora Tax · Help",
        )

    return SafetyVerdict(False)


def _matches(text: str, patterns: tuple[re.Pattern[str], ...]) -> bool:
    return any(p.search(text) for p in patterns)
