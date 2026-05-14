"""House Property head — §§22–27 of the Income Tax Act, 1961.

Computation per property:

  GAV  (Gross Annual Value)
  − Municipal taxes paid by owner    → NAV (Net Annual Value)
  − 30% standard deduction §24(a)    [on positive NAV only; not on SO]
  − Interest on borrowed capital §24(b)
  = Income from House Property (can be a LOSS)

Regime treatment of §24(b) interest:
  • Old regime:
      - Self-occupied: up to ₹2,00,000 cap
      - Let-out: actual interest, no cap (but loss set-off limited to ₹2L per FY)
  • New regime (§115BAC):
      - Self-occupied: NOT ALLOWED
      - Let-out: actual interest allowed; loss set-off still ₹2L cap

Loss from House Property — set-off against other heads limited to ₹2,00,000 per FY
(Finance Act 2017). Excess carried forward 8 years (not implemented in MVP — only
the current-year cap is enforced).

Input format — `filing.summary_json["house_property"]` is a list:

    [
      {
        "label":          "My Mumbai flat",
        "occupancy":      "self_occupied" | "let_out" | "deemed_let_out",
        "gross_annual_value": 240000,       # actual rent or fair rent, whichever higher
        "municipal_taxes":      5000,       # paid by owner during the FY
        "interest_paid":      180000        # §24(b) — interest on borrowed capital
      }
    ]
"""

from __future__ import annotations

from typing import Any

from app.services.taxation.money import Money, ZERO, money, quantize
from app.services.taxation.result import HeadResult
from app.services.taxation.trace import TraceBuilder

LOSS_SETOFF_CAP = money(200000)         # FA 2017 cap on HP loss set-off
SO_INTEREST_CAP_OLD = money(200000)     # §24(b) cap for self-occupied (old regime)


def compute_head_house_property(
    declared: list[dict[str, Any]] | None,
    *,
    regime: str,
    trace: TraceBuilder,
) -> HeadResult:
    if not declared:
        return HeadResult(head="house_property")

    per_property_results: list[dict] = []
    aggregate = ZERO

    for idx, prop in enumerate(declared):
        label = prop.get("label") or f"Property #{idx + 1}"
        occupancy = (prop.get("occupancy") or "self_occupied").lower()
        gav = money(prop.get("gross_annual_value", 0))
        mtax = money(prop.get("municipal_taxes", 0))
        interest = money(prop.get("interest_paid", 0))

        if occupancy == "self_occupied":
            nav = ZERO
            std_24a = ZERO
            if regime == "new":
                interest_allowed = ZERO
                interest_disallowed_note = (
                    "§24(b) interest disallowed for self-occupied property under the "
                    "new regime (§115BAC). No deduction permitted."
                )
            else:
                interest_allowed = min(interest, SO_INTEREST_CAP_OLD)
                interest_disallowed_note = (
                    f"§24(b) interest of ₹{interest} capped at ₹{SO_INTEREST_CAP_OLD} "
                    f"for self-occupied property under the old regime."
                ) if interest > SO_INTEREST_CAP_OLD else ""
        else:
            # let_out or deemed_let_out
            nav = quantize(gav - mtax)
            std_24a = quantize(max(nav, ZERO) * money("0.30"))   # §24(a) — 30% standard, on positive NAV
            interest_allowed = interest   # full actual interest, both regimes
            interest_disallowed_note = ""

        income = quantize(nav - std_24a - interest_allowed)
        per_property_results.append({
            "label": label,
            "occupancy": occupancy,
            "gav": str(gav),
            "municipal_taxes": str(mtax),
            "nav": str(nav),
            "std_24a": str(std_24a),
            "interest_24b": str(interest_allowed),
            "income": str(income),
            "note": interest_disallowed_note,
        })
        aggregate = quantize(aggregate + income)

    # Apply loss set-off cap.
    setoff_capped = False
    aggregate_for_setoff = aggregate
    if aggregate < ZERO and aggregate < -LOSS_SETOFF_CAP:
        aggregate_for_setoff = quantize(-LOSS_SETOFF_CAP)
        setoff_capped = True

    trace.step(
        op="sum_head_house_property",
        section_ref="22-27",
        input={"properties": per_property_results, "regime": regime},
        breakdown=per_property_results,
        result=aggregate_for_setoff,
        loss_setoff_capped=setoff_capped,
        loss_setoff_cap=str(LOSS_SETOFF_CAP),
        human_explanation=_explain_hp(per_property_results, aggregate,
                                      aggregate_for_setoff, setoff_capped, regime),
    )
    return HeadResult(head="house_property", slab_taxable=aggregate_for_setoff)


def _explain_hp(per_property: list[dict], raw_total: Money, effective_total: Money,
                capped: bool, regime: str) -> str:
    lines = [
        f"Income from House Property aggregated across {len(per_property)} property "
        f"under §§22–27 ({regime} regime):"
    ]
    for p in per_property:
        lines.append(
            f"  • {p['label']} ({p['occupancy']}): GAV ₹{p['gav']} − municipal "
            f"₹{p['municipal_taxes']} = NAV ₹{p['nav']}, − §24(a) 30% ₹{p['std_24a']} "
            f"− §24(b) interest ₹{p['interest_24b']} = ₹{p['income']}"
        )
        if p.get("note"):
            lines.append(f"    Note: {p['note']}")

    if capped:
        lines.append(
            f"Aggregate house-property income is ₹{raw_total} (a loss), but set-off "
            f"against other heads is capped at ₹{LOSS_SETOFF_CAP} per Finance Act 2017. "
            f"Effective loss applied: ₹{effective_total}. (Carry-forward of excess loss "
            f"for 8 years not implemented in MVP.)"
        )
    elif effective_total < ZERO:
        lines.append(f"Net loss from house property: ₹{effective_total} (within set-off cap).")
    else:
        lines.append(f"Net income from house property: ₹{effective_total}.")
    return "\n".join(lines)
