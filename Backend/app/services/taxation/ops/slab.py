"""Slab math — walks ordered (from, to, rate) bands.

Slabs are piecewise-linear in taxable income; for each band the contribution is:

    max(0, min(taxable, band.to ?? +inf) - band.from) * band.rate
"""

from __future__ import annotations

from decimal import Decimal

from app.services.taxation.money import Money, ZERO, money, quantize
from app.services.taxation.rules import ResolvedRule
from app.services.taxation.trace import TraceBuilder


def compute_slab_pure(taxable: Money, rule: ResolvedRule) -> tuple[Money, list[dict]]:
    """Pure slab computation — same math as apply_slab but emits no trace step.

    Used by surcharge marginal-relief to compute tax-at-threshold without
    polluting the trace with synthetic intermediate steps.
    """
    bands = rule.rule_json["slabs"]
    running = ZERO
    breakdown: list[dict] = []

    for band in bands:
        lo = money(band["from"])
        hi_raw = band.get("to")
        hi = money(hi_raw) if hi_raw is not None else None
        rate = Decimal(str(band["rate"]))

        if taxable <= lo:
            amount_in_band = ZERO
        elif hi is None or taxable < hi:
            amount_in_band = quantize(taxable - lo)
        else:
            amount_in_band = quantize(hi - lo)

        tax_in_band = quantize(amount_in_band * rate)
        running = quantize(running + tax_in_band)

        breakdown.append({
            "band": _format_band(lo, hi),
            "rate": str(rate),
            "amount_in_band": str(amount_in_band),
            "tax": str(tax_in_band),
        })

    return running, breakdown


def apply_slab(taxable: Money, rule: ResolvedRule, trace: TraceBuilder) -> Money:
    running, breakdown = compute_slab_pure(taxable, rule)
    trace.step(
        op="apply_slab",
        section_ref=rule.section_ref,
        rule_id=rule.rule_id,
        rule_version=rule.version,
        input=str(taxable),
        breakdown=breakdown,
        result=running,
        human_explanation=_explain_slab(taxable, breakdown, running, rule.section_ref),
    )
    return running


def _format_band(lo: Money, hi: Money | None) -> str:
    if hi is None:
        return f"Above ₹{_inr(lo)}"
    return f"₹{_inr(lo)} – ₹{_inr(hi)}"


def _inr(v: Money) -> str:
    n = int(v)
    # Indian grouping: last 3 digits, then groups of 2.
    s = str(n)
    if len(s) <= 3:
        return s
    head, tail = s[:-3], s[-3:]
    grouped = ",".join([head[max(0, i - 2):i] for i in range(len(head), 0, -2)][::-1])
    return f"{grouped},{tail}"


def _explain_slab(taxable: Money, breakdown: list[dict], slab_tax: Money, section: str) -> str:
    parts = [
        f"Your taxable income of ₹{_inr(taxable)} is split across {len(breakdown)} slab(s) "
        f"under §{section}."
    ]
    for b in breakdown:
        if Decimal(b["amount_in_band"]) > 0:
            parts.append(
                f"  • {b['band']} @ {Decimal(b['rate']) * 100:g}% on ₹{_inr(money(b['amount_in_band']))} "
                f"→ ₹{_inr(money(b['tax']))}"
            )
    parts.append(f"Slab tax total: ₹{_inr(slab_tax)}.")
    return "\n".join(parts)
