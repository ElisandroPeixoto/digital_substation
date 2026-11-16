"""Gera as figuras (SVG) usadas em docs/funcoes-50-51.md e docs/funcao-direcional-67.md.

Uso (na raiz do projeto, com matplotlib instalado):  python docs/img/gerar_figuras.py

As curvas vêm de backend/app/curves.py e a figura "67-simulacao" executa o próprio motor do DigitalRelay.
"""
from __future__ import annotations

import cmath
import math
import os
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch, Wedge  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "backend"))

from app import curves  # noqa: E402

BLUE, TEAL, RED, ORANGE, GRAY, PURPLE = "#2b6cb0", "#2c9a92", "#c53030", "#dd6b20", "#4a5568", "#6b46c1"
LIGHT = "#e2e8f0"
plt.rcParams.update({
    "font.size": 10, "axes.spines.top": False, "axes.spines.right": False, "axes.grid": True, "grid.alpha": 0.25,
    "svg.fonttype": "path", "figure.facecolor": "white", "axes.facecolor": "white", "savefig.facecolor": "white",
})


def save(fig, name: str) -> None:
    fig.savefig(OUT / f"{name}.svg", bbox_inches="tight")
    if os.environ.get("PREVIEW"):                      # PNGs temporários para conferência visual
        fig.savefig(Path(os.environ["PREVIEW"]) / f"{name}.png", bbox_inches="tight", dpi=70)
    plt.close(fig)
    print("ok", name)


def box(ax, x, y, w, h, text, fc=LIGHT, ec=GRAY, fs=9, **kw):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.02,rounding_size=0.08", fc=fc, ec=ec, lw=1.2, **kw))
    ax.text(x + w / 2, y + h / 2, text, ha="center", va="center", fontsize=fs)


def arrow(ax, p, q, color=GRAY, lw=1.4, style="-|>", **kw):
    ax.add_patch(FancyArrowPatch(p, q, arrowstyle=style, mutation_scale=12, color=color, lw=lw, **kw))


# ====================================================================== 50 / 51
def fig_conceito_50_51() -> None:
    fig, ax = plt.subplots(figsize=(8, 4.6))
    m = np.logspace(np.log10(1.02), np.log10(60), 400)
    t51 = np.array([curves.operate_time("C1", x, 0.5, saturate=False) for x in m])
    m50, d50 = 20.0, 0.05
    t = np.where(m < m50, t51, d50)
    ax.loglog(m, t, color=BLUE, lw=2.6, label="característica combinada (51 + 50)")
    ax.loglog(m, t51, color=BLUE, lw=1.2, ls="--", alpha=0.6, label="só o 51 (C1, TD = 0,5)")
    ax.axvline(1, color=GRAY, ls=":")
    ax.axvline(m50, color=RED, ls=":")
    ax.axvspan(0.5, 1, color=LIGHT, alpha=0.7)
    ax.axvspan(1, m50, color=BLUE, alpha=0.06)
    ax.axvspan(m50, 60, color=RED, alpha=0.08)
    ax.set_xlim(0.5, 60), ax.set_ylim(0.02, 200)
    ax.text(0.7, 8, "sem\natuação", ha="center", color=GRAY)
    ax.text(4.0, 60, "zona do 51\n(tempo inverso)", ha="center", color=BLUE, weight="bold")
    ax.text(33, 6, "zona do 50\n(instantâneo)", ha="center", color=RED, weight="bold")
    ax.annotate("pickup do 51\n(M = 1)", (1, 0.04), (1.12, 0.035), color=GRAY, fontsize=9)
    ax.annotate("pickup do 50\n(M = 20)", (m50, 0.04), (m50 * 0.52, 0.035), color=RED, fontsize=9)
    ax.annotate("atraso 50xnD", (35, d50), (22, 0.13), color=RED, fontsize=9, arrowprops=dict(arrowstyle="->", color=RED))
    ax.set_xlabel("corrente ÷ pickup do 51  (M)"), ax.set_ylabel("tempo de atuação (s)")
    ax.set_title("As funções 50 e 51 trabalham juntas: o 51 cobre as correntes baixas e o 50, as altas")
    ax.legend(loc="upper right", fontsize=8)
    save(fig, "50-51-conceito")


