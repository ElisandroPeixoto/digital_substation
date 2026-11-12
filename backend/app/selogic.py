"""Interpretador de equações SELogic (subconjunto usado pelo SEL-751).

Operadores: NOT, AND, OR, XOR, R_TRIG, F_TRIG, comparações, + - * /, ABS(), SQRT().
Comentários começam com ``#``. ``NA`` e ``OFF`` equivalem a "sem equação" (valor 0).

Importante: todas as sub-expressões são avaliadas a cada chamada (sem curto-circuito),
para que os detectores de borda (R_TRIG / F_TRIG) acompanhem o sinal em todo ciclo.
"""
from __future__ import annotations

import math
import re
from typing import Callable

Resolver = Callable[[str], float]

_TOKEN_RE = re.compile(r"\s*(<=|>=|<>|[()+\-*/<>=,]|[A-Za-z0-9_.]+)")
_NUM_RE = re.compile(r"^(\d+(\.\d*)?|\.\d+)$")
_FUNCS: dict[str, Callable[[float], float]] = {
    "ABS": abs,
    "SQRT": lambda x: math.sqrt(x) if x >= 0 else 0.0,
}


class SelogicError(ValueError):
    pass


def split_comment(text: str) -> tuple[str, str]:
    """Separa a equação do comentário (``# ...``)."""
    if "#" in text:
        expr, comment = text.split("#", 1)
        return expr.strip(), comment.strip()
    return text.strip(), ""


# --------------------------------------------------------------------- nós
class _Num:
    def __init__(self, v: float) -> None:
        self.v = v

    def ev(self, r: Resolver) -> float:
        return self.v


class _Ident:
    def __init__(self, name: str) -> None:
        self.name = name

    def ev(self, r: Resolver) -> float:
        return r(self.name)


class _Not:
    def __init__(self, a) -> None:
        self.a = a

    def ev(self, r: Resolver) -> float:
        return 0.0 if self.a.ev(r) else 1.0


class _Neg:
    def __init__(self, a) -> None:
        self.a = a

    def ev(self, r: Resolver) -> float:
        return -self.a.ev(r)


class _Func:
    def __init__(self, fn, a) -> None:
        self.fn, self.a = fn, a

    def ev(self, r: Resolver) -> float:
        return float(self.fn(self.a.ev(r)))


class _Trig:
    """R_TRIG (borda de subida) e F_TRIG (borda de descida)."""

    def __init__(self, rising: bool, a) -> None:
        self.rising, self.a = rising, a
        self.prev: bool | None = None

    def ev(self, r: Resolver) -> float:
        cur = bool(self.a.ev(r))
        prev = self.prev
        self.prev = cur
        if prev is None:  # primeira avaliação: sem borda
            return 0.0
        if self.rising:
            return 1.0 if (cur and not prev) else 0.0
        return 1.0 if (prev and not cur) else 0.0


class _Bin:
    def __init__(self, op: str, a, b) -> None:
        self.op, self.a, self.b = op, a, b

    def ev(self, r: Resolver) -> float:
        x = self.a.ev(r)
        y = self.b.ev(r)
        op = self.op
        if op == "AND":
            return 1.0 if (x and y) else 0.0
        if op == "OR":
            return 1.0 if (x or y) else 0.0
        if op == "XOR":
            return 1.0 if (bool(x) != bool(y)) else 0.0
        if op == "+":
            return x + y
        if op == "-":
            return x - y
        if op == "*":
            return x * y
        if op == "/":
            return x / y if y else 0.0
        if op == "<":
            return 1.0 if x < y else 0.0
        if op == ">":
            return 1.0 if x > y else 0.0
        if op == "<=":
            return 1.0 if x <= y else 0.0
        if op == ">=":
            return 1.0 if x >= y else 0.0
        if op == "=":
            return 1.0 if x == y else 0.0
        if op == "<>":
            return 1.0 if x != y else 0.0
        return 0.0


# ------------------------------------------------------------------ parser
class _Parser:
    def __init__(self, tokens: list[str]) -> None:
        self.t = tokens
        self.i = 0
        self.idents: list[str] = []

    def _peek(self) -> str | None:
        return self.t[self.i].upper() if self.i < len(self.t) else None

    def _next(self) -> str:
        tok = self.t[self.i]
        self.i += 1
        return tok

    def parse(self):
        node = self._or()
        if self.i != len(self.t):
            raise SelogicError(f"token inesperado: {self.t[self.i]!r}")
        return node

    def _or(self):
        node = self._xor()
        while self._peek() == "OR":
            self._next()
            node = _Bin("OR", node, self._xor())
        return node

    def _xor(self):
        node = self._and()
        while self._peek() == "XOR":
            self._next()
            node = _Bin("XOR", node, self._and())
        return node

    def _and(self):
        node = self._cmp()
        while self._peek() == "AND":
            self._next()
            node = _Bin("AND", node, self._cmp())
        return node

    def _cmp(self):
        node = self._add()
        if self._peek() in ("<", ">", "<=", ">=", "=", "<>"):
            op = self._next()
            node = _Bin(op, node, self._add())
        return node

    def _add(self):
        node = self._mul()
        while self._peek() in ("+", "-"):
            op = self._next()
            node = _Bin(op, node, self._mul())
        return node

    def _mul(self):
        node = self._unary()
        while self._peek() in ("*", "/"):
            op = self._next()
            node = _Bin(op, node, self._unary())
        return node

    def _unary(self):
        tok = self._peek()
        if tok == "NOT":
            self._next()
            return _Not(self._unary())
        if tok == "-":
            self._next()
            return _Neg(self._unary())
        if tok == "R_TRIG":
            self._next()
            return _Trig(True, self._unary())
        if tok == "F_TRIG":
            self._next()
            return _Trig(False, self._unary())
        return self._primary()

    def _primary(self):
        if self.i >= len(self.t):
            raise SelogicError("expressão incompleta")
        tok = self._next()
        up = tok.upper()
        if tok == "(":
            node = self._or()
            if self._peek() != ")":
                raise SelogicError("parêntese não fechado")
            self._next()
            return node
        if _NUM_RE.match(tok):
            return _Num(float(tok))
        if up in _FUNCS and self._peek() == "(":
            self._next()
            arg = self._or()
            if self._peek() != ")":
                raise SelogicError("parêntese não fechado")
            self._next()
            return _Func(_FUNCS[up], arg)
        if re.fullmatch(r"[A-Za-z0-9_.]+", tok) and up not in ("AND", "OR", "XOR", "NOT"):
            self.idents.append(up)
            return _Ident(up)
        raise SelogicError(f"token inesperado: {tok!r}")


class Expr:
    """Equação SELogic compilada."""

    __slots__ = ("source", "text", "comment", "root", "idents", "error", "disabled")

    def __init__(self, source: str) -> None:
        self.source = source
        self.text, self.comment = split_comment(source)
        self.root = None
        self.idents: list[str] = []
        self.error: str | None = None
        self.disabled = self.text.upper() in ("", "NA", "OFF")
        if self.disabled:
            return
        try:
            tokens = [m.group(1) for m in _TOKEN_RE.finditer(self.text)]
            consumed = sum(len(m.group(0)) for m in _TOKEN_RE.finditer(self.text))
            if consumed != len(self.text):
                raise SelogicError("caractere inválido")
            parser = _Parser(tokens)
            self.root = parser.parse()
            self.idents = parser.idents
        except SelogicError as exc:
            self.error = str(exc)
            self.root = None

    def eval(self, resolver: Resolver) -> float:
        if self.root is None:
            return 0.0
        return self.root.ev(resolver)
