"""Curvas de sobrecorrente temporizada do SEL-751 (US U1-U5 e IEC C1-C5)."""
from __future__ import annotations

# tempo = TD * (a / (M**p - 1) + b)
_CURVES: dict[str, tuple[float, float, float]] = {
    "U1": (0.0104, 0.02, 0.0226),   # moderadamente inversa
    "U2": (5.95, 2.0, 0.180),       # inversa
    "U3": (3.88, 2.0, 0.0963),      # muito inversa
    "U4": (5.67, 2.0, 0.0352),      # extremamente inversa
    "U5": (0.00342, 0.02, 0.00262),  # tempo curto
    "C1": (0.14, 0.02, 0.0),        # IEC normal inversa
    "C2": (13.5, 1.0, 0.0),         # IEC muito inversa
    "C3": (80.0, 2.0, 0.0),         # IEC extremamente inversa
    "C4": (120.0, 1.0, 0.0),        # IEC tempo longo
    "C5": (0.05, 0.04, 0.0),        # IEC tempo curto
}

# Constantes aproximadas de reset eletromecânico (RS = Y), em segundos por unidade de dial.
_RESET: dict[str, float] = {
    "U1": 4.85, "U2": 5.95, "U3": 21.6, "U4": 29.1, "U5": 0.323,
    "C1": 3.2, "C2": 15.0, "C3": 30.0, "C4": 120.0, "C5": 0.5,
}

CURVE_NAMES = {
    "U1": "IEEE moderadamente inversa", "U2": "IEEE inversa", "U3": "IEEE muito inversa",
    "U4": "IEEE extremamente inversa", "U5": "IEEE tempo curto",
    "C1": "IEC normal inversa", "C2": "IEC muito inversa", "C3": "IEC extremamente inversa",
    "C4": "IEC tempo longo", "C5": "IEC tempo curto",
}

MIN_OPERATE = 1 / 60.0   # 1 ciclo a 60 Hz


def operate_time(curve: str, multiple: float, time_dial: float) -> float:
    """Tempo de operação (s) para ``multiple`` = I / pickup. Retorna inf se M <= 1."""
    if multiple <= 1.0:
        return float("inf")
    a, p, b = _CURVES.get(curve.upper(), _CURVES["C1"])
    m = min(multiple, 20.0)
    t = time_dial * (a / (m ** p - 1.0) + b)
    return max(t, MIN_OPERATE)


def reset_time(curve: str, time_dial: float) -> float:
    return max(time_dial * _RESET.get(curve.upper(), 5.0), 0.01)