def fig_familias() -> None:
    fig, ax = plt.subplots(figsize=(8, 4.8))
    m = np.logspace(np.log10(1.05), np.log10(30), 300)
    cols = {"U1": "#718096", "U2": "#b7791f", "U3": ORANGE, "U4": RED, "C1": BLUE, "C2": TEAL, "C3": PURPLE, "E2": "#2d3748"}
    for c, col in cols.items():
        ax.loglog(m, [curves.operate_time(c, x, 1.0) for x in m], color=col, lw=2, label=f"{c} – {curves.CURVE_NAMES[c]}")
    ax.set_xlabel("múltiplo do pickup  M = I ÷ pickup"), ax.set_ylabel("tempo de atuação (s)  –  TD = 1,0")
    ax.set_title("Famílias de curvas do 51 (mesmo TD): quanto mais inversa, mais rápido em correntes altas")
    ax.set_ylim(0.03, 400), ax.legend(fontsize=8, loc="upper right", ncol=2)
    save(fig, "51-familias-curvas")


def fig_td() -> None:
    fig, ax = plt.subplots(figsize=(8, 4.4))
    m = np.logspace(np.log10(1.05), np.log10(30), 300)
    for td, col in zip((0.1, 0.3, 0.5, 1.0, 2.0), ("#90cdf4", "#63b3ed", BLUE, "#2c5282", "#1a365d")):
        ax.loglog(m, [curves.operate_time("C1", x, td) for x in m], color=col, lw=2, label=f"TD = {td:g}")
    ax.annotate("", xy=(6, 0.9), xytext=(6, 5.3), arrowprops=dict(arrowstyle="<->", color=GRAY))
    ax.text(1.6, 0.18, "o TD desloca a curva inteira\n(seta: efeito em M = 6)", fontsize=9, color=GRAY)
    ax.set_xlabel("múltiplo do pickup  M"), ax.set_ylabel("tempo de atuação (s)")
    ax.set_title("Efeito do dial de tempo (curva C1): o TD multiplica todos os tempos")
    ax.legend(fontsize=9)
    save(fig, "51-efeito-td")


def fig_coordenacao() -> None:
    fig, ax = plt.subplots(figsize=(8, 4.6))
    pick = 240.0
    i = np.logspace(np.log10(260), np.log10(12000), 300)
    for td, col, lab in ((0.3, TEAL, "relé de jusante (TD = 0,3)"), (0.5, BLUE, "relé de montante (TD = 0,5)")):
        t = [curves.operate_time("C1", x / pick, td) for x in i]
        ax.loglog(i, t, color=col, lw=2.4, label=lab)
    ifalta = 2400.0
    t1, t2 = curves.operate_time("C1", ifalta / pick, 0.3), curves.operate_time("C1", ifalta / pick, 0.5)
    ax.axvline(ifalta, color=GRAY, ls=":")
    ax.plot([ifalta, ifalta], [t1, t2], "o", color=RED)
    ax.annotate("", xy=(ifalta * 1.25, t2), xytext=(ifalta * 1.25, t1), arrowprops=dict(arrowstyle="<->", color=RED, lw=1.6))
    ax.text(ifalta * 1.5, math.sqrt(t1 * t2) * 1.9, f"margem de coordenação ≈ {t2 - t1:.2f} s", color=RED, fontsize=9, va="center")
    ax.annotate("acima de M = 30 a curva é\nachatada (51SAT = Y)", (7500, 1.0), (4200, 0.62), fontsize=8.5, color=GRAY, arrowprops=dict(arrowstyle="->", color=GRAY))
    ax.text(ifalta * 0.93, 0.5, "falta de 2400 A\n(M = 10)", ha="right", color=GRAY, fontsize=9)
    ax.set_xlabel("corrente primária (A)   –   pickup comum de 240 A"), ax.set_ylabel("tempo de atuação (s)")
    ax.set_title("Coordenação: o relé de jusante atua antes; o de montante é retaguarda")
    ax.legend(fontsize=9)
    save(fig, "51-coordenacao")


