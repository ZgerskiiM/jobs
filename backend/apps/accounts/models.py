from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.db import models
from django.utils import timezone


class UserManager(BaseUserManager):
    use_in_migrations = True

    def _create_user(self, email: str, password: str | None, **extra_fields):
        if not email:
            raise ValueError("Email обязателен")
        user = self.model(email=self.normalize_email(email), **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email: str, password: str | None = None, **extra_fields):
        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)
        return self._create_user(email, password, **extra_fields)

    def create_superuser(self, email: str, password: str, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("role", User.Role.ADMIN)
        return self._create_user(email, password, **extra_fields)


class User(AbstractUser):
    class Role(models.TextChoices):
        USER = "user", "Пользователь"
        MODERATOR = "moderator", "Модератор"
        ADMIN = "admin", "Администратор"

    username = None
    email = models.EmailField(unique=True)
    name = models.CharField(max_length=160, blank=True)
    telegram_id = models.CharField(max_length=64, unique=True, null=True, blank=True)
    telegram_username = models.CharField(max_length=64, blank=True)
    telegram_photo_url = models.URLField(blank=True)
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.USER)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS: list[str] = []
    objects = UserManager()

    def display_name(self) -> str:
        return self.name or self.telegram_username or self.email.split("@", 1)[0]

    @property
    def has_pro(self) -> bool:
        return self.subscriptions.filter(status=Subscription.Status.ACTIVE, ends_at__gt=timezone.now()).exists()


class Profile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="profile")
    onboarding = models.JSONField(null=True, blank=True)
    settings = models.JSONField(default=dict)
    resume = models.JSONField(null=True, blank=True)
    resume_file = models.FileField(upload_to="resumes/%Y/%m/", blank=True)
    cover_letter = models.TextField(blank=True)
    saved_job_ids = models.JSONField(default=list)
    saved_job_notes = models.JSONField(default=dict)
    updated_at = models.DateTimeField(auto_now=True)


class Application(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="applications")
    job_id = models.PositiveIntegerField()
    payload = models.JSONField(default=dict)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "job_id"], name="unique_application_per_job")]
        ordering = ["-updated_at"]


class Subscription(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "active", "Активна"
        PAUSED = "paused", "Приостановлена"
        EXPIRED = "expired", "Истекла"

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="subscriptions")
    provider = models.CharField(max_length=40)
    external_id = models.CharField(max_length=160, unique=True)
    plan = models.CharField(max_length=80)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    ends_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class PaymentEvent(models.Model):
    provider = models.CharField(max_length=40)
    external_event_id = models.CharField(max_length=160, unique=True)
    payload = models.JSONField(default=dict)
    processed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class AuditLog(models.Model):
    actor = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="audit_events")
    action = models.CharField(max_length=120)
    object_type = models.CharField(max_length=120, blank=True)
    object_id = models.CharField(max_length=120, blank=True)
    metadata = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
