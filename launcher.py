"""Eclipse – inicializador local.

Sobe o servidor (API + interface) em 127.0.0.1, abre o navegador e mostra uma pequena janela para abrir de novo ou encerrar.
É o ponto de entrada do executável (PyInstaller, ``--noconsole``), mas também roda direto: ``python launcher.py``.

- A porta preferida é a 8000 (o navegador guarda diagramas e configurações por origem, então manter a porta evita "perder" os dados);
  se estiver ocupada por outro programa, usa a próxima livre até 8010. Se já houver um Eclipse rodando (outra janela ou o servidor
  do run.ps1), abre o navegador nele e mostra a mesma janela de controle: "Encerrar" pede a esse servidor que feche (``POST /api/shutdown``).
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


def _is_eclipse(port: int, timeout: float = 1.5) -> bool:
    try:
        with urllib.request.urlopen(f"http://{HOST}:{port}/api/sessions", timeout=timeout) as r:
            return r.status == 200 and r.read(1) == b"["
    except Exception:
        return False


def _request_shutdown(port: int) -> bool:
    """Pede ao Eclipse da porta que encerre (servidor de outra janela ou do run.ps1)."""
    req = urllib.request.Request(f"http://{HOST}:{port}/api/shutdown", data=b"", method="POST", headers={"X-Eclipse-Launcher": "1"})
    try:
        with urllib.request.urlopen(req, timeout=3) as r:
            return r.status == 200
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


def _window(url: str, stop, alive, note: str | None = None) -> None:
    """Janela de controle (ícone do Eclipse na barra de tarefas): abrir no navegador ou encerrar.
    `alive()` falso (servidor encerrado por outra janela) fecha a janela sozinha; `note` = linha extra (ex.: servidor já aberto)."""
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
    if note:
        tk.Label(root, text=note, bg=bg, fg="#A0AEC0", font=("Segoe UI", 9), justify="center").pack(padx=28, pady=(8, 0))
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

    def watch() -> None:                                   # servidor encerrado por fora: fecha a janela
        if not alive():
            root.destroy()
            return
        root.after(1500, watch)

    root.after(1500, watch)
    root.mainloop()


def main() -> int:
    _fix_streams()
    import uvicorn

    port = None
    for p in PORTS:
        if _is_eclipse(p):                                  # já está rodando: abre o navegador e controla esse servidor
            url = f"http://{HOST}:{p}"
            webbrowser.open(url)
            _window(url, lambda: _request_shutdown(p), lambda: _is_eclipse(p, timeout=0.8),
                    note="Servidor já estava aberto (outra janela do Eclipse ou run.ps1).")
            return 0
        if _port_free(p):
            port = p
            break
    if port is None:
        _message("Eclipse", f"Nenhuma porta livre entre {PORTS.start} e {PORTS.stop - 1}. Feche o programa que as usa e tente de novo.", error=True)
        return 1

    from app import main as api                             # importado depois de ajustar sys.path / streams
    app = api.app

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

    api.shutdown_hook = lambda: setattr(server, "should_exit", True)   # "Encerrar" de outra janela (POST /api/shutdown)
    try:
        _window(url, stop, thread.is_alive)
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