def fig_disco() -> None:
    dt = 0.002
    td, curve = 0.2, "C1"
    t = np.arange(0, 4.5, dt)
    mult = np.where((t >= 0.3) & (t < 1.1), 3.0, 0.0) + np.where(t >= 1.7, 3.0, 0.0)
    def run(em: bool):
        prog, idle, out, trip = 0.0, 0.0, [], None
        for k, m in enumerate(mult):
            if m > 1:
                idle = 0.0
                prog = min(1.0, prog + dt / curves.operate_time(curve, m, td))
            elif em:
                prog = max(0.0, prog - dt / curves.reset_time(curve, td, m))
            else:
                idle += dt
                if idle >= 1 / 60:
                    prog = 0.0
            if prog >= 1.0 and trip is None:
                trip = t[k]
            out.append(prog)
        return np.array(out), trip
    pn, tn = run(False)
    pe, te = run(True)
    fig, axs = plt.subplots(3, 1, figsize=(8, 6.2), sharex=True)
    axs[0].plot(t, mult, color=GRAY, lw=2)
    axs[0].axhline(1, color=RED, ls="--", lw=1)
    axs[0].text(4.45, 1.12, "pickup", color=RED, ha="right", fontsize=9)
    axs[0].set_ylabel("I ÷ pickup  (M)"), axs[0].set_title("Disco virtual do 51: avança com a corrente; no reset ele zera ou recua")
    for ax, p, tp, lab, col in ((axs[1], pn, tn, "reset em 1 ciclo (51xRS = N)", TEAL), (axs[2], pe, te, "reset eletromecânico (51xRS = Y)", BLUE)):
        ax.plot(t, p * 100, color=col, lw=2.2)
        ax.axhline(100, color=RED, ls=":", lw=1)
        ax.set_ylabel("disco (%)"), ax.set_ylim(-5, 115), ax.text(0.02, 0.8, lab, transform=ax.transAxes, color=col, weight="bold")
        if tp is not None:
            ax.plot([tp], [100], "o", color=RED)
            ax.annotate(f"atua em {tp:.2f} s", (tp, 100), (tp + 0.25, 70), arrowprops=dict(arrowstyle="->", color=RED), color=RED, fontsize=9)
    axs[2].set_xlabel("tempo (s)")
    save(fig, "51-disco-virtual")


def fig_tempo_definido() -> None:
    dt = 0.001
    t = np.arange(0, 1.2, dt)
    i = np.full_like(t, 5.0)
    i[(t >= 0.1) & (t < 0.55)] = 15.0
    i[(t >= 0.55) & (t < 0.7)] = 9.7           # entre 95 % e 100 % do pickup: mantém (histerese)
    i[(t >= 0.7) & (t < 0.9)] = 9.0
    i[(t >= 0.9) & (t < 0.95)] = 15.0          # pulso curto: não completa o atraso
    pk, delay = 10.0, 0.10
    p, tm, el = [], [], 0.0
    cur = False
    for x in i:
        cur = x >= pk or (cur and x >= 0.95 * pk)
        el = el + dt if cur else 0.0
        p.append(cur), tm.append(cur and el >= delay)
    fig, axs = plt.subplots(3, 1, figsize=(8, 5.4), sharex=True, gridspec_kw=dict(height_ratios=[2, 1, 1]))
    axs[0].plot(t, i, color=GRAY, lw=2)
    axs[0].axhline(pk, color=RED, ls="--"), axs[0].axhline(0.95 * pk, color=ORANGE, ls=":")
    axs[0].text(1.19, pk + 0.5, "pickup 50xnP (10 A)", ha="right", color=RED, fontsize=9)
    axs[0].text(1.19, 0.95 * pk - 1.6, "dropout (95 %)", ha="right", color=ORANGE, fontsize=9)
    axs[0].set_ylabel("corrente (A sec.)"), axs[0].set_title("Função 50: pickup, histerese de 95 % e atraso 50xnD = 0,10 s")
    axs[1].fill_between(t, 0, np.array(p), step="mid", color=BLUE, alpha=0.5), axs[1].set_ylabel("50xnP"), axs[1].set_yticks([0, 1])
    axs[2].fill_between(t, 0, np.array(tm), step="mid", color=RED, alpha=0.5), axs[2].set_ylabel("50xnT"), axs[2].set_yticks([0, 1])
    axs[2].set_xlabel("tempo (s)")
    axs[0].annotate("pulso de 50 ms < atraso:\nnão chega a atuar", (0.92, 15), (0.62, 17.2), fontsize=9, color=GRAY, arrowprops=dict(arrowstyle="->", color=GRAY))
    axs[0].annotate("entre 95 % e 100 %:\no pickup é mantido", (0.62, 9.7), (0.12, 12.2), fontsize=9, color=GRAY, arrowprops=dict(arrowstyle="->", color=GRAY))
    axs[0].set_ylim(0, 20)
    save(fig, "50-tempo-definido")


