"""Curvas de sobrecorrente temporizada do SEL-751 (manual, tabelas 4.20 a 4.22).

Tempo de operação (M > 1):   tp = TD * (A / (M**P - 1) + B)
Tempo de reset eletromecânico (M <= 1):   tr = TD * R / (1 - M**Q)
"""
from __future__ import annotations

# curva: (A, P, B, R, Q)
_CURVES: dict[str, tuple[float, float, float, float, float]] = {
    "U1": (0.0104, 0.02, 0.0226, 1.08, 2.0),    # IEEE/US moderadamente inversa
    "U2": (5.95, 2.0, 0.180, 5.95, 2.0),         # US inversa
    "U3": (3.88, 2.0, 0.0963, 3.88, 2.0),        # US muito inversa
    "U4": (5.67, 2.0, 0.0352, 5.67, 2.0),        # US extremamente inversa
    "U5": (0.00342, 0.02, 0.00262, 0.323, 2.0),  # US tempo curto
    "C1": (0.14, 0.02, 0.0, 13.5, 2.0),          # IEC normal inversa
    "C2": (13.5, 1.0, 0.0, 47.3, 2.0),           # IEC muito inversa
    "C3": (80.0, 2.0, 0.0, 80.0, 2.0),           # IEC extremamente inversa
    "C4": (120.0, 1.0, 0.0, 120.0, 1.0),         # IEC tempo longo (reset em 1 - M)
    "C5": (0.05, 0.04, 0.0, 4.85, 2.0),          # IEC tempo curto
    "E1": (0.0515, 0.02, 0.1140, 4.85, 2.0),     # IEEE C37.112 moderadamente inversa
    "E2": (19.61, 2.0, 0.491, 21.6, 2.0),        # IEEE C37.112 muito inversa
    "E3": (28.2, 2.0, 0.1217, 29.1, 2.0),        # IEEE C37.112 extremamente inversa
}

CURVE_NAMES = {
    "U1": "US moderadamente inversa", "U2": "US inversa", "U3": "US muito inversa",
    "U4": "US extremamente inversa", "U5": "US tempo curto",
    "C1": "IEC normal inversa", "C2": "IEC muito inversa", "C3": "IEC extremamente inversa",
    "C4": "IEC tempo longo", "C5": "IEC tempo curto",
    "E1": "IEEE moderadamente inversa", "E2": "IEEE muito inversa", "E3": "IEEE extremamente inversa",
}

SAT_MULTIPLE = 30.0   # com 51SAT = Y o múltiplo é limitado a 30 (achatamento da curva)


def known(curve: str) -> bool:
    return curve.upper() in _CURVES


def operate_time(curve: str, multiple: float, time_dial: float, saturate: bool = True) -> float:
    """Tempo de operação (s) para ``multiple`` = I / pickup. Retorna inf se M <= 1.

    Não inclui o somador de tempo constante (51_CT) nem a resposta mínima (51_MR).
    """
    if multiple <= 1.0:
        return float("inf")
    a, p, b, _, _ = _CURVES.get(curve.upper(), _CURVES["C1"])
    m = min(multiple, SAT_MULTIPLE) if saturate else multiple
    return time_dial * (a / (m ** p - 1.0) + b)


def reset_time(curve: str, time_dial: float, multiple: float = 0.0) -> float:
    """Tempo de reset eletromecânico (s) para ``multiple`` = I / pickup (0 a 1)."""
    _, _, _, r, q = _CURVES.get(curve.upper(), _CURVES["C1"])
    m = min(max(multiple, 0.0), 0.999)
    return max(time_dial * r / (1.0 - m ** q), 1e-3)
