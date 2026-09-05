from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


class Migration(migrations.Migration):
    initial = True
    dependencies = [
        ("auth", "0012_alter_user_first_name_max_length"),
        ("contenttypes", "0002_remove_content_type_name"),
    ]
    operations = [
        migrations.CreateModel(
            name="User",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("password", models.CharField(max_length=128, verbose_name="password")),
                ("last_login", models.DateTimeField(blank=True, null=True, verbose_name="last login")),
                ("is_superuser", models.BooleanField(default=False, help_text="Designates that this user has all permissions without explicitly assigning them.", verbose_name="superuser status")),
                ("email", models.EmailField(max_length=254, unique=True, verbose_name="email address")),
                ("first_name", models.CharField(blank=True, max_length=150, verbose_name="first name")),
                ("last_name", models.CharField(blank=True, max_length=150, verbose_name="last name")),
                ("is_staff", models.BooleanField(default=False, help_text="Designates whether the user can log into this admin site.", verbose_name="staff status")),
                ("is_active", models.BooleanField(default=True, help_text="Designates whether this user should be treated as active. Unselect this instead of deleting accounts.", verbose_name="active")),
                ("date_joined", models.DateTimeField(default=django.utils.timezone.now, verbose_name="date joined")),
                ("name", models.CharField(blank=True, max_length=160)),
                ("telegram_id", models.CharField(blank=True, max_length=64, null=True, unique=True)),
                ("telegram_username", models.CharField(blank=True, max_length=64)),
                ("telegram_photo_url", models.URLField(blank=True)),
                ("role", models.CharField(choices=[("user", "Пользователь"), ("moderator", "Модератор"), ("admin", "Администратор")], default="user", max_length=20)),
                ("groups", models.ManyToManyField(blank=True, help_text="The groups this user belongs to. A user will get all permissions granted to each of their groups.", related_name="user_set", related_query_name="user", to="auth.group", verbose_name="groups")),
                ("user_permissions", models.ManyToManyField(blank=True, help_text="Specific permissions for this user.", related_name="user_set", related_query_name="user", to="auth.permission", verbose_name="user permissions")),
            ],
        ),
        migrations.CreateModel(
            name="Profile",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("onboarding", models.JSONField(blank=True, null=True)),
                ("settings", models.JSONField(default=dict)),
                ("resume", models.JSONField(blank=True, null=True)),
                ("resume_file", models.FileField(blank=True, upload_to="resumes/%Y/%m/")),
                ("cover_letter", models.TextField(blank=True)),
                ("saved_job_ids", models.JSONField(default=list)),
                ("saved_job_notes", models.JSONField(default=dict)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("user", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="profile", to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.CreateModel(
            name="Application",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("job_id", models.PositiveIntegerField()),
                ("payload", models.JSONField(default=dict)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="applications", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["-updated_at"]},
        ),
        migrations.CreateModel(
            name="Subscription",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("provider", models.CharField(max_length=40)),
                ("external_id", models.CharField(max_length=160, unique=True)),
                ("plan", models.CharField(max_length=80)),
                ("status", models.CharField(choices=[("active", "Активна"), ("paused", "Приостановлена"), ("expired", "Истекла")], default="active", max_length=20)),
                ("ends_at", models.DateTimeField()),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="subscriptions", to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.CreateModel(
            name="PaymentEvent",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("provider", models.CharField(max_length=40)),
                ("external_event_id", models.CharField(max_length=160, unique=True)),
                ("payload", models.JSONField(default=dict)),
                ("processed_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
        ),
        migrations.CreateModel(
            name="AuditLog",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("action", models.CharField(max_length=120)),
                ("object_type", models.CharField(blank=True, max_length=120)),
                ("object_id", models.CharField(blank=True, max_length=120)),
                ("metadata", models.JSONField(default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("actor", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="audit_events", to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.AddConstraint(
            model_name="application",
            constraint=models.UniqueConstraint(fields=("user", "job_id"), name="unique_application_per_job"),
        ),
    ]
