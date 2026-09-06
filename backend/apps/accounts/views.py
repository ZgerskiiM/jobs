from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from html import unescape
import json as jsonlib
import hashlib
import mimetypes
import re
import secrets
import sqlite3
import subprocess
import uuid
import urllib.parse
import urllib.request

from django.conf import settings
from django.contrib.auth import authenticate, logout
from django.core.files.base import ContentFile
from django.db import transaction
from django.http import FileResponse, Http404, HttpResponseRedirect
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect, csrf_exempt
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Application, AuditLog, Profile, Resume, User, VacancySnapshot
from .resume_parser import analyze_resume
from .serializers import EmailAuthSerializer, ProfilePatchSerializer, SavedJobSerializer
from .services import account_payload, get_active_resume_record, get_profile, get_resume_records, infer_target_role, login_from_telegram, normalize_resume_scoring_profile, resume_payload, telegram_payload_is_valid


def error(message: str, code: int = status.HTTP_400_BAD_REQUEST) -> Response:
    return Response({"message": message}, status=code)


class AuthConfigView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        return Response({"enabled": bool(settings.TELEGRAM_BOT_TOKEN and settings.TELEGRAM_BOT_USERNAME), "username": settings.TELEGRAM_BOT_USERNAME})


class HhVacanciesView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        try:
            query = {
                "text": str(request.query_params.get("text", "разработчик"))[:120],
                "area": str(request.query_params.get("area", "1"))[:8],
                "page": min(4, max(0, int(request.query_params.get("page", 0)))),
                "per_page": min(100, max(1, int(request.query_params.get("per_page", 100)))),
                "order_by": request.query_params.get("order_by", "publication_time"),
            }
            headers = {"Accept": "application/json", "HH-User-Agent": settings.HH_USER_AGENT, "User-Agent": settings.HH_USER_AGENT}
            if settings.HH_API_TOKEN:
                headers["Authorization"] = f"Bearer {settings.HH_API_TOKEN}"
            upstream = urllib.request.Request(f"https://api.hh.ru/vacancies?{urllib.parse.urlencode(query)}", headers=headers)
            with urllib.request.urlopen(upstream, timeout=15) as response:
                payload = jsonlib.loads(response.read().decode("utf-8"))
        except Exception as exc:
            return error(f"Не удалось получить вакансии HH.ru: {exc}", 502)

        def clean(value):
            return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", str(value or "")))).strip()

        def mapped(item):
            snippet = item.get("snippet") or {}
            text = " ".join([str(item.get("name", "")), str(snippet.get("requirement", "")), str(snippet.get("responsibility", ""))]).lower()
            known = ["Java", "Python", "Go", "Rust", "Kotlin", "C++", "C#", "JavaScript", "TypeScript", "React", "Vue", "Node.js", "PostgreSQL", "Redis", "Kafka", "Docker", "Kubernetes", "Terraform", "SQL", "Linux", "Golang"]
            return {
                "id": item.get("id"), "company": (item.get("employer") or {}).get("name") or "Работодатель на HH.ru", "title": item.get("name", ""),
                "location": (item.get("area") or {}).get("name") or ((item.get("address") or {}).get("city") or "Россия"),
                "workplace_type": " · ".join(filter(None, [(item.get("schedule") or {}).get("name"), (item.get("employment") or {}).get("name")])),
                "description": " ".join(filter(None, [clean(snippet.get("requirement")), clean(snippet.get("responsibility"))])) or "Описание вакансии доступно на HH.ru.",
                "url": item.get("alternate_url") or f"https://hh.ru/vacancy/{item.get('id')}", "posted_at": item.get("published_at"), "source_key": "hh",
                "technologies": [name for name in known if name.lower() in text],
            }

        return Response({"source": "hh", "vacancies": [mapped(item) for item in payload.get("items", [])], "meta": {"found": payload.get("found", 0), "page": payload.get("page", 0), "pages": payload.get("pages", 0), "updated_at": timezone.now().isoformat()}})


