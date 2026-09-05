#!/usr/bin/env python3
"""Local landing server with a guarded background vacancy refresh endpoint."""

from __future__ import annotations

import argparse
import cgi
import io
import json
import re
import subprocess
import threading
import webbrowser
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any



PROJECT_DIR = Path(__file__).resolve().parent
FRONTEND_DIST_DIR = PROJECT_DIR / "frontend" / "dist"
SITE_DIR = FRONTEND_DIST_DIR if FRONTEND_DIST_DIR.is_dir() else PROJECT_DIR / "site"
RUNNER = PROJECT_DIR / "run-direct.ps1"
VACANCIES_FILE = PROJECT_DIR / "data" / "vacancies.js"
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


def vacancy_payload() -> dict[str, Any]:
    """Return the tracker export as JSON for the React frontend."""
    source = VACANCIES_FILE.read_text(encoding="utf-8")
    meta_match = re.search(r"window\.VACANCIES_META\s*=\s*(\{.*?\});", source, re.DOTALL)
    vacancies_match = re.search(r"window\.VACANCIES\s*=\s*(\[.*\])\s*;\s*$", source, re.DOTALL)
    if not meta_match or not vacancies_match:
        raise ValueError("Файл vacancies.js имеет неизвестный формат")
    return {
        "meta": json.loads(meta_match.group(1)),
        "vacancies": json.loads(vacancies_match.group(1)),
    }


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
        clean_path = self.path.split("?", 1)[0]
        if clean_path.startswith("/api/") or clean_path.endswith((".js", ".css", ".html")):
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
        route = self.path.split("?", 1)[0]
        if route == "/api/update/status":
            self.send_json(200, public_state())
            return
        if route == "/api/vacancies":
            try:
                self.send_json(200, vacancy_payload())
            except (OSError, ValueError, json.JSONDecodeError) as exc:
                self.send_json(500, {"message": f"Не удалось прочитать вакансии: {exc}"})
            return
        super().do_GET()

    def do_POST(self) -> None:
        route = self.path.split("?", 1)[0]
        if route == "/api/resume/extract":
            self.extract_resume()
            return
        if route != "/api/update":
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

    def extract_resume(self) -> None:
        if self.headers.get("X-Requested-With") != "resume-analyzer":
            self.send_json(403, {"message": "Запрос отклонён"})
            return
        content_length = int(self.headers.get("Content-Length", "0") or 0)
        if content_length > 8 * 1024 * 1024:
            self.send_json(413, {"message": "Файл больше 8 МБ"})
            return
        form = cgi.FieldStorage(
            fp=self.rfile, headers=self.headers,
            environ={"REQUEST_METHOD": "POST", "CONTENT_TYPE": self.headers.get("Content-Type", "")},
        )
        upload = form["resume"] if "resume" in form else None
        if upload is None or not getattr(upload, "file", None):
            self.send_json(400, {"message": "Файл не получен"})
            return
        filename = Path(upload.filename or "resume.txt").name
        data = upload.file.read()
        suffix = Path(filename).suffix.casefold()
        try:
            if suffix == ".pdf":
                from pypdf import PdfReader
                text = "\n".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(data)).pages)
            elif suffix == ".docx":
                from docx import Document
                document = Document(io.BytesIO(data))
                text = "\n".join(paragraph.text for paragraph in document.paragraphs)
            elif suffix in {".txt", ".md", ".html", ".htm", ".json"}:
                text = data.decode("utf-8-sig", errors="replace")
            else:
                self.send_json(415, {"message": "Поддерживаются PDF, DOCX, TXT и MD"})
                return
        except Exception as exc:
            print(f"Ошибка чтения резюме {filename}: {exc}", flush=True)
            self.send_json(422, {"message": "Не удалось прочитать файл. Попробуйте вставить текст резюме."})
            return
        text = "\n".join(line.strip() for line in text.splitlines() if line.strip())
        if len(text) < 30:
            self.send_json(422, {"message": "В файле почти нет распознаваемого текста"})
            return
        self.send_json(200, {"filename": filename, "text": text[:200000]})

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
