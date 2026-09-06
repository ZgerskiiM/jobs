from django.db import migrations, models
import django.db.models.deletion


def copy_legacy_resumes(apps, schema_editor):
    Profile = apps.get_model("accounts", "Profile")
    Resume = apps.get_model("accounts", "Resume")

    for profile in Profile.objects.select_related("user").all():
        if not profile.resume and not profile.resume_file:
            continue
        data = dict(profile.resume) if isinstance(profile.resume, dict) else {}
        if profile.resume_file and not data.get("fileName"):
            data["fileName"] = profile.resume_file.name.rsplit("/", 1)[-1]
        data.setdefault("source", "upload" if profile.resume_file else "hh")
        data.setdefault("hasFile", bool(profile.resume_file))
        data.setdefault("id", f"legacy-{profile.pk}")
        Resume.objects.create(
            user=profile.user,
            data=data,
            file=profile.resume_file.name if profile.resume_file else "",
            is_active=True,
        )


class Migration(migrations.Migration):
    dependencies = [("accounts", "0002_alter_user_options_alter_user_managers_and_more")]

    operations = [
        migrations.CreateModel(
            name="Resume",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("data", models.JSONField(default=dict)),
                ("file", models.FileField(blank=True, upload_to="resumes/%Y/%m/")),
                ("is_active", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="resumes", to="accounts.user")),
            ],
            options={"ordering": ["-is_active", "-updated_at", "-id"]},
        ),
        migrations.RunPython(copy_legacy_resumes, migrations.RunPython.noop),
    ]