class TelegramSubscribersView(APIView):
    """Service endpoint consumed by the nightly vacancy notifier."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        expected = str(getattr(settings, "TELEGRAM_SYNC_TOKEN", ""))
        supplied = request.headers.get("Authorization", "")
        supplied = supplied[7:] if supplied.lower().startswith("bearer ") else ""
        if not expected or not secrets.compare_digest(supplied, expected):
            return error("Недействительный токен синхронизации", status.HTTP_403_FORBIDDEN)
        subscribers = []
        for user in User.objects.filter(is_active=True).exclude(telegram_id__isnull=True).select_related("profile"):
            profile = get_profile(user)
            notification = (profile.settings or {}).get("notifications") or {}
            if not notification.get("telegramEnabled") or not notification.get("newJobs"):
                continue
            onboarding = profile.onboarding if isinstance(profile.onboarding, dict) else {}
            subscribers.append({
                "chatId": user.telegram_id,
                "filter": {
                    "keywords": notification.get("telegramKeywords") or [],
                    "companies": notification.get("telegramCompanies") or [],
                    "locations": notification.get("telegramLocations") or [],
                    "technologies": notification.get("telegramTechnologies") or [],
                    "roles": onboarding.get("roles") or [],
                    "levels": onboarding.get("levels") or [],
                    "formats": [value for value in (onboarding.get("formats") or []) if value != "any"],
                },
            })
        return Response({"subscribers": subscribers, "count": len(subscribers), "generatedAt": timezone.now().isoformat()})


class AdminStatsView(APIView):
    """Return operational counters for the jobs.dev admin dashboard."""

    @staticmethod
    def _refresh_report() -> dict[str, Any]:
        configured = Path(getattr(settings, "VACANCY_REFRESH_REPORT_PATH", ""))
        candidates = [configured, settings.BASE_DIR / "vacancy-refresh.json", settings.BASE_DIR / "catalog" / "vacancy-refresh.json"]
        for path in candidates:
            if not path or not path.is_file():
                continue
            try:
                payload = jsonlib.loads(path.read_text(encoding="utf-8"))
                if isinstance(payload, dict):
                    return payload
            except (OSError, jsonlib.JSONDecodeError):
                continue
        # Local installations may have the tracker SQLite database but not the
        # generated JSON artifact. Infer the latest pass from its per-source
        # runs so the dashboard remains useful before the next nightly build.
        db_path = Path(getattr(settings, "JOB_TRACKER_DB_PATH", ""))
        if db_path.is_file():
            try:
                with sqlite3.connect(db_path) as db:
                    db.row_factory = sqlite3.Row
                    latest_finished = db.execute("SELECT MAX(finished_at) FROM runs").fetchone()[0]
                    if latest_finished:
                        cutoff = datetime.fromisoformat(latest_finished) - timedelta(minutes=15)
                        rows = db.execute("""
                            SELECT r.*, COALESCE(NULLIF(r.company, ''), MAX(j.company), r.source_key) AS resolved_company
                            FROM runs r LEFT JOIN jobs j ON j.source_key = r.source_key
                            WHERE r.finished_at >= ? GROUP BY r.id ORDER BY r.status DESC, resolved_company COLLATE NOCASE
                        """, (cutoff.isoformat(),)).fetchall()
                        if rows:
                            source_rows = [dict(row) | {"company": row["resolved_company"]} for row in rows]
                            totals = {"succeeded_sources": sum(row["status"] == "ok" for row in rows), "failed_sources": sum(row["status"] != "ok" for row in rows), "total_sources": len(rows)}
                            for key in ("jobs_received", "jobs_accepted", "new_jobs", "updated_jobs", "reopened_jobs", "restored_jobs", "closed_jobs"):
                                totals[key] = sum(int(row[key] or 0) if key in row.keys() else 0 for row in rows)
                            started = min(row["started_at"] for row in rows)
                            synthetic = {"id": None, "started_at": started, "finished_at": latest_finished, "status": "error" if totals["failed_sources"] else "ok", **totals, "stale_jobs": 0}
                            return {"available": True, "message": "Показатели восстановлены из локальной базы проходов", "latest": synthetic, "sources": source_rows, "runs": [synthetic]}
            except (OSError, sqlite3.Error, ValueError):
                pass
        return {"available": False, "message": "Отчёт обновления недоступен", "runs": [], "sources": []}

    @staticmethod
    def _duration(started: str | None, finished: str | None) -> float | None:
        if not started or not finished:
            return None
        try:
            return round(max(0.0, (datetime.fromisoformat(finished) - datetime.fromisoformat(started)).total_seconds()), 1)
        except ValueError:
            return None

    def _operational_payload(self) -> dict[str, Any]:
        report = self._refresh_report()

        def run_payload(item: dict[str, Any]) -> dict[str, Any]:
            return {
                "runId": item.get("id"), "status": item.get("status"),
                "startedAt": item.get("started_at"), "finishedAt": item.get("finished_at"),
                "durationSeconds": self._duration(item.get("started_at"), item.get("finished_at")),
                "totalSources": item.get("total_sources", 0), "succeededSources": item.get("succeeded_sources", 0),
                "failedSources": item.get("failed_sources", 0), "jobsReceived": item.get("jobs_received", 0),
                "jobsAccepted": item.get("jobs_accepted", 0), "newJobs": item.get("new_jobs", 0),
                "updatedJobs": item.get("updated_jobs", 0), "reopenedJobs": item.get("reopened_jobs", 0),
                "restoredJobs": item.get("restored_jobs", 0), "closedJobs": item.get("closed_jobs", 0),
                "staleJobs": item.get("stale_jobs", 0),
            }

        latest = report.get("latest") if isinstance(report.get("latest"), dict) else None
        sources = []
        for item in report.get("sources", []) if isinstance(report.get("sources"), list) else []:
            if not isinstance(item, dict):
                continue
            sources.append({
                "sourceKey": item.get("source_key"), "company": item.get("company") or item.get("source_key"),
                "status": item.get("status"), "startedAt": item.get("started_at"), "finishedAt": item.get("finished_at"),
                "durationSeconds": self._duration(item.get("started_at"), item.get("finished_at")),
                "jobsReceived": item.get("jobs_received", 0), "jobsAccepted": item.get("jobs_accepted", 0),
                "newJobs": item.get("new_jobs", 0), "updatedJobs": item.get("updated_jobs", 0),
                "reopenedJobs": item.get("reopened_jobs", 0), "restoredJobs": item.get("restored_jobs", 0),
                "closedJobs": item.get("closed_jobs", 0), "error": item.get("error") or None,
            })
        return {
            "available": bool(report.get("available") and latest),
            "message": report.get("message"),
            "latest": run_payload(latest) if latest else None,
            "sources": sources,
            "history": [run_payload(item) for item in report.get("runs", []) if isinstance(item, dict)],
        }

    def get(self, request):
        if not request.user.is_authenticated or not (request.user.is_staff or request.user.role == User.Role.ADMIN):
            return error("Доступ только для администраторов", status.HTTP_403_FORBIDDEN)

        records = _catalog_records()
        keys = sorted({
            f"{item.get('source_key') or 'catalog'}:{item.get('id') or item.get('url') or index}"
            for index, item in enumerate(records)
        })
        fingerprint = hashlib.sha256(jsonlib.dumps(keys, ensure_ascii=False).encode("utf-8")).hexdigest()
        previous = VacancySnapshot.objects.first()
        previous_keys = set(previous.vacancy_keys if previous else [])
        current_keys = set(keys)
        added = len(current_keys - previous_keys) if previous else 0
        removed = len(previous_keys - current_keys) if previous else 0
        if previous is None or previous.fingerprint != fingerprint:
            VacancySnapshot.objects.create(fingerprint=fingerprint, vacancy_keys=keys, total=len(keys))

        now = timezone.localtime()
        current_timezone = timezone.get_current_timezone()
        registration_days = []
        for offset in range(13, -1, -1):
            day = (now - timedelta(days=offset)).date()
            start = timezone.make_aware(datetime.combine(day, datetime.min.time()), current_timezone)
            end = start + timedelta(days=1)
            registration_days.append({
                "date": day.isoformat(),
                "label": day.strftime("%d.%m"),
                "count": User.objects.filter(date_joined__gte=start, date_joined__lt=end).count(),
            })

        return Response({
            "vacancies": {"total": len(keys), "added": added, "removed": removed},
            "companies": {"total": len({str(item.get('company') or '').strip() for item in records if str(item.get('company') or '').strip()})},
            "users": {"total": User.objects.count(), "active": User.objects.filter(is_active=True).count(), "last7Days": User.objects.filter(date_joined__gte=now - timedelta(days=7)).count()},
            "resumes": Resume.objects.count(),
            "applications": Application.objects.count(),
            "savedVacancies": sum(len(profile.saved_job_ids or []) for profile in Profile.objects.all()),
            "registrationsByDay": registration_days,
            "snapshotAt": now.isoformat(),
            "refresh": self._operational_payload(),
        })


class ExtensionDownloadView(APIView):
    archives = {
        "firefox": ("jobs-dev-zen-extension.zip", "jobs-dev-zen-extension.zip"),
        "chrome": ("jobs-dev-zen-extension-chrome.zip", "jobs-dev-zen-extension-chrome.zip"),
    }

    def get(self, request, browser="firefox"):
        archive_name, download_name = self.archives.get(browser, self.archives["firefox"])
        # The Docker image stores the archives in /app (BASE_DIR), while local
        # development keeps them next to the backend directory.
        archive = settings.BASE_DIR / archive_name
        if not archive.is_file():
            archive = settings.BASE_DIR.parent / archive_name
        if not archive.is_file():
            raise Http404("Архив расширения не найден")
        return FileResponse(
            archive.open("rb"),
            as_attachment=True,
            filename=download_name,
            content_type="application/zip",
        )


class ResumeFileView(APIView):
    """Return the authenticated user's uploaded resume to the browser extension."""

    def get(self, request):
        records = get_resume_records(request.user)
        requested_id = str(request.query_params.get("id", ""))
        record = next((item for item in records if resume_payload(item).get("id") == requested_id), None) if requested_id else None
        record = record or next((item for item in records if item.is_active), records[0] if records else None)
        if not record or not record.file:
            raise Http404("Файл резюме не найден")
        filename = Path(record.file.name).name
        response = FileResponse(record.file.open("rb"), as_attachment=True, filename=filename, content_type=mimetypes.guess_type(filename)[0] or "application/octet-stream")
        return response