def fig_cadeia() -> None:
    fig, ax = plt.subplots(figsize=(10, 2.6))
    ax.set_xlim(0, 10.4), ax.set_ylim(0, 2.6), ax.axis("off")
    items = ["Corrente\n(TC)", "Elementos\n50 / 51", "Bits 50xnT\n51xT", "Equação\nTR", "TRIP\n(TDURD)", "Saída OUT\n(bobina)", "Disjuntor\nabre"]
    cols = [LIGHT, "#bee3f8", "#bee3f8", "#c6f6d5", "#fed7d7", "#fed7d7", "#fed7d7"]
    w, g = 1.15, 0.28
    for k, (txt, c) in enumerate(zip(items, cols)):
        x = 0.1 + k * (w + g)
        box(ax, x, 0.85, w, 0.9, txt, fc=c)
        if k:
            arrow(ax, (x - g + 0.02, 1.3), (x - 0.02, 1.3))
    ax.text(5.2, 2.3, "Do elemento ao disparo", ha="center", weight="bold")
    ax.text(3.0, 0.45, "controle de torque / direcional (67)\nhabilita ou bloqueia o elemento", ha="center", fontsize=8.5, color=GRAY)
    arrow(ax, (2.4, 0.8), (2.0, 0.92), color=GRAY)
    save(fig, "50-51-cadeia-disparo")


# ====================================================================== 67
def fig_67_conceito() -> None:
    fig, ax = plt.subplots(figsize=(9, 3.4))
    ax.set_xlim(0, 10), ax.set_ylim(0, 3.6), ax.axis("off")
    ax.plot([0.6, 9.6], [1.8, 1.8], color=GRAY, lw=2.5)
    ax.add_patch(plt.Circle((0.6, 1.8), 0.35, fc="white", ec=BLUE, lw=2)), ax.text(0.6, 1.8, "~", ha="center", va="center", fontsize=16, color=BLUE)
    ax.text(0.6, 1.1, "Fonte", ha="center", fontsize=9)
    ax.add_patch(plt.Rectangle((3.9, 1.55), 0.5, 0.5, fc=BLUE, ec=BLUE)), ax.text(4.15, 1.05, "Relé 67 + DJ", ha="center", fontsize=9)
    ax.plot([4.4, 4.4], [1.8, 2.8], color=TEAL, lw=1.8)
    arrow(ax, (4.15, 2.55), (6.2, 2.55), color=TEAL, lw=2.4), ax.text(5.2, 2.75, "FRENTE (polaridade do TC)", ha="center", color=TEAL, weight="bold", fontsize=9)
    arrow(ax, (4.15, 2.55), (2.1, 2.55), color=ORANGE, lw=2.4), ax.text(3.1, 2.75, "REVERSO", ha="center", color=ORANGE, weight="bold", fontsize=9)
    for x, lab, col in ((7.7, "Falta F1\n(à frente)", RED), (2.0, "Falta F2\n(atrás)", RED)):
        ax.plot([x, x], [1.8, 1.25], color=col, lw=2), ax.text(x, 0.75, lab, ha="center", color=col, fontsize=9)
        ax.plot([x - 0.15, x + 0.15, x], [1.25, 1.25, 1.05], color=col, lw=2)
    arrow(ax, (6.9, 1.35), (7.45, 1.35), color=RED), arrow(ax, (2.9, 1.35), (2.35, 1.35), color=RED)
    ax.text(9.2, 1.1, "Carga /\nrestante\ndo sistema", ha="center", fontsize=8.5, color=GRAY)
    ax.set_title("A corrente é alta nas duas faltas; só o sentido diferencia F1 (disparar) de F2 (não disparar)", fontsize=10)
    save(fig, "67-conceito")


