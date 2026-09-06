from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("accounts", "0004_resume_stable_order")]

    operations = [
        migrations.CreateModel(
            name="VacancySnapshot",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("snapshot_at", models.DateTimeField(auto_now_add=True)),
                ("fingerprint", models.CharField(db_index=True, max_length=64)),
                ("vacancy_keys", models.JSONField(default=list)),
                ("total", models.PositiveIntegerField(default=0)),
            ],
            options={"ordering": ["-snapshot_at", "-id"]},
        ),
    ]
