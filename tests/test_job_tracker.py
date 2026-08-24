import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import job_tracker


def make_job(external_id="1", title="Backend Engineer"):
    return job_tracker.Job(
        source_key="acme-gh", external_id=external_id, company="Acme",
        title=title, location="Remote", team="Engineering",
        workplace_type="remote", description="Build things", url="https://example.test/job/1",
        posted_at="", source_updated_at="2026-01-01T00:00:00Z",
    )


class PersistenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db = job_tracker.connect_db(Path(self.temp.name) / "jobs.sqlite3")

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def events(self):
        return [r[0] for r in self.db.execute("SELECT event_type FROM events ORDER BY id")]

    def test_new_update_and_reopen(self):
        job_tracker.persist_source(self.db, [make_job()], "acme-gh", 2, "t1")
        job_tracker.persist_source(self.db, [make_job(title="Senior Backend Engineer")], "acme-gh", 2, "t2")
        job_tracker.persist_source(self.db, [], "acme-gh", 2, "t3")
        job_tracker.persist_source(self.db, [], "acme-gh", 2, "t4")
        job_tracker.persist_source(self.db, [make_job(title="Senior Backend Engineer")], "acme-gh", 2, "t5")
        self.assertEqual(self.events(), ["new", "updated", "closed", "reopened"])
        row = self.db.execute("SELECT active, missing_runs FROM jobs").fetchone()
        self.assertEqual((row["active"], row["missing_runs"]), (1, 0))

    def test_single_missing_run_does_not_close(self):
        job_tracker.persist_source(self.db, [make_job()], "acme-gh", 2, "t1")
        counts = job_tracker.persist_source(self.db, [], "acme-gh", 2, "t2")
        row = self.db.execute("SELECT active, missing_runs FROM jobs").fetchone()
        self.assertEqual(counts["closed"], 0)
        self.assertEqual((row["active"], row["missing_runs"]), (1, 1))

    def test_non_authoritative_source_never_closes_missing_jobs(self):
        job_tracker.persist_source(self.db, [make_job()], "acme-gh", 1, "t1")
        job_tracker.persist_source(self.db, [], "acme-gh", 1, "t2", authoritative=False)
        row = self.db.execute("SELECT active, missing_runs FROM jobs").fetchone()
        self.assertEqual((row["active"], row["missing_runs"]), (1, 0))

    def test_filters(self):
        job = make_job()
        self.assertTrue(job_tracker.matches_filters(job, {"title_keywords": ["backend"]}))
        self.assertFalse(job_tracker.matches_filters(job, {"title_keywords": ["designer"]}))
        self.assertTrue(job_tracker.matches_filters(job, {"locations": ["remote"]}))


class TelegramNotificationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp.name) / "jobs.sqlite3"

    def tearDown(self):
        self.temp.cleanup()

    @patch("job_tracker.telegram_api_send")
    def test_skips_history_then_sends_each_new_job_once(self, send):
        db = job_tracker.connect_db(self.db_path)
        job_tracker.persist_source(db, [make_job()], "acme-gh", 2, "t1")
        db.commit()
        db.close()

        job_tracker.initialize_telegram_cursor(self.db_path)

        db = job_tracker.connect_db(self.db_path)
        job_tracker.persist_source(
            db, [make_job(), make_job("2", "Java Developer")], "acme-gh", 2, "t2",
        )
        db.commit()
        db.close()

        self.assertEqual(
            job_tracker.send_telegram_notifications(self.db_path, "token", "chat"), 1,
        )
        self.assertEqual(send.call_count, 1)
        self.assertIn("Java Developer", send.call_args.args[2])
        self.assertEqual(
            job_tracker.send_telegram_notifications(self.db_path, "token", "chat"), 0,
        )
        self.assertEqual(send.call_count, 1)

    @patch("job_tracker.telegram_api_send")
    def test_java_filter_skips_other_technologies(self, send):
        db = job_tracker.connect_db(self.db_path)
        job_tracker.initialize_telegram_cursor(self.db_path)
        job_tracker.persist_source(
            db,
            [make_job("1", "Python Developer"), make_job("2", "Java Developer")],
            "acme-gh", 2, "t1",
        )
        db.commit()
        db.close()

        settings = {"filter": {"technologies": ["Java"]}}
        self.assertEqual(
            job_tracker.send_telegram_notifications(
                self.db_path, "token", "chat", settings,
            ),
            1,
        )
        self.assertEqual(send.call_count, 1)
        self.assertIn("Java Developer", send.call_args.args[2])