def fig_67_fasores_q() -> None:
    fig, axs = plt.subplots(1, 2, figsize=(9.4, 4.0), subplot_kw=dict(aspect="equal"))
    i2 = cmath.rect(10, math.radians(-80))
    cases = ((axs[0], -20.0, "Falta À FRENTE:  V2 = −Z2s·I2", TEAL, "Z2 = −2 Ω  (negativo ⇒ frente)"),
             (axs[1], 10.0, "Falta ATRÁS:  V2 = +Z·I2", ORANGE, "Z2 = +1 Ω  (positivo ⇒ reverso)"))
    for ax, v, title, col, res in cases:
        ax.axhline(0, color=GRAY, lw=0.8), ax.axvline(0, color=GRAY, lw=0.8)
        ax.axvspan(-25, 0, color=TEAL, alpha=0.07), ax.axvspan(0, 25, color=ORANGE, alpha=0.07)
        ax.annotate("", xy=(i2.real, i2.imag), xytext=(0, 0), arrowprops=dict(arrowstyle="-|>", color=GRAY, lw=1.4, ls="--"))
        ax.text(i2.real + 0.8, i2.imag - 1.4, "I2 = 10∠−80°", color=GRAY, fontsize=8.5)
        ax.annotate("", xy=(10, 0), xytext=(0, 0), arrowprops=dict(arrowstyle="-|>", color=BLUE, lw=2.0))
        ax.text(10.4, -2.2, "I2∠Z1ANG\n(referência)", color=BLUE, fontsize=8.5, ha="left")
        ax.annotate("", xy=(v, 0.0), xytext=(0, 0), arrowprops=dict(arrowstyle="-|>", color=col, lw=2.8))
        ax.text(v / 2, 2.3, "V2", color=col, fontsize=11, weight="bold", ha="center")
        ax.set_xlim(-25, 25), ax.set_ylim(-12, 6), ax.set_title(title, fontsize=10, color=col), ax.set_xlabel(res, color=col)
        ax.text(-23.5, 4.2, "frente", color=TEAL, fontsize=9), ax.text(23.5, 4.2, "reverso", color=ORANGE, fontsize=9, ha="right")
        ax.grid(False)
    fig.suptitle("Elemento Q: o sinal da projeção de V2 sobre I2∠Z1ANG decide o sentido", fontsize=11)
    save(fig, "67-fasores-q")


def fig_67_z2() -> None:
    fig, axs = plt.subplots(2, 1, figsize=(8, 3.8), sharex=True)
    for ax, zmag, z2, lab, col in ((axs[0], 2.0, -2.0, "Exemplo à frente: |V2/I2| = 2 Ω, Z2 = −2 Ω", TEAL),
                                   (axs[1], 1.0, 1.0, "Exemplo atrás: |V2/I2| = 1 Ω, Z2 = +1 Ω", ORANGE)):
        fwd = 0.75 * -0.06 - 0.25 * zmag
        rev = 0.75 * 0.06 + 0.25 * zmag
        ax.axvspan(-4, fwd, color=TEAL, alpha=0.18), ax.axvspan(fwd, rev, color=LIGHT, alpha=0.7), ax.axvspan(rev, 4, color=ORANGE, alpha=0.18)
        for x in (fwd, rev):
            ax.axvline(x, color=GRAY, ls="--")
        ax.plot([z2], [0.5], "o", color=col, ms=9)
        ax.text(fwd - 0.1, 0.9, f"limiar frente\n{fwd:.3f} Ω", ha="right", fontsize=8.5), ax.text(rev + 0.1, 0.9, f"limiar reverso\n{rev:.3f} Ω", fontsize=8.5)
        ax.text(-3.9, 0.15, "FRENTE", color=TEAL, weight="bold"), ax.text(3.9, 0.15, "REVERSO", color=ORANGE, weight="bold", ha="right")
        ax.text(0, 0.15, "indefinido", ha="center", color=GRAY, fontsize=9)
        ax.set_xlim(-4, 4), ax.set_ylim(0, 1.4), ax.set_yticks([]), ax.grid(False), ax.set_title(lab, fontsize=9.5, loc="left")
        ax.spines["left"].set_visible(False)
    axs[1].set_xlabel("Z2 (Ω secundários)   –   Z2F = −0,06 Ω,  Z2R = +0,06 Ω")
    fig.suptitle("Limiares de Z2: a faixa 'indefinida' cresce com a impedância vista (margem de segurança)", fontsize=10.5)
    save(fig, "67-limiares-z2")