def _stable_job_id(source_key: str, external_id: str) -> int:
    # Keep this identical to VacancyDataContext.hash(), which is the public id
    # stored by the frontend application tracker.
    value = f"{source_key}:{external_id}"
    result = 0
    for char in value:
        result = ((result * 31) + ord(char)) & 0xFFFFFFFF
    result &= 0x7FFFFFFF
    return result or 1


def _catalog_records() -> list[dict[str, Any]]:
    """Read the generated catalog, with a SQLite fallback for local installs."""
    catalog_path = Path(getattr(settings, "VACANCY_CATALOG_PATH", ""))
    if catalog_path.is_file():
        try:
            payload = jsonlib.loads(catalog_path.read_text(encoding="utf-8"))
            return [item for item in payload.get("vacancies", []) if isinstance(item, dict)]
        except (OSError, ValueError):
            pass
    db_path = Path(getattr(settings, "JOB_TRACKER_DB_PATH", ""))
    if db_path.is_file():
        try:
            with sqlite3.connect(db_path) as db:
                rows = db.execute("SELECT external_id AS id, company, title, location, workplace_type, description, url, posted_at, source_key FROM jobs WHERE active = 1 AND stale = 0").fetchall()
            fields = ("id", "company", "title", "location", "workplace_type", "description", "url", "posted_at", "source_key")
            return [dict(zip(fields, row)) for row in rows]
        except sqlite3.Error:
            pass
    return []


