import hashlib
import hmac
from pathlib import Path
import time
from typing import Mapping

from django.conf import settings
from django.contrib.auth import login
from django.db import transaction

from .models import AuditLog, Profile, User
from .resume_parser import RESUME_ANALYSIS_VERSION, analyze_resume


DEFAULT_SETTINGS = {
    "notifications": {
        "newJobs": True,
        "salaryDigest": True,
        "trendDigest": False,
        "companyActivity": False,
    },
    "account": {
        "profileVisible": True,
        "showSalaryExpectation": False,
    },
}


def get_profile(user: User) -> Profile:
    profile, created = Profile.objects.get_or_create(user=user, defaults={"settings": DEFAULT_SETTINGS})
    if created or not profile.settings:
        profile.settings = DEFAULT_SETTINGS
        profile.save(update_fields=["settings", "updated_at"])
    return profile


def refresh_resume_analysis(profile: Profile) -> None:
    """Upgrade resume metadata created by an older parser without another upload."""
    if not isinstance(profile.resume, dict) or not profile.resume_file:
        return
    if profile.resume.get("analysisVersion") == RESUME_ANALYSIS_VERSION:
        return

    opened = False
    try:
        profile.resume_file.open("rb")
        opened = True
        data = profile.resume_file.read()
        filename = profile.resume.get("fileName") or Path(profile.resume_file.name).name
        analysis = analyze_resume(data, filename)
    except Exception:
        return
    finally:
        if opened:
            profile.resume_file.close()

    profile.resume = {**profile.resume, **analysis}
    profile.save(update_fields=["resume", "updated_at"])


def telegram_payload_is_valid(data: Mapping[str, str]) -> bool:
    token = settings.TELEGRAM_BOT_TOKEN
    if not token or not data.get("hash") or not data.get("id") or not data.get("auth_date"):
        return False
    try:
        auth_date = int(data["auth_date"])
    except (TypeError, ValueError):
        return False
    if abs(time.time() - auth_date) > settings.TELEGRAM_LOGIN_MAX_AGE:
        return False
    check_string = "\n".join(f"{key}={data[key]}" for key in sorted(data) if key != "hash")
    secret_key = hashlib.sha256(token.encode("utf-8")).digest()
    expected_hash = hmac.new(secret_key, check_string.encode("utf-8"), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected_hash, data["hash"])


@transaction.atomic
def login_from_telegram(data: Mapping[str, str], request) -> User:
    telegram_id = str(data["id"])
    username = data.get("username", "")
    display_name = " ".join(part for part in (data.get("first_name", ""), data.get("last_name", "")) if part).strip()
    display_name = display_name or (f"@{username}" if username else "telegram user")
    user = User.objects.filter(telegram_id=telegram_id).first()
    if user is None:
        user = User.objects.create_user(
            email=f"telegram_{telegram_id}@telegram.local",
            password=None,
            name=display_name,
            telegram_id=telegram_id,
            telegram_username=username,
            telegram_photo_url=data.get("photo_url", ""),
        )
        AuditLog.objects.create(actor=user, action="account.created", object_type="user", object_id=str(user.pk), metadata={"provider": "telegram"})
    else:
        user.name = display_name
        user.telegram_username = username
        user.telegram_photo_url = data.get("photo_url", "")
        user.save(update_fields=["name", "telegram_username", "telegram_photo_url"])
    get_profile(user)
    login(request, user)
    return user


def account_payload(user: User, *, is_new: bool = False) -> dict:
    profile = get_profile(user)
    refresh_resume_analysis(profile)
    return {
        "user": {
            "id": user.pk,
            "name": user.display_name(),
            "email": None if user.email.endswith("@telegram.local") else user.email,
            "telegram": f"@{user.telegram_username}" if user.telegram_username else None,
            "telegramPhotoUrl": user.telegram_photo_url or None,
        },
        "onboarding": profile.onboarding,
        "settings": profile.settings,
        "resume": profile.resume,
        "coverLetter": profile.cover_letter,
        "savedJobIds": profile.saved_job_ids,
        "savedJobNotes": profile.saved_job_notes,
        "applications": [application.payload for application in user.applications.all()],
        "isPro": user.has_pro,
        "isNew": is_new,
    }
