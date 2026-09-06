from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("accounts", "0003_resume")]

    operations = [
        migrations.AlterModelOptions(
            name="resume",
            options={"ordering": ["created_at", "id"]},
        ),
    ]