def _canonical_url(value: str) -> str:
    try:
        parsed = urllib.parse.urlsplit(str(value).strip())
        return urllib.parse.urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), parsed.path.rstrip("/"), "", ""))
    except ValueError:
        return str(value).strip().rstrip("/").lower()


def _words(value: str) -> set[str]:
    return {word for word in re.findall(r"[a-zа-яё0-9+#.]{3,}", str(value or "").casefold()) if word not in {"the", "for", "and", "или", "для"}}


def _resolve_catalog_vacancy(page_url: str, title: str, company: str) -> tuple[dict[str, Any] | None, str]:
    page = _canonical_url(page_url)
    title_words = _words(title)
    best: tuple[float, dict[str, Any] | None] = (0.0, None)
    for item in _catalog_records():
        candidate_url = _canonical_url(str(item.get("url", "")))
        if page and candidate_url and page == candidate_url:
            return item, "url"
        candidate_words = _words(item.get("title", ""))
        title_score = len(title_words & candidate_words) / max(1, len(title_words | candidate_words))
        company_score = 1.0 if company and str(company).casefold() in str(item.get("company", "")).casefold() else 0.0
        host_score = 0.25 if page and candidate_url and urllib.parse.urlsplit(page).netloc == urllib.parse.urlsplit(candidate_url).netloc else 0.0
        score = title_score * 0.75 + company_score * 0.2 + host_score * 0.05
        if score > best[0]:
            best = (score, item)
    return (best[1], "title") if best[0] >= 0.62 else (None, "")


