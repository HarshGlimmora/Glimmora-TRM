"""Decimal hygiene for monetary math.

All amounts inside the engine are Decimal quantized to paisa (two places). Floats
are banned on monetary paths — rupee arithmetic must round identically server-side
and on the PDF.
"""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Union

Money = Decimal

ZERO: Money = Decimal("0.00")
PAISA: Decimal = Decimal("0.01")
RUPEE: Decimal = Decimal("1")


def money(value: Union[str, int, float, Decimal, None]) -> Money:
    """Coerce input to a quantized paisa Decimal.

    floats are accepted because SQLAlchemy `Numeric` on SQLite returns floats; the
    boundary cast happens here and nowhere else.
    """
    if value is None:
        return ZERO
    if isinstance(value, Decimal):
        return value.quantize(PAISA, rounding=ROUND_HALF_UP)
    return Decimal(str(value)).quantize(PAISA, rounding=ROUND_HALF_UP)


def quantize(value: Decimal) -> Money:
    return value.quantize(PAISA, rounding=ROUND_HALF_UP)


def to_rupee(value: Decimal) -> Decimal:
    """Final ITR rounding — used at PDF/submission time only."""
    return value.quantize(RUPEE, rounding=ROUND_HALF_UP)
