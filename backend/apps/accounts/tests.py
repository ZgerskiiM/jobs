import hashlib
import hmac
import time
from io import BytesIO

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from docx import Document

from .models import Profile, User
from .resume_parser import detect_skills


class AccountApiTests(TestCase):
    @override_settings(TELEGRAM_BOT_TOKEN="test-token", TELEGRAM_BOT_USERNAME="jobsdev_bot")
    def test_telegram_login_creates_session_and_profile(self):
        payload = {"id": "42", "first_name": "Ada", "username": "ada", "auth_date": str(int(time.time()))}
        check_string = "\n".join(f"{key}={payload[key]}" for key in sorted(payload))
        secret_key = hashlib.sha256(b"test-token").digest()
        payload["hash"] = hmac.new(secret_key, check_string.encode(), hashlib.sha256).hexdigest()

        response = APIClient().post("/api/auth/telegram/", payload, format="json")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["user"]["telegram"], "@ada")
        self.assertTrue(User.objects.filter(telegram_id="42").exists())
        self.assertTrue(Profile.objects.filter(user__telegram_id="42").exists())

    def test_email_registration_and_profile_patch_persist(self):
        client = APIClient()
        response = client.post("/api/auth/email/", {"email": "ada@example.com", "password": "correct-horse", "mode": "register"}, format="json")
        self.assertEqual(response.status_code, 200)
        response = client.patch("/api/profile/", {"name": "Ada Lovelace", "onboarding": {"roles": ["backend"]}}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["user"]["name"], "Ada Lovelace")
        self.assertEqual(Profile.objects.get(user__email="ada@example.com").onboarding, {"roles": ["backend"]})

    def test_resume_upload_extracts_docx_profile_and_skills(self):
        client = APIClient()
        client.post("/api/auth/email/", {"email": "resume@example.com", "password": "correct-horse", "mode": "register"}, format="json")
        document = Document()
        document.add_paragraph("Senior Backend Engineer")
        document.add_paragraph("Опыт: 6 лет. Python, Golang, PostgreSQL, Docker, Kubernetes, REST API")
        file_data = BytesIO()
        document.save(file_data)

        response = client.post(
            "/api/profile/resume/",
            {"resume": SimpleUploadedFile("resume.docx", file_data.getvalue(), content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
            format="multipart",
        )

        self.assertEqual(response.status_code, 200)
        resume = response.data["resume"]
        self.assertEqual(resume["position"], "Senior Backend Engineer")
        self.assertEqual(resume["experience"], "6 лет")
        self.assertEqual({skill["name"] for skill in resume["skills"]}, {"Python", "Go", "PostgreSQL", "Docker", "Kubernetes", "REST API"})

    def test_resume_upload_rejects_unsupported_format(self):
        client = APIClient()
        client.post("/api/auth/email/", {"email": "resume-format@example.com", "password": "correct-horse", "mode": "register"}, format="json")

        response = client.post(
            "/api/profile/resume/",
            {"resume": SimpleUploadedFile("resume.txt", b"Python", content_type="text/plain")},
            format="multipart",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("PDF и DOCX", response.data["message"])

    def test_skill_detection_handles_aliases_and_pdf_line_breaks(self):
        skills = detect_skills("Golang, K8s, Postgre-\nsql, JavaScript, Google Cloud")

        self.assertEqual({skill["name"] for skill in skills}, {"Go", "Kubernetes", "PostgreSQL", "JavaScript", "GCP"})

    def test_experience_ignores_age_and_prefers_work_experience(self):
        from .resume_parser import extract_experience

        self.assertEqual(extract_experience("Мужчина, 23 года\nОпыт работы — 4 года 3 месяца"), "4 года")

    def test_old_resume_analysis_is_refreshed_when_account_is_loaded(self):
        from django.core.files.base import ContentFile
        from .services import account_payload, get_profile

        user = User.objects.create_user(email="refresh@example.com", password="correct-horse")
        profile = get_profile(user)
        document = Document()
        document.add_paragraph("Java Backend Developer")
        document.add_paragraph("Опыт работы — 4 года. Java, Spring Boot, PostgreSQL")
        file_data = BytesIO()
        document.save(file_data)

        profile.resume_file.save("resume.docx", ContentFile(file_data.getvalue()), save=False)
        profile.resume = {"fileName": "resume.docx", "experience": "", "position": "", "skills": []}
        profile.save()

        payload = account_payload(user)

        self.assertEqual(payload["resume"]["analysisVersion"], 2)
        self.assertEqual(payload["resume"]["position"], "Java Backend Developer")
        self.assertEqual(payload["resume"]["experience"], "4 года")
        self.assertEqual({skill["name"] for skill in payload["resume"]["skills"]}, {"Java", "Spring", "Spring Boot", "PostgreSQL"})
