import hashlib
import hmac
from pathlib import Path
import re
import time
from typing import Mapping

from django.conf import settings
from django.contrib.auth import login
from django.db import transaction

from .models import AuditLog, Profile, Resume, User
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


def infer_target_role(resume: dict) -> str:
    text = " ".join([
        str(resume.get("position", "")),
        *(str(skill.get("name", "")) for skill in resume.get("skills", []) if isinstance(skill, dict)),
    ]).casefold()
    position = str(resume.get("position", "")).casefold()
    devops_signals = ("devops", "sre", "kubernetes", "docker", "ansible", "terraform", "helm", "linux", "ci/cd")
    one_c_signals = ("1с", "1c", "конфигуратор", "скд", "бсп")
    java_signals = ("java", "spring", "hibernate", "jvm")
    if re.search(r"\b(?:devops|sre)\b|инженер\s+(?:по\s+)?(?:инфраструктуре|эксплуатации)", position):
        return "DEVOPS"
    if re.search(r"(?:1с|1c)[ -]?(?:программист|разработчик)|(?:программист|разработчик)[ -]?(?:1с|1c)", position):
        return "ONE_C_DEVELOPER"
    if re.search(r"java.{0,20}(?:developer|engineer|разработчик)|(?:backend|back-end|бэкенд).{0,20}java", position):
        return "JAVA_BACKEND"
    scores = {
        "DEVOPS": sum(signal in text for signal in devops_signals),
        "ONE_C_DEVELOPER": sum(signal in text for signal in one_c_signals),
        "JAVA_BACKEND": sum(signal in text for signal in java_signals),
    }
    best_role, best_score = max(scores.items(), key=lambda item: item[1])
    if best_score < 2 or list(scores.values()).count(best_score) > 1:
        return "UNKNOWN"
    return best_role


def normalize_resume_scoring_profile(resume: dict) -> tuple[dict, bool]:
    normalized = dict(resume)
    changed = False
    if not normalized.get("targetRole"):
        normalized["targetRole"] = infer_target_role(normalized)
        changed = True
    if normalized.get("experienceYears") is None:
        match = re.search(r"\d+(?:[.,]\d+)?", str(normalized.get("experience", "")))
        if match:
            normalized["experienceYears"] = float(match.group().replace(",", "."))
            changed = True
    return normalized, changed


def get_profile(user: User) -> Profile:
    profile, created = Profile.objects.get_or_create(user=user, defaults={"settings": DEFAULT_SETTINGS})
    if created or not profile.settings:
        profile.settings = DEFAULT_SETTINGS
        profile.save(update_fields=["settings", "updated_at"])
    return profile


def refresh_resume_analysis(profile: Profile) -> None:
    """Keep legacy Profile-based resumes working while using Resume records."""
    record = ensure_legacy_resume_record(profile)
    if record:
        refresh_resume_record(record)


def ensure_legacy_resume_record(profile: Profile) -> Resume | None:
    """Import a pre-multi-resume Profile resume on demand for old/local data."""
    existing = Resume.objects.filter(user=profile.user).first()
    if existing or (not isinstance(profile.resume, dict) and not profile.resume_file):
        return existing
    data = dict(profile.resume) if isinstance(profile.resume, dict) else {}
    data.setdefault("id", f"legacy-{profile.pk}")
    data.setdefault("source", "upload" if profile.resume_file else "hh")
    data.setdefault("hasFile", bool(profile.resume_file))
    if profile.resume_file:
        data.setdefault("fileName", Path(profile.resume_file.name).name)
    return Resume.objects.create(
        user=profile.user,
        data=data,
        file=profile.resume_file.name if profile.resume_file else "",
        is_active=True,
    )


def resume_payload(record: Resume) -> dict:
    data = dict(record.data) if isinstance(record.data, dict) else {}
    data.setdefault("id", f"upload-{record.pk}" if record.file else f"resume-{record.pk}")
    data["isActive"] = bool(record.is_active)
    if record.file:
        data.setdefault("source", "upload")
        data["hasFile"] = True
        data.setdefault("fileName", Path(record.file.name).name)
    else:
        data.setdefault("source", "hh")
        data.setdefault("hasFile", False)
    return data


def get_resume_records(user: User, profile: Profile | None = None) -> list[Resume]:
    profile = profile or get_profile(user)
    ensure_legacy_resume_record(profile)
    return list(Resume.objects.filter(user=user))


def get_active_resume_record(user: User, profile: Profile | None = None) -> Resume | None:
    records = get_resume_records(user, profile)
    if not records:
        return None
    return next((record for record in records if record.is_active), records[0])


def refresh_resume_record(record: Resume) -> bool:
    """Upgrade parsed metadata without replacing user-edited contact values."""
    if not record.file or not isinstance(record.data, dict):
        return False
    if record.data.get("analysisVersion") == RESUME_ANALYSIS_VERSION:
        return False
    opened = False
    try:
        record.file.open("rb")
        opened = True
        raw = record.file.read()
        filename = record.data.get("fileName") or Path(record.file.name).name
        analysis = analyze_resume(raw, filename)
    except Exception:
        return False
    finally:
        if opened:
            record.file.close()
    for field in ("fullName", "contactEmail", "contactPhone", "contactTelegram"):
        if not analysis.get(field) and record.data.get(field):
            analysis[field] = record.data[field]
    record.data = {**record.data, **analysis}
    record.save(update_fields=["data", "updated_at"])
    return True


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
    records = get_resume_records(user, profile)
    for record in records:
        refresh_resume_record(record)
        normalized, changed = normalize_resume_scoring_profile(record.data if isinstance(record.data, dict) else {})
        if changed:
            record.data = normalized
            record.save(update_fields=["data", "updated_at"])
    resumes = [resume_payload(record) for record in records]
    active_resume = next((resume for resume in resumes if resume.get("isActive")), resumes[0] if resumes else None)
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
        "resume": active_resume,
        "resumes": resumes,
        "coverLetter": profile.cover_letter,
        "savedJobIds": profile.saved_job_ids,
        "savedJobNotes": profile.saved_job_notes,
        "applications": [application.payload for application in user.applications.all()],
        "isPro": user.has_pro,
        "isNew": is_new,
    }
