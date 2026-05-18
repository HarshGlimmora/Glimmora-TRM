"""Knowledge base for the in-product assistant.

Every answer is grounded in a `KBEntry` that includes:
  - the page(s) it applies to,
  - synonyms / aliases the user might type,
  - a short, plain-language answer,
  - a user-friendly citation (e.g. "Dashboard › Recent activity").

Pages are addressed by stable ids (see `PAGES`). The frontend resolves the
current pathname into a page id and passes it with every question; the
matcher uses that id to prefer page-relevant answers.

This file is intentionally hand-written content (not generated). Add new
entries here rather than embedding them in code or prompts.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Sequence


# ---------------------------------------------------------------------------
# Page registry
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Page:
    id: str
    label: str
    section: str
    role: str | None = None        # "taxpayer" | "consultant" | None (both)
    sensitive: bool = False        # contains PAN / Aadhaar / OTP entry
    payment_like: bool = False     # submit/payment-ish screens


PAGES: dict[str, Page] = {
    "dashboard":         Page("dashboard",         "Overview",          "Dashboard"),
    "connections":       Page("connections",       "Connections",       "Connections"),
    "filings_new":       Page("filings_new",       "Start a filing",    "Filings"),
    "filing_documents":  Page("filing_documents",  "Documents",         "Filing"),
    "filing_transactions": Page("filing_transactions", "Transactions",  "Filing"),
    "filing_regime":     Page("filing_regime",     "Regime",            "Filing"),
    "filing_summary":    Page("filing_summary",    "Summary",           "Filing"),
    "filing_submit":     Page("filing_submit",     "Submit",            "Filing", payment_like=True, sensitive=True),
    # Auth / onboarding screens — the assistant is suppressed on these.
    "auth_login":        Page("auth_login",        "Sign in",           "Sign in", sensitive=True),
    "auth_verify":       Page("auth_verify",       "Verify identity",   "Sign in", sensitive=True),
    "auth_role":         Page("auth_role",         "Choose role",       "Sign in"),
    "onboarding":        Page("onboarding",        "Set up your profile", "Onboarding", sensitive=True),
    "unknown":           Page("unknown",           "Glimmora Tax",      "Glimmora Tax"),
}


def page(pid: str) -> Page:
    return PAGES.get(pid, PAGES["unknown"])


# ---------------------------------------------------------------------------
# KB entries
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class KBEntry:
    id: str
    pages: tuple[str, ...]            # ("*",) means global
    intent: str                        # what is the user trying to learn
    answer: str                        # plain-language answer
    citation: str                      # "Dashboard › Recent activity"
    aliases: tuple[str, ...] = ()      # extra trigger phrases
    role: str | None = None            # "taxpayer" | "consultant" | None
    weight: float = 1.0                # nudge for tie-breaks


# Convenience builder — keeps the list below readable.
def _kb(
    id: str,
    pages: Sequence[str],
    intent: str,
    answer: str,
    citation: str,
    aliases: Sequence[str] = (),
    role: str | None = None,
    weight: float = 1.0,
) -> KBEntry:
    return KBEntry(id, tuple(pages), intent, answer, citation, tuple(aliases), role, weight)


KB: list[KBEntry] = [
    # -----------------------------------------------------------------------
    # Global / always-available
    # -----------------------------------------------------------------------
    _kb(
        "what-is-glimmora",
        ["*"],
        "what is this app",
        "Glimmora Tax helps you organise documents, classify income and "
        "deductions, choose between the old and new tax regimes, and prepare "
        "a clean filing summary. It also connects you with a Chartered "
        "Accountant when you want a second pair of eyes.",
        "About Glimmora Tax",
        aliases=("what does this app do", "what is glimmora", "what is this product", "what is trm"),
    ),
    _kb(
        "next-step",
        ["*"],
        "what should i do next",
        "Open the Overview screen and look at the primary call-to-action at "
        "the top. It always points at the single most useful next step for "
        "you — finishing onboarding, linking a CA, starting a filing, or "
        "uploading documents.",
        "Dashboard › Primary action",
        aliases=("what now", "where to start", "next step", "what is next"),
    ),
    _kb(
        "sensitive-pan-aadhaar",
        ["*"],
        "show my pan or aadhaar",
        "Your PAN and Aadhaar are stored encrypted, so the assistant can't "
        "display them here. You can see the masked version under "
        "Dashboard › Identity, and edit them from Profile › Identity after "
        "verifying your session.",
        "Dashboard › Identity",
        aliases=(
            "show pan", "show my pan", "display pan", "what is my pan",
            "show aadhaar", "show aadhar", "what is my aadhaar",
            "reveal pan", "unmask pan", "full pan number",
        ),
        weight=1.3,
    ),
    _kb(
        "ca-link-overview",
        ["*"],
        "what is ca linking",
        "Linking with a Chartered Accountant lets a verified consultant view "
        "the filings you choose to share, comment on transactions, and help "
        "you submit. You stay in control — you can revoke access at any time "
        "from Connections.",
        "Connections › Linked consultants",
        aliases=("ca link", "link consultant", "consultant access", "what is ca", "how does ca linking work"),
    ),

    # -----------------------------------------------------------------------
    # Dashboard
    # -----------------------------------------------------------------------
    _kb(
        "dashboard-purpose",
        ["dashboard"],
        "what is this page",
        "The Overview gives you a single snapshot of where things stand: "
        "your identity status, summary metrics, upcoming actions, alerts to "
        "address, and a recent-activity timeline.",
        "Dashboard › Overview",
        aliases=(
            "explain this screen", "what is this screen",
            "what is the dashboard", "what is overview",
        ),
    ),
    _kb(
        "dashboard-stats",
        ["dashboard"],
        "what do the metric cards mean",
        "Each metric card summarises one part of your account — for example "
        "active filings, pending documents, or linked consultants. Tap a "
        "card to jump to the screen behind it.",
        "Dashboard › Summary metrics",
        aliases=("what are these numbers", "stat cards", "metric cards", "summary tiles"),
    ),
    _kb(
        "dashboard-alerts",
        ["dashboard"],
        "what are alerts",
        "Alerts highlight things that need your attention before you can "
        "move forward — a missing document, an expired link, or a regime "
        "decision waiting on you. Resolve them from the alert itself.",
        "Dashboard › Alerts",
        aliases=("what is an alert", "red banner", "warning banner"),
    ),
    _kb(
        "dashboard-activity",
        ["dashboard"],
        "what is recent activity",
        "Recent activity is an append-only audit trail of every identity, "
        "profile and linking event on your account. Use it to confirm what "
        "happened and when.",
        "Dashboard › Recent activity",
        aliases=("activity timeline", "audit log", "audit trail", "history"),
    ),
    _kb(
        "dashboard-identity",
        ["dashboard"],
        "what is the identity card",
        "The Identity card shows the verified parts of your profile — "
        "masked PAN, verification badges, and your role. Sensitive values "
        "stay encrypted and only the masked form is shown.",
        "Dashboard › Identity",
        aliases=("identity card", "verified badge", "what is verified"),
    ),

    # -----------------------------------------------------------------------
    # Connections
    # -----------------------------------------------------------------------
    _kb(
        "connections-purpose",
        ["connections"],
        "what is this page",
        "Connections is where you manage who can see your filings. Taxpayers "
        "link a Chartered Accountant; consultants see their list of clients. "
        "Every link is consent-based and revocable.",
        "Connections",
        aliases=(
            "explain connections", "what is connections", "what does connections do",
            "explain this screen", "what is this screen",
        ),
    ),
    _kb(
        "connections-link-status",
        ["connections", "dashboard"],
        "what do the connection statuses mean",
        "Pending means you've sent an invite that the other side hasn't "
        "accepted yet. Active means the link is live and the consultant can "
        "see what you've shared. Revoked means the link has been ended — "
        "the consultant no longer has access.",
        "Connections › Status",
        aliases=("pending status", "active status", "revoked status", "what does pending mean", "what is active"),
    ),
    _kb(
        "connections-revoke",
        ["connections"],
        "how do i revoke a consultant",
        "Open the consultant row in Connections and choose Revoke. Access is "
        "removed immediately and recorded in your audit trail. The "
        "consultant keeps no copy of anything they previously viewed.",
        "Connections › Linked consultants",
        aliases=("remove ca", "revoke ca", "unlink consultant", "end link", "disconnect ca"),
    ),
    _kb(
        "connections-invite",
        ["connections"],
        "how do i invite a ca",
        "Use Add consultant in Connections, enter the CA's ICAI membership "
        "number or registered email, and send the invite. They'll see it on "
        "their own Connections page and can accept or decline.",
        "Connections › Add consultant",
        aliases=("add ca", "send invite to ca", "invite consultant", "link a new ca"),
        role="taxpayer",
    ),
    _kb(
        "connections-clients",
        ["connections"],
        "what is the clients list",
        "Clients are taxpayers who have linked you as their consultant. "
        "You only see the filings they've shared with you, and only while "
        "the link is active.",
        "Connections › Clients",
        aliases=("client list", "my clients", "who are my clients"),
        role="consultant",
    ),

    # -----------------------------------------------------------------------
    # Start a filing
    # -----------------------------------------------------------------------
    _kb(
        "filings-new-purpose",
        ["filings_new"],
        "what is this page",
        "This screen starts a new filing for a chosen assessment year. Pick "
        "the year and an initial regime preference — both can be changed "
        "later before you submit.",
        "Filings › New",
        aliases=("explain this screen", "what is this screen", "start filing", "new filing"),
    ),
    _kb(
        "what-is-ay",
        ["filings_new", "filing_summary", "filing_regime"],
        "what is assessment year",
        "Assessment year is the year you file for the income earned in the "
        "previous financial year. For example, income earned in FY 2024-25 "
        "is filed in AY 2025-26.",
        "Filings › Assessment year",
        aliases=("ay", "assessment year", "what is ay", "fy vs ay"),
    ),

    # -----------------------------------------------------------------------
    # Filing — Documents
    # -----------------------------------------------------------------------
    _kb(
        "documents-purpose",
        ["filing_documents"],
        "what is this page",
        "Documents is where you upload everything that backs this filing — "
        "Form 16, AIS, capital-gains statements, bank interest certificates "
        "and so on. We classify each file and route its numbers into the "
        "Transactions tab automatically.",
        "Filing › Documents",
        aliases=(
            "what is documents", "explain documents", "what do i upload",
            "explain this screen", "what is this screen",
        ),
    ),
    _kb(
        "documents-upload",
        ["filing_documents"],
        "how do i upload a document",
        "Drag a file into the upload area or click to choose one. Once it's "
        "uploaded, we identify it, extract the line items, and show you a "
        "routing report so you can confirm what we picked up.",
        "Filing › Documents › Upload",
        aliases=("upload file", "add document", "how to upload", "drag drop"),
    ),
    _kb(
        "documents-routing-report",
        ["filing_documents"],
        "what is the routing report",
        "The routing report explains how a document was classified — which "
        "filing it joined, the financial year detected, and which "
        "transactions were created from it. Use it to spot anything we got "
        "wrong before it flows downstream.",
        "Filing › Documents › Routing report",
        aliases=("routing", "classification", "what is routing", "fy detected"),
    ),
    _kb(
        "documents-wrong-fy",
        ["filing_documents"],
        "the document was assigned the wrong year",
        "Open the document, click Reassign financial year, and pick the "
        "correct one. We'll move the document and its transactions to the "
        "right filing.",
        "Filing › Documents › Reassign FY",
        aliases=("wrong year", "change fy", "reassign fy", "fy mismatch", "wrong financial year"),
    ),
    _kb(
        "documents-extraction",
        ["filing_documents"],
        "what is extraction",
        "Extraction is the step where we read line items out of your "
        "document — figures, dates, counterparties. You can review and edit "
        "anything that looks off before it lands in Transactions.",
        "Filing › Documents › Extraction",
        aliases=("what is extracted", "ocr", "extract data", "edit extraction"),
    ),

    # -----------------------------------------------------------------------
    # Filing — Transactions
    # -----------------------------------------------------------------------
    _kb(
        "transactions-purpose",
        ["filing_transactions"],
        "what is this page",
        "Transactions is the unified ledger for this filing — every income, "
        "deduction and tax-paid line, grouped by category. Edits here flow "
        "into the regime comparison and final summary.",
        "Filing › Transactions",
        aliases=(
            "what is transactions", "explain transactions", "ledger",
            "explain this screen", "what is this screen",
        ),
    ),
    _kb(
        "transactions-edit",
        ["filing_transactions"],
        "how do i edit a transaction",
        "Click a transaction row to open the edit drawer. Update the amount, "
        "category or notes, then save — changes recalculate the summary "
        "instantly.",
        "Filing › Transactions › Edit",
        aliases=("edit row", "change amount", "fix transaction", "modify transaction"),
    ),
    _kb(
        "transactions-category",
        ["filing_transactions"],
        "what is a category",
        "Category is the tax-code bucket a transaction belongs to — for "
        "example Salary, House property, Section 80C, or TDS. The category "
        "decides how the amount is treated under the chosen regime.",
        "Filing › Transactions › Category",
        aliases=("what category", "what does category mean", "tax bucket"),
    ),

    # -----------------------------------------------------------------------
    # Filing — Regime
    # -----------------------------------------------------------------------
    _kb(
        "regime-purpose",
        ["filing_regime"],
        "what is this page",
        "Regime is where you compare the old and new tax regimes for this "
        "filing. We show both calculations side by side so you can pick the "
        "one that costs you less.",
        "Filing › Regime",
        aliases=(
            "what is regime", "explain regime", "old vs new",
            "explain this screen", "what is this screen",
        ),
    ),
    _kb(
        "regime-old-vs-new",
        ["filing_regime", "filing_summary"],
        "old regime vs new regime",
        "The old regime lets you claim deductions like 80C, HRA and home "
        "loan interest. The new regime has lower slab rates but very few "
        "deductions. Glimmora calculates both and recommends the lower one.",
        "Filing › Regime › Comparison",
        aliases=("which regime", "old regime", "new regime", "115bac"),
    ),
    _kb(
        "regime-switching",
        ["filing_regime"],
        "can i switch regime later",
        "Yes — until you submit, you can switch regimes from this screen "
        "and we'll recalculate everything. After submission, Section 115BAC "
        "rules apply to future switches, which we'll warn you about with a "
        "clear modal.",
        "Filing › Regime › Switching",
        aliases=("switch regime", "change regime", "115bac switch", "can i change regime"),
    ),

    # -----------------------------------------------------------------------
    # Filing — Summary
    # -----------------------------------------------------------------------
    _kb(
        "summary-purpose",
        ["filing_summary"],
        "what is this page",
        "Summary is the final read of your filing — total income, total "
        "deductions, taxable income, tax payable or refund, and the regime "
        "you chose. Review this carefully before going to Submit.",
        "Filing › Summary",
        aliases=(
            "what is summary", "final numbers", "explain summary",
            "explain this screen", "what is this screen",
        ),
    ),
    _kb(
        "summary-trace",
        ["filing_summary"],
        "where does this number come from",
        "Open the calculation trace accordion next to any total. It expands "
        "to show the exact transactions and rules that produced the "
        "number — including the section of the Act each piece references.",
        "Filing › Summary › Calculation trace",
        aliases=("calculation trace", "how was this calculated", "show working", "audit"),
    ),

    # -----------------------------------------------------------------------
    # Filing — Submit (assistant is suppressed on this page, but keep KB so
    # the question can still be answered when asked from elsewhere)
    # -----------------------------------------------------------------------
    _kb(
        "submit-purpose",
        ["filing_summary"],
        "what is submit",
        "Submit is the last step — we verify the filing with an OTP, lock "
        "the numbers, and hand off to the e-filing portal. The assistant is "
        "intentionally hidden on Submit so nothing distracts from that step.",
        "Filing › Submit",
        aliases=("what is submit", "how do i submit", "final step", "lock filing"),
    ),
]


# ---------------------------------------------------------------------------
# Suggestion chips (shown in the empty state, page-aware)
# ---------------------------------------------------------------------------

SUGGESTIONS: dict[str, list[str]] = {
    "dashboard": [
        "Explain this screen",
        "What do the metric cards mean?",
        "What is an alert?",
        "What should I do next?",
    ],
    "connections": [
        "What does Pending mean?",
        "How do I revoke a consultant?",
        "How do I invite a CA?",
        "What is CA linking?",
    ],
    "filings_new": [
        "What is assessment year?",
        "How do I start a filing?",
        "Can I change the year later?",
        "What should I do next?",
    ],
    "filing_documents": [
        "How do I upload a document?",
        "What is the routing report?",
        "The wrong year was detected",
        "What is extraction?",
    ],
    "filing_transactions": [
        "How do I edit a transaction?",
        "What is a category?",
        "Explain this screen",
        "Where does this number come from?",
    ],
    "filing_regime": [
        "Old regime vs new regime",
        "Can I switch regime later?",
        "Explain this screen",
        "What is 115BAC?",
    ],
    "filing_summary": [
        "Where does this number come from?",
        "What is taxable income?",
        "What is submit?",
        "Old regime vs new regime",
    ],
}

DEFAULT_SUGGESTIONS = [
    "Explain this screen",
    "What should I do next?",
    "What is CA linking?",
    "What is assessment year?",
]


def suggestions_for(page_id: str) -> list[str]:
    return SUGGESTIONS.get(page_id, DEFAULT_SUGGESTIONS)