@method_decorator(csrf_exempt, name="dispatch")
class ExtensionApplicationView(APIView):
    """Record a submit observed by the extension and resolve it to the catalog."""

    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        origin = request.headers.get("Origin", "")
        if origin and not re.match(r"^(?:moz|chrome|safari)-extension://", origin, re.IGNORECASE):
            return error("Источник запроса не разрешён", status.HTTP_403_FORBIDDEN)
        user_id = request.session.get("_auth_user_id")
        if not user_id:
            return error("Войди в jobs.dev в этом браузере", status.HTTP_401_UNAUTHORIZED)
        try:
            user = User.objects.get(pk=user_id, is_active=True)
        except User.DoesNotExist:
            return error("Сессия jobs.dev истекла", status.HTTP_401_UNAUTHORIZED)
        data = request.data if isinstance(request.data, dict) else {}
        page_url = str(data.get("pageUrl", ""))[:2000]
        title = str(data.get("title", ""))[:300]
        company = str(data.get("company", ""))[:200]
        if not page_url:
            return error("Расширение не передало адрес вакансии")
        vacancy, match_kind = _resolve_catalog_vacancy(page_url, title, company)
        if not vacancy:
            return Response({"matched": False, "message": "Вакансия не найдена в каталоге — добавь отклик вручную", "pageUrl": page_url})
        source_key = str(vacancy.get("source_key") or "catalog")
        external_id = str(vacancy.get("id") or "")
        job_id = _stable_job_id(source_key, external_id)
        applied_at = timezone.localtime().strftime("%d.%m.%Y")
        payload = {
            "id": job_id,
            "title": vacancy.get("title") or title or "Вакансия",
            "company": vacancy.get("company") or company or "Работодатель",
            "logo": "",
            "color": "#33ff77",
            "salary": "По договорённости",
            "level": "Специалист",
            "location": vacancy.get("location") or "Не указано",
            "url": vacancy.get("url") or page_url,
            "appliedAt": applied_at,
            "status": "sent",
            "updatedDaysAgo": 0,
            "deadline": "",
            "note": "",
            "contact": "",
            "tags": vacancy.get("technologies") or [],
            "timeline": [{"date": applied_at, "label": "Отклик отправлен через расширение"}],
            "notificationsOn": True,
            "sourceKey": source_key,
            "externalId": external_id,
            "detectedBy": "extension",
            "submittedUrl": page_url,
        }
        application, _ = Application.objects.update_or_create(user=user, job_id=job_id, defaults={"payload": payload})
        AuditLog.objects.create(actor=user, action="application.detected_by_extension", object_type="application", object_id=str(application.pk), metadata={"match": match_kind, "url": page_url[:500]})
        return Response({"matched": True, "application": payload, "match": match_kind})