def fig_67_seq_positiva() -> None:
    fig, ax = plt.subplots(figsize=(5.6, 5.2))
    ax.set_aspect("equal"), ax.grid(False)
    th = np.deg2rad(np.linspace(-170, 10, 200))
    ax.fill(np.r_[0, 1.15 * np.cos(th), 0], np.r_[0, 1.15 * np.sin(th), 0], color=TEAL, alpha=0.15)
    th2 = np.deg2rad(np.linspace(10, 190, 200))
    ax.fill(np.r_[0, 1.15 * np.cos(th2), 0], np.r_[0, 1.15 * np.sin(th2), 0], color=ORANGE, alpha=0.15)
    ax.plot([-1.15 * math.cos(math.radians(10)), 1.15 * math.cos(math.radians(10))], [-1.15 * math.sin(math.radians(10)), 1.15 * math.sin(math.radians(10))], color=GRAY, ls="--")
    ax.axhline(0, color=GRAY, lw=0.6), ax.axvline(0, color=GRAY, lw=0.6)
    arrow(ax, (0, 0), (1.0, 0), color=BLUE, lw=2.6), ax.text(1.02, 0.04, "V1 (referência)", color=BLUE)
    arrow(ax, (0, 0), (math.cos(math.radians(-80)), math.sin(math.radians(-80))), color=TEAL, lw=2.4)
    ax.text(0.2, -1.12, "I1 = 10∠−80°  → FRENTE", color=TEAL, fontsize=9)
    arrow(ax, (0, 0), (math.cos(math.radians(100)), math.sin(math.radians(100))), color=ORANGE, lw=2.4)
    ax.text(-1.3, 1.02, "I1 = 10∠100°  → REVERSO", color=ORANGE, fontsize=9)
    ax.text(0.45, -0.55, "FRENTE", color=TEAL, weight="bold", rotation=-35), ax.text(-0.85, 0.5, "REVERSO", color=ORANGE, weight="bold", rotation=-35)
    ax.text(1.05, 0.28, "limite: perpendicular\nà linha de torque\nmáximo (Z1ANG = 80°)", color=GRAY, fontsize=8)
    ax.set_xlim(-1.45, 1.6), ax.set_ylim(-1.3, 1.3), ax.axis("off")
    ax.set_title("Fase (seq. positiva): o semiplano de FRENTE em torno de −Z1ANG", fontsize=10)
    save(fig, "67-seq-positiva")


def fig_67_niveis() -> None:
    fig, ax = plt.subplots(figsize=(9.6, 4.4))
    ax.set_xlim(0, 10.2), ax.set_ylim(0, 4.6), ax.axis("off")
    box(ax, 0.1, 3.3, 2.5, 1.1, "elementos\ndirecionais\n(Q, V, S, U, P, PHI, fase)", fc="#bee3f8")
    arrow(ax, (2.6, 3.85), (3.4, 3.85))
    box(ax, 3.4, 3.3, 2.6, 1.1, "bits de sentido\nDIRPF/PR · DIRQF/QR\nDIRNF/NR · DIRGF/GR", fc="#c6f6d5")
    arrow(ax, (6.0, 3.85), (6.8, 3.85))
    box(ax, 6.8, 3.3, 3.2, 1.1, "xnDIR = (DIRn = N)\nOU (DIRn = F E frente)\nOU (DIRn = R E reverso)", fc="#fefcbf")
    box(ax, 6.8, 1.75, 3.2, 0.85, "ajustes DIR1 … DIR4\n(F / R / N por nível)", fc=LIGHT)
    arrow(ax, (8.4, 2.6), (8.4, 3.3))
    arrow(ax, (8.4, 1.75), (8.4, 1.05), color=RED)
    box(ax, 5.2, 0.15, 4.8, 0.9, "50xn e 51x:  controle de torque E xnDIR\nxnDIR = 0  ⇒  elemento desabilitado", fc="#fed7d7")
    ax.text(0.1, 2.25, "Nível 1  ⇒ P1DIR, N1DIR, G1DIR, Q1DIR\n(todos os 51 usam o nível 1)\nNível n  ⇒ 50Pn, 50Nn, 50Gn, 50Qn", fontsize=9, color=GRAY, va="center")
    ax.text(0.1, 0.55, "VNOM = OFF ou EDIR = N  ⇒  xnDIR = 1\n(sem controle direcional)", fontsize=9, color=GRAY, va="center")
    save(fig, "67-niveis")


