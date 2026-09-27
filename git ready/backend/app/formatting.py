"""Display formatting for attendance percentages.

This is the ONLY place the backend turns an attendance percentage into text
(emails, plain-text emails, audit-log details).  It is deliberately free of any
imports beyond the standard library so it can be tested on its own.

The frontend has a matching function, ``formatAttendancePercentage`` in
``frontend/src/utils/attendance.js``.  The two MUST stay identical so that an
email and the portal never show different numbers for the same student.

Rules
-----
* Exactly 2 digits after the point:            74.94117647... -> "74.94"
* Exactly 0 and exactly 100 use ONE digit:     0 -> "0.0",  100 -> "100.0"
* Ties round half-up (JavaScript ``toFixed`` does this; Python's own ``:.2f``
  rounds half-to-even, which is why 78.125 used to be "78.12" in emails but
  "78.13" in the portal).
* Rounding never pushes a student across a threshold.  74.996 is *below* 75 and
  must not be displayed as "75.00"; likewise 89.996 must not become "90.00" and
  99.996 must not become "100.00".  Such values are shown one step below
  ("74.99", "89.99", "99.99").

Display only: eligibility / shortage decisions always use the raw number.
"""

import math
from decimal import Decimal, ROUND_HALF_UP

_TWO_DP = Decimal("0.01")

# (threshold, the largest 2-decimal value that is still strictly below it)
_CAPS = (
    (Decimal(75), Decimal("74.99")),
    (Decimal(90), Decimal("89.99")),
    (Decimal(100), Decimal("99.99")),
)


def format_attendance_percentage(value) -> str:
    """Return the percentage as display text, WITHOUT the trailing '%' sign."""
    try:
        n = float(value)
    except (TypeError, ValueError):
        return "0.0"
    if not math.isfinite(n) or n <= 0:
        return "0.0"
    if n >= 100:
        return "100.0"

    exact = Decimal(n)  # the exact binary value, i.e. exactly what JS toFixed sees
    rounded = exact.quantize(_TWO_DP, rounding=ROUND_HALF_UP)

    for threshold, cap in _CAPS:
        if exact < threshold <= rounded:
            rounded = cap
            break

    if rounded <= 0:  # a tiny non-zero value must not masquerade as 0
        rounded = _TWO_DP

    return f"{rounded:.2f}"