class MeView(APIView):
    def get(self, request):
        return Response(account_payload(request.user))


class EmailAuthView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = [SessionAuthentication]

    def post(self, request):
        serializer = EmailAuthSerializer(data=request.data)
        if not serializer.is_valid():
            return Response({"message": "Проверь email и пароль", "errors": serializer.errors}, status=400)
        email = serializer.validated_data["email"].casefold()
        password = serializer.validated_data["password"]
        mode = serializer.validated_data["mode"]
        if mode == "register":
            if User.objects.filter(email=email).exists():
                return error("Аккаунт с таким email уже существует", 409)
            user = User.objects.create_user(email=email, password=password, name=email.split("@", 1)[0])
            AuditLog.objects.create(actor=user, action="account.created", object_type="user", object_id=str(user.pk), metadata={"provider": "email"})
            is_new = True
        else:
            user = authenticate(request, username=email, password=password)
            if user is None:
                return error("Неверный email или пароль", 401)
            is_new = False
        get_profile(user)
        from django.contrib.auth import login

        login(request, user)
        return Response(account_payload(user, is_new=is_new))


class TelegramAuthView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def _claims(self, request) -> dict[str, str]:
        source = request.query_params if request.method == "GET" else request.data
        return {str(key): str(value) for key, value in source.items() if key != "csrfmiddlewaretoken"}

    def _authenticate(self, request):
        claims = self._claims(request)
        if not telegram_payload_is_valid(claims):
            return None, error("Telegram не подтвердил вход или подпись устарела", 401)
        user = login_from_telegram(claims, request)
        return user, None

    def get(self, request):
        user, response = self._authenticate(request)
        if response:
            return HttpResponseRedirect(f"{settings.FRONTEND_URL}/?auth_error=telegram")
        return HttpResponseRedirect(f"{settings.FRONTEND_URL}/profile")

    def post(self, request):
        user, response = self._authenticate(request)
        if response:
            return response
        return Response(account_payload(user, is_new=not user.last_login))


class LogoutView(APIView):
    def post(self, request):
        AuditLog.objects.create(actor=request.user, action="account.logout")
        logout(request)
        return Response({"ok": True})


class PasswordView(APIView):
    def post(self, request):
        current = str(request.data.get("current", ""))
        new = str(request.data.get("new", ""))
        if len(new) < 8:
            return error("Новый пароль — минимум 8 символов")
        try:
            from .models import User

            with transaction.atomic():
                user = User.objects.select_for_update().get(pk=request.user.pk)
                from django.contrib.auth import update_session_auth_hash

                if not user.check_password(current):
                    return error("Неверный текущий пароль", 400)
                user.set_password(new)
                user.save(update_fields=["password"])
                update_session_auth_hash(request, user)
                AuditLog.objects.create(actor=user, action="account.password_changed")
        except User.DoesNotExist:
            return error("Аккаунт не найден", 404)
        return Response({"ok": True})


class DeleteAccountView(APIView):
    def delete(self, request):
        user_id = request.user.pk
        AuditLog.objects.create(actor=request.user, action="account.deleted", object_type="user", object_id=str(user_id))
        request.user.delete()
        logout(request)
        return Response({"ok": True})


