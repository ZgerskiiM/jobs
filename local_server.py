#!/usr/bin/env python3
"""Local landing server with a guarded background vacancy refresh endpoint."""

from __future__ import annotations

import argparse
import json
import subprocess
import threading
import webbrowser
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


PROJECT_DIR = Path(__file__).resolve().parent
SITE_DIR = PROJECT_DIR / "site"
RUNNER = PROJECT_DIR / "run-direct.ps1"
STATE_LOCK = threading.Lock()
STATE: dict[str, Any] = {
    "running": False,
    "started_at": None,
    "finished_at": None,
    "success": None,
    "message": "Готово к обновлению",
}


def timestamp() -> str:
    return datetime.now().astimezone().replace(microsecond=0).isoformat()


def public_state() -> dict[str, Any]:
    with STATE_LOCK:
        return dict(STATE)


def refresh_vacancies() -> None:
    with STATE_LOCK:
        STATE.update({
            "running": True,
            "started_at": timestamp(),
            "finished_at": None,
            "success": None,
            "message": "Обходим карьерные сайты…",
        })
    try:
        completed = subprocess.run(
            [
                "powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass",
                "-File", str(RUNNER),
            ],
            cwd=PROJECT_DIR,
            capture_output=True,
            text=True,
            errors="replace",
            check=False,
        )
        success = completed.returncode == 0
        message = (
            "Вакансии обновлены. Перезагружаем страницу…"
            if success else
            "Не все источники обновились. Подробности смотрите в окне сервера."
        )
        if completed.stdout.strip():
            print(completed.stdout, flush=True)
        if completed.stderr.strip():
            print(completed.stderr, flush=True)
        with STATE_LOCK:
            STATE.update({
                "running": False,
                "finished_at": timestamp(),
                "success": success,
                "message": message,
            })
    except Exception as exc:
        print(f"Ошибка обновления: {exc}", flush=True)
        with STATE_LOCK:
            STATE.update({
                "running": False,
                "finished_at": timestamp(),
                "success": False,
                "message": "Обновление не запустилось. Подробности смотрите в окне сервера.",
            })


class LandingHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(SITE_DIR), **kwargs)

    def end_headers(self) -> None:
        if self.path.startswith("/api/") or self.path.endswith((".js", ".html")):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path.split("?", 1)[0] == "/api/update/status":
            self.send_json(200, public_state())
            return
        super().do_GET()

    def do_POST(self) -> None:
        if self.path.split("?", 1)[0] != "/api/update":
            self.send_json(404, {"message": "Маршрут не найден"})
            return
        if self.headers.get("X-Requested-With") != "vacancy-update":
            self.send_json(403, {"message": "Запрос отклонён"})
            return
        with STATE_LOCK:
            if STATE["running"]:
                self.send_json(202, dict(STATE))
                return
            STATE["running"] = True
            STATE["message"] = "Запускаем обновление…"
            state = dict(STATE)
        threading.Thread(target=refresh_vacancies, daemon=True).start()
        self.send_json(202, state)

    def log_message(self, format: str, *args: Any) -> None:
        if not self.path.startswith("/api/update/status"):
            super().log_message(format, *args)


def main() -> None:
    parser = argparse.ArgumentParser(description="Локальный сервер лендинга вакансий")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--open", action="store_true", dest="open_browser")
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), LandingHandler)
    url = f"http://{args.host}:{args.port}/"
    print(f"Лендинг запущен: {url}", flush=True)
    print("Для остановки нажмите Ctrl+C.", flush=True)
    if args.open_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nСервер остановлен.", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