def fig_67_order() -> None:
    fig, ax = plt.subplots(figsize=(8.6, 3.5))
    ax.set_xlim(0, 11.6), ax.set_ylim(0, 3.8), ax.axis("off")
    steps = [("Q habilitado?\n(DIRQGE)", 0.2, "usa Q"), ("V habilitado?\n(DIRVE)", 3.3, "usa V"), ("S habilitado?\n(DIRNE)", 6.4, "usa S")]
    for k, (txt, x, res) in enumerate(steps):
        box(ax, x, 1.7, 2.3, 1.0, txt, fc="#bee3f8")
        arrow(ax, (x + 1.15, 1.7), (x + 1.15, 0.95), color=TEAL)
        ax.text(x + 1.3, 1.25, "sim", color=TEAL, fontsize=9), box(ax, x + 0.2, 0.2, 1.9, 0.75, res, fc="#c6f6d5")
        if k < 2:
            arrow(ax, (x + 2.3, 2.2), (x + 3.3, 2.2), color=RED), ax.text(x + 2.55, 2.35, "não", color=RED, fontsize=9)
    arrow(ax, (8.7, 2.2), (10.0, 2.2), color=RED), ax.text(9.1, 2.35, "não", color=RED, fontsize=9)
    ax.text(10.7, 1.55, "terra sem\ndireção\n(bloqueia)", fontsize=8.5, color=GRAY, ha="center")
    ax.text(5.6, 3.4, "Exemplo ORDER = QVS: a ordem das letras é a prioridade", ha="center", weight="bold")
    save(fig, "67-order-melhor-escolha")


def fig_67_phi() -> None:
    fig, axs = plt.subplots(1, 2, figsize=(9, 4.4), subplot_kw=dict(aspect="equal"))
    for ax, title, fwd, rev, mta_f, mta_r in ((axs[0], "cos φ  (bobina de Petersen)", (95, 265), (275, 85), 180, 0),
                                               (axs[1], "sen φ  (sistema isolado)", (185, 355), (5, 175), 270, 90)):
        ax.add_patch(Wedge((0, 0), 1, fwd[0], fwd[1], fc=TEAL, alpha=0.25, ec=TEAL))
        ax.add_patch(Wedge((0, 0), 1, rev[0], rev[1] if rev[1] > rev[0] else rev[1] + 360, fc=ORANGE, alpha=0.25, ec=ORANGE))
        arrow(ax, (0, 0), (1.15, 0), color=BLUE, lw=2.4), ax.text(1.17, -0.02, "3V0\n(ref.)", color=BLUE, fontsize=9, va="center")
        for ang, col in ((mta_f, TEAL), (mta_r, ORANGE)):
            ax.plot([0, math.cos(math.radians(ang))], [0, math.sin(math.radians(ang))], color=col, ls="--", lw=1.4)
        cos = title.startswith("cos")
        ax.text(-0.55 if cos else 0.0, 0.5 if cos else -0.55, "FRENTE", color=TEAL, weight="bold", ha="center")
        ax.text(0.5 if cos else 0.0, -0.5 if cos else 0.55, "REVERSO", color=ORANGE, weight="bold", ha="center")
        ax.set_xlim(-1.3, 1.6), ax.set_ylim(-1.2, 1.2), ax.axis("off"), ax.set_title(title, fontsize=10)
    fig.suptitle("Elemento PHI: setores definidos pelo usuário (exemplo com 5° de folga) – φ = ∠IN − ∠3V0", fontsize=10.5)
    save(fig, "67-phi-setores")


def fig_67_watimetrico() -> None:
    fig, ax = plt.subplots(figsize=(8, 2.8))
    s = 1.5
    fwd = -(0.9375 * 0.5 + 0.0625 * s)
    rev = 0.9375 * 0.5 + 0.0625 * s
    ax.axvspan(-3, fwd, color=TEAL, alpha=0.18), ax.axvspan(fwd, rev, color=LIGHT, alpha=0.7), ax.axvspan(rev, 3, color=ORANGE, alpha=0.18)
    for x in (fwd, rev):
        ax.axvline(x, color=GRAY, ls="--")
    ax.plot([-1.5], [0.5], "o", color=TEAL, ms=9), ax.text(-1.5, 0.75, "P0 = −1,5 W\n(à frente)", ha="center", fontsize=9, color=TEAL)
    ax.text(fwd - 0.05, 1.1, f"{fwd:.3f} W", ha="right", fontsize=9), ax.text(rev + 0.05, 1.1, f"+{rev:.3f} W", fontsize=9)
    ax.text(-2.9, 0.1, "FRENTE", color=TEAL, weight="bold"), ax.text(2.9, 0.1, "REVERSO", color=ORANGE, weight="bold", ha="right")
    ax.text(0, 0.1, "zona morta", ha="center", color=GRAY, fontsize=9)
    ax.set_xlim(-3, 3), ax.set_ylim(0, 1.5), ax.set_yticks([]), ax.grid(False), ax.spines["left"].set_visible(False)
    ax.set_xlabel("P0 = Re(3V0·IN*)  em watts secundários   –   DIRWFP = DIRWRP = 0,5 W,  |3V0·IN| = 1,5 W")
    ax.set_title("Elemento wattmétrico (Petersen): sinal da potência ativa residual", fontsize=10)
    save(fig, "67-wattmetrico")