class ProfileView(APIView):
    def patch(self, request):
        serializer = ProfilePatchSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=400)
        profile = get_profile(request.user)
        changes = serializer.validated_data
        if "name" in changes:
            request.user.name = changes["name"].strip()
            request.user.save(update_fields=["name"])
        if "onboarding" in changes:
            profile.onboarding = changes["onboarding"]
        if "settings" in changes:
            profile.settings = changes["settings"]
        if "coverLetter" in changes:
            profile.cover_letter = changes["coverLetter"]
        profile.save()
        AuditLog.objects.create(actor=request.user, action="profile.updated", object_type="profile", object_id=str(profile.pk), metadata={"fields": list(changes)})
        return Response(account_payload(request.user))


class SavedJobsView(APIView):
    def post(self, request):
        serializer = SavedJobSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=400)
        profile = get_profile(request.user)
        job_id = serializer.validated_data["jobId"]
        ids = set(profile.saved_job_ids or [])
        if serializer.validated_data.get("saved", True):
            ids.add(job_id)
        else:
            ids.discard(job_id)
        notes = dict(profile.saved_job_notes or {})
        if "note" in serializer.validated_data:
            if serializer.validated_data["note"]:
                notes[str(job_id)] = serializer.validated_data["note"]
            else:
                notes.pop(str(job_id), None)
        profile.saved_job_ids = sorted(ids, reverse=True)
        profile.saved_job_notes = notes
        profile.save(update_fields=["saved_job_ids", "saved_job_notes", "updated_at"])
        return Response({"savedJobIds": profile.saved_job_ids, "savedJobNotes": profile.saved_job_notes})


class ResumeView(APIView):
    def patch(self, request):
        profile = get_profile(request.user)
        records = get_resume_records(request.user, profile)
        if not records:
            return error("Сначала загрузите резюме")
        requested_id = str(request.data.get("resumeId") or request.data.get("activeResumeId") or "")
        target = next((item for item in records if resume_payload(item).get("id") == requested_id), None) if requested_id else None
        target = target or next((item for item in records if item.is_active), records[0])
        if "activeResumeId" in request.data and target:
            for item in records:
                item.is_active = item.pk == target.pk
            Resume.objects.bulk_update(records, ["is_active"])
        changes = {}
        if "skills" in request.data:
            if not isinstance(request.data["skills"], list):
                return error("Некорректный список навыков")
            changes["skills"] = request.data["skills"]
        if "targetRole" in request.data:
            target_role = str(request.data["targetRole"])
            if target_role not in {"JAVA_BACKEND", "DEVOPS", "ONE_C_DEVELOPER", "UNKNOWN"}:
                return error("Неизвестный профиль сопоставления")
            changes["targetRole"] = target_role
        for field in ("fullName", "contactEmail", "contactPhone", "contactTelegram"):
            if field in request.data:
                changes[field] = str(request.data[field])[:250]
        if not changes and "activeResumeId" not in request.data:
            return error("Нет данных для обновления")
        if changes:
            target.data = {**(target.data if isinstance(target.data, dict) else {}), **changes}
            target.save(update_fields=["data", "updated_at"])
        payload = account_payload(request.user)
        return Response({"resume": payload["resume"], "resumes": payload["resumes"]})

    def post(self, request):
        upload = request.FILES.get("resume")
        if upload is None:
            return error("Файл резюме не получен")
        if upload.size > 8 * 1024 * 1024:
            return error("Файл больше 8 МБ", status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)
        data = upload.read()
        filename = Path(upload.name).name
        try:
            analysis = analyze_resume(data, filename)
        except ValueError as exc:
            return error(str(exc))
        now = timezone.localtime().strftime("%d %b %Y").lstrip("0")
        resume = {"id": f"upload-{uuid.uuid4().hex}", "source": "upload", "hasFile": True, "fileName": filename, "uploadedAt": now, **analysis}
        resume["targetRole"] = infer_target_role(resume)
        profile = get_profile(request.user)
        existing = get_resume_records(request.user, profile)
        for item in existing:
            if item.is_active:
                item.is_active = False
        if existing:
            Resume.objects.bulk_update(existing, ["is_active"])
        record = Resume.objects.create(user=request.user, data=resume, is_active=True)
        record.file.save(filename, ContentFile(data), save=True)
        payload = account_payload(request.user)
        return Response({"resume": payload["resume"], "resumes": payload["resumes"]})

    def delete(self, request):
        records = get_resume_records(request.user)
        requested_id = str(request.query_params.get("id") or request.data.get("resumeId") or "")
        target = next((item for item in records if resume_payload(item).get("id") == requested_id), None) if requested_id else None
        target = target or next((item for item in records if item.is_active), records[0] if records else None)
        if target:
            was_active = target.is_active
            if target.file:
                target.file.delete(save=False)
            target.delete()
            if was_active:
                next_record = Resume.objects.filter(user=request.user).order_by("created_at", "id").first()
                if next_record:
                    next_record.is_active = True
                    next_record.save(update_fields=["is_active", "updated_at"])
        payload = account_payload(request.user)
        return Response({"resume": payload["resume"], "resumes": payload["resumes"]})