class AdapterTests(unittest.TestCase):
    def test_technology_detection_distinguishes_java_from_javascript(self):
        self.assertEqual(job_tracker.detect_technologies("Senior Java developer"), ["Java"])
        self.assertEqual(job_tracker.detect_technologies("Frontend JavaScript TypeScript"),
                         ["JavaScript", "TypeScript"])

    def test_tbank_description_reads_tramvai_state(self):
        document = '''<script id="__TRAMVAI_STATE__" type="application/json">{
          "stores":{"vacancyDescriptionStore":{"vacancyDescription":{
            "title":"Java-разработчик","description":[]
          }}}
        }</script>'''
        self.assertEqual(job_tracker.tbank_description(document)["title"], "Java-разработчик")

    @patch("job_tracker.fetch_json")
    def test_lamoda_adapter_loads_full_job_card(self, fetch):
        fetch.side_effect = [
            {"data": [{"id": 7, "name": "Developer", "slug": "developer"}],
             "meta": {"total": 1}},
            {"data": {"attributes": {
                "name": "Java developer", "slug": "java-developer",
                "location": {"name": "Москва"}, "direction": {"name": "IT"},
                "duties": "<p>Писать сервисы</p>", "requirements": "Java и Spring"
            }}},
        ]
        jobs = job_tracker.lamoda_jobs({
            "key": "lamoda", "company": "Lamoda", "detail_workers": 1
        }, 5, 0)
        self.assertEqual((jobs[0].title, jobs[0].location, jobs[0].team),
                         ("Java developer", "Москва", "IT"))
        self.assertIn("Java и Spring", jobs[0].description)

    @patch("job_tracker.fetch_text")
    @patch("job_tracker.fetch_json")
    def test_alfa_bank_adapter_excludes_alfa_digital_duplicates(self, fetch_json, fetch_text):
        fetch_json.side_effect = [
            {"optionLists": {"business_lines": [{"id": 1, "text": "ИТ"}]}},
            {"optionLists": {"cities": [{"id": 2, "text": "Москва"}]}},
            {"total": 2, "items": [
                {"id": 10, "code": 100, "name": "Java", "cityId": 2,
                 "businessLineId": 1, "slug": "/java", "descriptionText": "Spring"},
                {"id": 11, "code": 200, "name": "QA", "cityId": 2,
                 "businessLineId": 1, "slug": "/qa", "descriptionText": "Tests"},
            ]},
        ]
        fetch_text.return_value = ('<a href="/vacancies/java--100">Java</a>', "https://digital.alfabank.ru/vacancies")
        jobs = job_tracker.alfa_bank_jobs({
            "key": "alfa", "company": "Альфа-Банк",
            "exclude_codes_url": "https://digital.alfabank.ru/vacancies",
        }, 5, 0)
        self.assertEqual([job.title for job in jobs], ["QA"])

    @patch("job_tracker.fetch_json")
    def test_twogis_adapter_uses_listing_and_detail_api(self, fetch):
        fetch.side_effect = [
            {"items": [{"id": 42}], "totalPages": 1},
            {
                "id": 42, "title": "Python-разработчик", "description": "<p>Пишем API</p>",
                "isRemote": True, "city": None,
                "direction": {"name": "Разработка", "slug": "development"},
            },
        ]
        jobs = job_tracker.twogis_jobs({"key": "2gis", "company": "2ГИС"}, 5, 0)
        self.assertEqual(len(jobs), 1)
        self.assertEqual(
            (jobs[0].title, jobs[0].team, jobs[0].workplace_type, jobs[0].description),
            ("Python-разработчик", "Разработка", "Удалённо", "Пишем API"),
        )

    @patch("job_tracker.fetch_json")
    def test_dodo_adapter_filters_brand_and_combines_description(self, fetch):
        fetch.side_effect = [
            {"data": [{"items": [
                {"id": 7, "brand": "Engineering", "position": "QA"},
                {"id": 8, "brand": "Dodo Pizza", "position": "Повар"},
            ]}]},
            {"data": {"page": {"content": [
                {"type": "vacancy_main", "data": {
                    "position": "QA-инженер", "vacancy_location": "Москва",
                    "subspeciality": "QA", "work_format": ["Удалёнка"],
                }},
                {"type": "vacancy_text", "data": {"text": "<p>Тестируем сервисы</p>"}},
                {"type": "vacancy_expectation", "data": {"title": "Ждём", "text": "<ul><li>Python</li></ul>"}},
            ]}}},
        ]
        jobs = job_tracker.dodo_jobs({
            "key": "dodo", "company": "Dodo Engineering", "brands": ["Engineering"]
        }, 5, 0)
        self.assertEqual(len(jobs), 1)
        self.assertEqual((jobs[0].title, jobs[0].team), ("QA-инженер", "QA"))
        self.assertIn("Тестируем сервисы", jobs[0].description)
        self.assertIn("Ждём\n• Python", jobs[0].description)

    @patch("job_tracker.fetch_json")
    def test_selectel_adapter_loads_full_job_cards(self, fetch):
        fetch.side_effect = [
            {"item_count": 1, "items": [{"id": 1882}]},
            {
                "id": 1882, "title": "Java-разработчик",
                "city": {"name": "Санкт-Петербург"},
                "tag": {"description": "Разработка"},
                "timetable_mode": {"name": "Гибрид"},
                "is_remote_available": True,
                "detailed_desc": "<p>Разрабатываем сервисы на Java</p>",
                "published_at": "2026-08-18T10:00:00+03:00",
            },
        ]
        jobs = job_tracker.selectel_jobs({"key": "selectel", "company": "Selectel"}, 5, 0)
        self.assertEqual(len(jobs), 1)
        self.assertEqual((jobs[0].team, jobs[0].workplace_type),
                         ("Разработка", "Гибрид, Удалённо"))
        self.assertEqual(jobs[0].description, "Разрабатываем сервисы на Java")

    @patch("job_tracker.fetch_text")
    def test_alfa_detail_extracts_embedded_description(self, fetch):
        fetch.return_value = ('''
            <h1>Java разработчик</h1>
            <script>{"city":{"name":"Москва"},
            "descriptionText":"Java и Spring\\nМикросервисы"}</script>
        ''', "https://digital.alfabank.ru/vacancies/java--42")
        source_job = make_job(title="Java")
        source_job = job_tracker.Job(**{
            **source_job.__dict__,
            "url": "https://digital.alfabank.ru/vacancies/java--42",
            "description": "",
        })
        job = job_tracker.enrich_direct_job(source_job, 5, 0)
        self.assertEqual((job.title, job.location), ("Java разработчик", "Москва"))
        self.assertEqual(job.description, "Java и Spring\nМикросервисы")

    @patch("job_tracker.fetch_text")
    def test_html_adapter_extracts_direct_job_links(self, fetch):
        fetch.return_value = ("""
            <a href="/vacancy/42/"><span>Backend</span> Engineer</a>
            <a href="/about/">About us</a>
        """, "https://company.test/vacancy/")
        jobs = job_tracker.html_jobs({
            "key": "direct", "company": "Acme", "url": "https://company.test/vacancy/",
            "job_url_pattern": r"/vacancy/(?P<id>\d+)/", "min_expected_jobs": 1,
        }, 5, 0)
        self.assertEqual((jobs[0].external_id, jobs[0].title), ("42", "Backend Engineer"))

    @patch("job_tracker.fetch_text")
    def test_html_adapter_rejects_suspicious_empty_page(self, fetch):
        fetch.return_value = ("<html>redesign in progress</html>", "https://company.test/jobs/")
        with self.assertRaises(RuntimeError):
            job_tracker.html_jobs({
                "key": "direct", "company": "Acme", "url": "https://company.test/jobs/",
                "job_url_pattern": r"/jobs/(?P<id>\d+)", "min_expected_jobs": 1,
            }, 5, 0)

    @patch("job_tracker.fetch_json")
    def test_greenhouse_adapter(self, fetch):
        fetch.return_value = {"jobs": [{
            "id": 42, "title": "Engineer", "location": {"name": "Berlin"},
            "content": "<p>Build &amp; ship</p>", "absolute_url": "https://example.test/42",
            "updated_at": "2026-01-01", "departments": [{"name": "Platform"}],
        }]}
        jobs = job_tracker.greenhouse_jobs(
            {"key": "x", "company": "Acme", "token": "acme"}, 5, 0
        )
        self.assertEqual((jobs[0].external_id, jobs[0].description, jobs[0].team),
                         ("42", "Build & ship", "Platform"))

    @patch("job_tracker.fetch_json")
    def test_lever_adapter_handles_null_fields(self, fetch):
        fetch.return_value = [{
            "id": "abc", "text": "Developer", "categories": {"location": None},
            "descriptionPlain": None, "additionalPlain": "Details",
            "lists": [{"text": None, "content": "<b>Python</b>"}],
            "hostedUrl": "https://example.test/abc", "createdAt": 0,
        }]
        jobs = job_tracker.lever_jobs(
            {"key": "x", "company": "Acme", "site": "acme"}, 5, 0
        )
        self.assertEqual(jobs[0].location, "")
        self.assertEqual(jobs[0].description, "Details Python")

    @patch("job_tracker.fetch_json")
    def test_hh_adapter_for_russian_it_jobs(self, fetch):
        fetch.side_effect = [
            {"categories": [{"name": "Информационные технологии", "roles": [{"id": "96"}]}]},
            {"found": 1, "pages": 1, "items": [{
                "id": "777", "name": "Python-разработчик", "area": {"name": "Москва"},
                "professional_roles": [{"name": "Программист, разработчик"}],
                "work_format": [{"name": "Удалённо"}], "schedule": {"name": "Полный день"},
                "snippet": {"responsibility": "Разработка <highlighttext>API</highlighttext>", "requirement": "Python"},
                "alternate_url": "https://hh.ru/vacancy/777", "published_at": "2026-08-18",
                "created_at": "2026-08-18",
            }]},
        ]
        jobs = job_tracker.hh_jobs({
            "key": "acme-hh", "company": "Acme", "employer_id": "1", "area": "113",
            "professional_role_category": "Информационные технологии",
            "user_agent": "JobTracker/1.0 (dev@company.ru)",
        }, 5, 0)
        self.assertEqual(len(jobs), 1)
        self.assertEqual((jobs[0].location, jobs[0].team),
                         ("Москва", "Программист, разработчик"))
        requested_url = fetch.call_args_list[1].args[0]
        self.assertIn("employer_id=1", requested_url)
        self.assertIn("area=113", requested_url)
        self.assertIn("professional_role=96", requested_url)

    @patch("job_tracker.fetch_json")
    def test_hh_splits_large_role_category(self, fetch):
        fetch.side_effect = [
            {"categories": [{"name": "IT", "roles": [{"id": str(i)} for i in range(21)]}]},
            {"found": 0, "pages": 0, "items": []},
            {"found": 0, "pages": 0, "items": []},
            {"found": 0, "pages": 0, "items": []},
        ]
        jobs = job_tracker.hh_jobs({
            "key": "acme-hh", "company": "Acme", "employer_id": "1",
            "professional_role_category": "IT",
            "user_agent": "JobTracker/1.0 (dev@company.ru)",
        }, 5, 0)
        self.assertEqual(jobs, [])
        self.assertEqual(fetch.call_count, 4)
        for call in fetch.call_args_list[1:]:
            self.assertLessEqual(call.args[0].count("professional_role="), 10)


if __name__ == "__main__":
    unittest.main()

