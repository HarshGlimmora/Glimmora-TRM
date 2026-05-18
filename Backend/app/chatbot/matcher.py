"""Page-aware question matching.

We score every KB entry against the user's question using:
  - keyword overlap with the entry's intent + aliases (Jaccard-ish),
  - a strong bonus when the entry applies to the current page,
  - a smaller bonus for role-specific entries that match the user,
  - the entry's own weight (for tie-breaks).

The top score wins, provided it clears a minimum confidence threshold.
Below the threshold we return None and the API responds with an empty-state
nudge plus suggestions.

This is deliberately simple. No vector store, no LLM, no network — answers
return in single-digit milliseconds and never hallucinate.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.chatbot.knowledge import KB, KBEntry


# Words we strip from the user's question before scoring — they don't help
# distinguish intent and they bloat overlap counts. Be careful not to add
# verbs that *do* carry intent here (e.g. "explain", "show", "upload") —
# users phrase their questions around those.
_STOPWORDS = frozenset(
    """
    a an and the is are was were be been being am do does did to of in on at
    for with by from this that these those it its my your our their what who
    why how when where which can could should would may might will shall
    me about into out as just like up off please
    if so but or not no yes here there over under above below also too then
    """.split()
)

_TOKEN_RE = re.compile(r"[a-z0-9]+")


def _tokens(text: str) -> set[str]:
    return {t for t in _TOKEN_RE.findall(text.lower()) if t not in _STOPWORDS and len(t) > 1}


def _entry_keywords(e: KBEntry) -> set[str]:
    bag = _tokens(e.intent)
    for a in e.aliases:
        bag |= _tokens(a)
    return bag


@dataclass(frozen=True)
class Match:
    entry: KBEntry
    score: float


def best_match(
    question: str,
    page_id: str,
    role: str | None = None,
) -> Match | None:
    q_tokens = _tokens(question or "")
    if not q_tokens:
        return None

    best: Match | None = None
    for entry in KB:
        kw = _entry_keywords(entry)
        if not kw:
            continue
        overlap = len(q_tokens & kw)
        if overlap == 0:
            continue

        # Base score: how many of the entry's keywords the user used,
        # rewarded for completeness so short, precise asks score high.
        base = overlap / (len(kw) ** 0.5 + 1.0)

        # Page match — strongly prefer entries scoped to the current page.
        if page_id in entry.pages:
            base *= 2.0
        elif "*" in entry.pages:
            base *= 1.05

        # Role match — small but real preference.
        if entry.role and entry.role == role:
            base *= 1.15
        elif entry.role and role and entry.role != role:
            # Different role — likely irrelevant.
            base *= 0.55

        # Entry weight (used for high-signal items like PAN/Aadhaar).
        base *= entry.weight

        if best is None or base > best.score:
            best = Match(entry, base)

    if best is None:
        return None

    # Confidence floor — below this we'd rather show suggestions than guess.
    if best.score < 0.30:
        return None

    return best