class ScoringRankView(APIView):
    """Expose the same taxonomy-driven scorer used by the production Worker."""

    def post(self, request):
        items = request.data.get("items") if isinstance(request.data, dict) else None
        if not isinstance(items, list):
            return error("Ожидался список вакансий")
        profile = get_profile(request.user)
        active_record = get_active_resume_record(request.user, profile)
        resume = active_record.data if active_record and isinstance(active_record.data, dict) else {}
        resume, changed = normalize_resume_scoring_profile(resume)
        if changed:
            if active_record:
                active_record.data = resume
                active_record.save(update_fields=["data", "updated_at"])
        payload = {
            "account": {"resume": resume, "onboarding": profile.onboarding or {}},
            "items": items,
            "compact": bool(request.data.get("compact")),
        }
        bridge_candidates = (
            settings.BASE_DIR / "frontend" / "scripts" / "scoring-api.mjs",
            settings.BASE_DIR.parent / "frontend" / "scripts" / "scoring-api.mjs",
        )
        bridge = next((candidate for candidate in bridge_candidates if candidate.is_file()), None)
        if bridge is None:
            return error("Модуль расчёта релевантности не установлен", 503)
        project_root = bridge.parents[2]
        try:
            completed = subprocess.run(
                ["node", str(bridge)], input=jsonlib.dumps(payload), text=True,
                encoding="utf-8", capture_output=True, timeout=60,
                cwd=project_root, check=True,
            )
            return Response(jsonlib.loads(completed.stdout))
        except (OSError, subprocess.SubprocessError, jsonlib.JSONDecodeError) as exc:
            return error(f"Не удалось рассчитать соответствие: {exc}", 502)


class ApplicationsView(APIView):
    def get(self, request):
        return Response({"applications": [application.payload for application in request.user.applications.all()]})

    def post(self, request):
        payload = request.data
        if not isinstance(payload, dict) or not payload.get("id"):
            return error("В отклике не указан id вакансии")
        job_id = int(payload["id"])
        application, _ = Application.objects.update_or_create(user=request.user, job_id=job_id, defaults={"payload": payload})
        return Response(application.payload, status=status.HTTP_201_CREATED)


class ApplicationView(APIView):
    def patch(self, request, job_id: int):
        try:
            application = Application.objects.get(user=request.user, job_id=job_id)
        except Application.DoesNotExist:
            return error("Отклик не найден", 404)
        if not isinstance(request.data, dict):
            return error("Некорректные данные")
        application.payload = {**application.payload, **request.data}
        application.save(update_fields=["payload", "updated_at"])
        return Response(application.payload)
