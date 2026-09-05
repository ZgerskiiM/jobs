from datetime import datetime
from pathlib import Path
from typing import Any
from html import unescape
import json as jsonlib
import re
import urllib.parse
import urllib.request

from django.conf import settings
from django.contrib.auth import authenticate, logout
from django.core.files.base import ContentFile
from django.db import transaction
from django.http import HttpResponseRedirect
from django.utils import timezone
from django.views.decorators.csrf import csrf_protect
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Application, AuditLog, Profile, User
from .resume_parser import analyze_resume
from .serializers import EmailAuthSerializer, ProfilePatchSerializer, SavedJobSerializer
from .services import account_payload, get_profile, login_from_telegram, telegram_payload_is_valid


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
        if not profile.resume:
            return error("Сначала загрузите резюме")
        skills = request.data.get("skills")
        if not isinstance(skills, list):
            return error("Некорректный список навыков")
        profile.resume = {**profile.resume, "skills": skills}
        profile.save(update_fields=["resume", "updated_at"])
        return Response({"resume": profile.resume})

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
        resume = {"fileName": filename, "uploadedAt": now, **analysis}
        profile = get_profile(request.user)
        if profile.resume_file:
            profile.resume_file.delete(save=False)
        profile.resume_file.save(filename, ContentFile(data), save=False)
        profile.resume = resume
        profile.save()
        return Response({"resume": resume})

    def delete(self, request):
        profile = get_profile(request.user)
        profile.resume_file.delete(save=False)
        profile.resume = None
        profile.save(update_fields=["resume", "resume_file", "updated_at"])
        return Response({"resume": None})


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