def fig_67_simulacao() -> None:
    """Executa o motor do DigitalRelay: carga → falta à frente → falta atrás → falta à frente."""
    sys.path.insert(0, str(ROOT / "backend" / "tests"))
    from test_directional import make, run, three_phase  # noqa: E402

    eng = make(DIR1="F", **{"50P1P": "3.0", "50P1D": "0.05"})
    segs = [(0.0, 0.2, None), (0.2, 0.6, True), (0.6, 1.0, False), (1.0, 1.4, True)]
    names = ["50P1P", "FDIRP", "RDIRP", "P1DIR", "50P1T"]
    series = {n: [] for n in names}
    ts, cur = [], []
    dt = 0.004
    t = 0.0
    for t0, t1, fwd in segs:
        if fwd is None:
            eng.set_sim({"analog_on": True, "ia_mag": 200.0, "ib_mag": 200.0, "ic_mag": 200.0, "ia_ang": -20.0, "ib_ang": -140.0, "ic_ang": 100.0})
        else:
            three_phase(eng, forward=fwd)
        while t < t1 - 1e-9:
            eng.step(dt)
            t += dt
            ts.append(t)
            for n in names:
                series[n].append(eng.vals[n])
            cur.append(max(abs(eng.sec_I[p]) for p in "ABC"))
    ts = np.array(ts)
    fig, axs = plt.subplots(6, 1, figsize=(8, 7), sharex=True, gridspec_kw=dict(height_ratios=[1.6, 1, 1, 1, 1, 1]))
    axs[0].plot(ts, cur, color=GRAY, lw=2), axs[0].axhline(3, color=RED, ls="--", lw=1), axs[0].set_ylabel("|I| (A sec.)")
    axs[0].text(1.4, 3.6, "pickup 3 A", color=RED, ha="right", fontsize=8.5)
    axs[0].set_title("Motor do DigitalRelay: 50P1 com DIR1 = F (carga → falta à frente → atrás → à frente)", fontsize=9.5)
    for ax, n, col in zip(axs[1:], ["FDIRP", "RDIRP", "P1DIR", "50P1P", "50P1T"], (TEAL, ORANGE, BLUE, RED, RED)):
        ax.fill_between(ts, 0, np.array(series[n]), step="mid", color=col, alpha=0.5), ax.set_ylabel(n, rotation=0, ha="right", va="center"), ax.set_yticks([0, 1])
        ax.grid(False)
    for x0, x1, lab, col in ((0.2, 0.6, "falta à frente", TEAL), (0.6, 1.0, "falta atrás", ORANGE), (1.0, 1.4, "falta à frente", TEAL)):
        for ax in axs:
            ax.axvspan(x0, x1, color=col, alpha=0.06)
        axs[0].text((x0 + x1) / 2, 21, lab, ha="center", color=col, weight="bold", fontsize=9)
    axs[0].text(0.1, 4.3, "carga\n(sem decisão de sentido:\ncorrente < 50PDIRP)", ha="center", fontsize=8, color=GRAY)
    axs[0].set_ylim(0, 24), axs[-1].set_xlabel("tempo (s)")
    save(fig, "67-simulacao")


if __name__ == "__main__":
    for f in (fig_conceito_50_51, fig_familias, fig_td, fig_coordenacao, fig_disco, fig_tempo_definido, fig_cadeia,
              fig_67_conceito, fig_67_fasores_q, fig_67_z2, fig_67_seq_positiva, fig_67_niveis, fig_67_order,
              fig_67_phi, fig_67_watimetrico, fig_67_simulacao):
        f()
