"""Eclipse – inicializador local.

Sobe o servidor (API + interface) em 127.0.0.1, abre o navegador e mostra uma pequena janela para abrir de novo ou encerrar.
É o ponto de entrada do executável (PyInstaller, ``--noconsole``), mas também roda direto: ``python launcher.py``.

- A porta preferida é a 8000 (o navegador guarda diagramas e configurações por origem, então manter a porta evita "perder" os dados);
  se estiver ocupada por outro programa, usa a próxima livre até 8010. Se já houver um Eclipse rodando, abre o navegador nele e avisa
  que a janela de encerrar é a dessa instância (ou, se for o servidor do run.ps1, que ele deve ser fechado).
- Sem console não existe stdout/stderr: o registro vai para ``%LOCALAPPDATA%\\Eclipse\\eclipse.log``.
"""
from __future__ import annotations

import os
import socket
import sys
import threading
import time
import traceback
import urllib.request
import webbrowser
from pathlib import Path

FROZEN = bool(getattr(sys, "frozen", False))
BASE = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
if not FROZEN:
    sys.path.insert(0, str(BASE / "backend"))

LOG_DIR = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "Eclipse"
PORTS = range(8000, 8011)
HOST = "127.0.0.1"


def _log_file():
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        return open(LOG_DIR / "eclipse.log", "a", encoding="utf-8", buffering=1)
    except OSError:
        return None


def _fix_streams() -> None:
    """Sem console (--noconsole) stdout/stderr são None: redireciona para o arquivo de registro."""
    if sys.stdout is None or sys.stderr is None:
        f = _log_file() or open(os.devnull, "w")
        sys.stdout = sys.stdout or f
        sys.stderr = sys.stderr or f


def _is_eclipse(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://{HOST}:{port}/api/sessions", timeout=1.5) as r:
            return r.status == 200 and r.read(1) == b"["
    except Exception:
        return False


def _port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind((HOST, port))
            return True
        except OSError:
            return False


def _message(title: str, text: str, error: bool = False) -> None:
    try:
        import tkinter
        from tkinter import messagebox

        root = tkinter.Tk()
        root.withdraw()
        (messagebox.showerror if error else messagebox.showinfo)(title, text)
        root.destroy()
    except Exception:
        print(f"{title}: {text}")


def _window(url: str, stop) -> None:
    """Janela de controle (ícone do Eclipse na barra de tarefas): abrir no navegador ou encerrar."""
    import tkinter as tk
    from tkinter import messagebox

    try:                                                   # nítida em telas com escala > 100 %
        import ctypes
        ctypes.windll.shcore.SetProcessDpiAwareness(1)
    except Exception:
        pass
    bg, fg, accent = "#1A202C", "#E2E8F0", "#63B3ED"
    root = tk.Tk()
    root.title("Eclipse")
    root.configure(bg=bg)
    root.resizable(False, False)
    ico = BASE / "assets" / "eclipse.ico"
    if ico.is_file():
        try:
            root.iconbitmap(default=str(ico))
        except Exception:
            pass
    tk.Label(root, text="Eclipse em execução", bg=bg, fg=fg, font=("Segoe UI", 13, "bold")).pack(padx=28, pady=(18, 2))
    link = tk.Label(root, text=url, bg=bg, fg=accent, font=("Segoe UI", 10, "underline"), cursor="hand2")
    link.pack(padx=28)
    link.bind("<Button-1>", lambda _e: webbrowser.open(url))
    tk.Label(root, text="Feche esta janela para encerrar o simulador.", bg=bg, fg="#A0AEC0", font=("Segoe UI", 9)).pack(padx=28, pady=(8, 10))
    row = tk.Frame(root, bg=bg)
    row.pack(pady=(0, 16))

    def quit_app() -> None:
        if messagebox.askokcancel("Encerrar o Eclipse", "Encerrar o simulador? As sessões abertas (relés carregados) serão perdidas.", parent=root):
            stop()
            root.destroy()

    tk.Button(row, text="Abrir no navegador", command=lambda: webbrowser.open(url), width=18).pack(side="left", padx=6)
    tk.Button(row, text="Encerrar", command=quit_app, width=12).pack(side="left", padx=6)
    root.protocol("WM_DELETE_WINDOW", quit_app)
    root.mainloop()


def main() -> int:
    _fix_streams()
    import uvicorn

    port = None
    for p in PORTS:
        if _is_eclipse(p):                                  # já está rodando: abre o navegador e avisa (a janela é da outra instância)
            webbrowser.open(f"http://{HOST}:{p}")
            _message("Eclipse", f"O Eclipse já está em execução em http://{HOST}:{p} (outra janela do Eclipse ou um servidor "
                     "iniciado pelo run.ps1/uvicorn). O navegador foi aberto nele.\n\nPara encerrar, use a janela \"Eclipse em execução\" "
                     "dessa instância ou feche o servidor que está usando a porta.")
            return 0
        if _port_free(p):
            port = p
            break
    if port is None:
        _message("Eclipse", f"Nenhuma porta livre entre {PORTS.start} e {PORTS.stop - 1}. Feche o programa que as usa e tente de novo.", error=True)
        return 1

    from app.main import app                                # importado depois de ajustar sys.path / streams

    cfg = uvicorn.Config(app, host=HOST, port=port, log_config=None, access_log=False, http="h11", ws="none", loop="asyncio")
    server = uvicorn.Server(cfg)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    t0 = time.time()
    while not server.started and thread.is_alive() and time.time() - t0 < 30:
        time.sleep(0.1)
    if not server.started:
        _message("Eclipse", "O servidor não iniciou. Veja o registro em " + str(LOG_DIR / "eclipse.log"), error=True)
        return 1
    url = f"http://{HOST}:{port}"
    webbrowser.open(url)

    def stop() -> None:
        server.should_exit = True
        thread.join(timeout=5)

    try:
        _window(url, stop)
    except Exception:                                       # sem Tk: mantém o servidor até a thread terminar
        traceback.print_exc()
        thread.join()
    stop()
    return 0


if __name__ == "__main__":
    try:
        code = main()
    except Exception:
        _fix_streams()
        traceback.print_exc()
        _message("Eclipse", "Erro ao iniciar. Detalhes em " + str(LOG_DIR / "eclipse.log"), error=True)
        code = 1
    os._exit(code)                                          # encerra threads do servidor sem esperar
