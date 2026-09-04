import sqlite3
import json
import tempfile
import threading
import time
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

    def test_stale_job_is_hidden_then_restored_when_seen_again(self):
        job_tracker.persist_source(self.db, [make_job()], "acme-gh", 2, "2026-08-01T00:00:00+00:00")
        self.db.execute(
            "UPDATE jobs SET last_seen_at=? WHERE source_key=? AND external_id=?",
            ("2026-08-01T00:00:00+00:00", "acme-gh", "1"),
        )
        marked = job_tracker.mark_stale_jobs(
            self.db,
            [{"key": "acme-gh", "type": "html"}],
            7,
            "2026-08-10T00:00:00+00:00",
        )
        self.assertEqual(marked, 1)
        self.assertEqual(self.db.execute("SELECT stale FROM jobs").fetchone()["stale"], 1)

        counts = job_tracker.persist_source(
            self.db, [make_job()], "acme-gh", 2, "2026-08-10T00:00:00+00:00", authoritative=False,
        )
        row = self.db.execute("SELECT active, stale, stale_at FROM jobs").fetchone()
        self.assertEqual(counts["restored"], 1)
        self.assertEqual((row["active"], row["stale"], row["stale_at"]), (1, 0, None))
        self.assertEqual(self.events(), ["new", "stale", "restored"])

    def test_stale_job_is_excluded_from_default_exports(self):
        job_tracker.persist_source(self.db, [make_job()], "acme-gh", 2, "2026-08-01T00:00:00+00:00")
        self.db.execute("UPDATE jobs SET stale=1, stale_at=?", ("2026-08-10T00:00:00+00:00",))
        self.db.commit()
        csv_path = Path(self.temp.name) / "jobs.csv"
        site_path = Path(self.temp.name) / "vacancies.js"

        job_tracker.export_csv(Path(self.temp.name) / "jobs.sqlite3", csv_path, include_closed=False)
        job_tracker.export_site_data(Path(self.temp.name) / "jobs.sqlite3", site_path)

        self.assertNotIn("Backend Engineer", csv_path.read_text(encoding="utf-8-sig"))
        self.assertNotIn("Backend Engineer", site_path.read_text(encoding="utf-8"))

    def test_site_export_precomputes_compact_scoring_features(self):
        job = job_tracker.Job(
            source_key="acme-gh", external_id="java-1", company="Acme",
            title="Senior Java Backend Developer", location="Remote", team="Platform",
            workplace_type="remote",
            description="Java 17, Spring Boot и Kafka. Коммерческий опыт от 4 лет.",
            url="https://example.test/job/java-1", posted_at="2026-09-01",
            source_updated_at="2026-09-01T00:00:00Z",
        )
        job_tracker.persist_source(self.db, [job], "acme-gh", 2, "2026-09-01T00:00:00Z")
        self.db.commit()
        site_path = Path(self.temp.name) / "vacancies.js"

        job_tracker.export_site_data(Path(self.temp.name) / "jobs.sqlite3", site_path)

        exported = site_path.read_text(encoding="utf-8")
        self.assertIn('"scoring_features"', exported)
        self.assertIn('"SPRING_BOOT"', exported)
        indexed = self.db.execute(
            "SELECT taxonomy_version, content_hash FROM vacancy_feature_index WHERE source_key=? AND external_id=?",
            ("acme-gh", "java-1"),
        ).fetchone()
        self.assertIsNotNone(indexed)
        self.assertTrue(indexed["taxonomy_version"])
        self.assertEqual(len(indexed["content_hash"]), 64)

    def test_existing_database_is_migrated_with_stale_columns(self):
        legacy_path = Path(self.temp.name) / "legacy.sqlite3"
        legacy_db = job_tracker.sqlite3.connect(legacy_path)
        legacy_db.execute("CREATE TABLE jobs (source_key TEXT, external_id TEXT)")
        legacy_db.commit()
        legacy_db.close()

        migrated_db = job_tracker.connect_db(legacy_path)
        columns = {row["name"] for row in migrated_db.execute("PRAGMA table_info(jobs)")}
        migrated_db.close()
        self.assertTrue({"stale", "stale_at"}.issubset(columns))

    def test_failed_persistence_rolls_back_source_changes(self):
        config_path = Path(self.temp.name) / "config.json"
        rollback_db_path = Path(self.temp.name) / "rollback.sqlite3"
        config_path.write_text(json.dumps({
            "sources": [{
                "key": "acme-gh", "company": "Acme", "type": "greenhouse", "token": "acme",
            }],
        }), encoding="utf-8")
        original_persist = job_tracker.persist_source

        def fail_after_write(*args, **kwargs):
            original_persist(*args, **kwargs)
            raise RuntimeError("simulated database failure")

        with patch("job_tracker.greenhouse_jobs", return_value=[make_job()]):
            with patch("job_tracker.persist_source", side_effect=fail_after_write):
                self.assertEqual(job_tracker.run_sync(config_path, rollback_db_path), 1)

        rollback_db = job_tracker.connect_db(rollback_db_path)
        self.assertEqual(rollback_db.execute("SELECT COUNT(*) FROM jobs").fetchone()[0], 0)
        run = rollback_db.execute("SELECT status, error FROM runs").fetchone()
        rollback_db.close()
        self.assertEqual(run["status"], "error")
        self.assertIn("simulated database failure", run["error"])

    def test_sync_lock_rejects_competing_process(self):
        db_path = Path(self.temp.name) / "locked.sqlite3"
        with job_tracker.SyncLock(db_path):
            self.assertEqual(job_tracker.run_sync(Path(self.temp.name) / "missing.json", db_path), 3)

    def test_sync_fetches_multiple_sources_concurrently(self):
        config_path = Path(self.temp.name) / "parallel.json"
        db_path = Path(self.temp.name) / "parallel.sqlite3"
        config_path.write_text(json.dumps({
            "http": {"source_workers": 3, "per_domain_workers": 2},
            "sources": [
                {"key": f"acme-{index}", "company": f"Acme {index}", "type": "greenhouse", "token": "acme"}
                for index in range(3)
            ],
        }), encoding="utf-8")
        active = 0
        peak = 0
        counter_lock = threading.Lock()

        def slow_fetch(source, _timeout, _retries):
            nonlocal active, peak
            with counter_lock:
                active += 1
                peak = max(peak, active)
            time.sleep(0.05)
            with counter_lock:
                active -= 1
            return [job_tracker.Job(
                source_key=source["key"], external_id="1", company=source["company"],
                title="Backend Engineer", location="Remote", team="Engineering",
                workplace_type="remote", description="Build things", url="https://example.test/job/1",
                posted_at="", source_updated_at="",
            )]

        with patch("job_tracker.greenhouse_jobs", side_effect=slow_fetch):
            self.assertEqual(job_tracker.run_sync(config_path, db_path), 0)
        self.assertEqual(peak, 3)

    def test_domain_limiter_serializes_requests_for_one_host(self):
        limiter = job_tracker.DomainRequestLimiter(1)
        active = 0
        peak = 0
        counter_lock = threading.Lock()

        def request():
            nonlocal active, peak
            with limiter.acquire("https://career.example.test/vacancies"):
                with counter_lock:
                    active += 1
                    peak = max(peak, active)
                time.sleep(0.02)
                with counter_lock:
                    active -= 1

        threads = [threading.Thread(target=request) for _ in range(3)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(peak, 1)

    def test_filters(self):
        job = make_job()
        self.assertTrue(job_tracker.matches_filters(job, {"title_keywords": ["backend"]}))
        self.assertFalse(job_tracker.matches_filters(job, {"title_keywords": ["designer"]}))
        self.assertTrue(job_tracker.matches_filters(job, {"locations": ["remote"]}))

    def test_exclude_title_keywords_take_priority(self):
        job = make_job(title="Backend Engineer / HR platform")
        self.assertFalse(job_tracker.matches_filters(job, {
            "title_keywords": ["backend"], "exclude_title_keywords": ["hr platform"],
        }))

    def test_requested_non_it_titles_are_excluded(self):
        filters = {
            "exclude_title_keywords": [
                "диспетчер", "менеджер пункта выдачи", "менеджер по закупкам",
                "оператор call", "преподаватель", "химик",
            ]
        }
        for title in (
            "Диспетчер",
            "Менеджер пункта выдачи заказов",
            "Младший менеджер по закупкам",
            "Продажи Оператор call - центра",
            "Преподаватель",
            "Химик",
        ):
            with self.subTest(title=title):
                self.assertFalse(job_tracker.matches_filters(make_job(title=title), filters))

    def test_exclude_title_prefix_keeps_specialised_manager_roles(self):
        filters = {"exclude_title_prefixes": ["менеджер"]}
        self.assertFalse(job_tracker.matches_filters(make_job(title="Менеджер (Москва)"), filters))
        self.assertTrue(job_tracker.matches_filters(make_job(title="Менеджер продукта"), filters))

    def test_source_filters_keep_global_exclusions(self):
        filters = job_tracker.source_filters(
            {"exclude_title_keywords": ["бухгалтер"], "locations": ["Москва"]},
            {"filters": {"title_keywords": ["инженер"], "locations": []}},
        )
        self.assertEqual(filters["title_keywords"], ["инженер"])
        self.assertEqual(filters["locations"], [])
        self.assertEqual(filters["exclude_title_keywords"], ["бухгалтер"])

    def test_html_link_guard_rejects_navigation_labels(self):
        self.assertFalse(job_tracker.is_probable_html_job_title("Вакансии"))
        self.assertFalse(job_tracker.is_probable_html_job_title("Отправить резюме"))
        self.assertTrue(job_tracker.is_probable_html_job_title("Инженер нагрузочного тестирования"))

    def test_html_title_cleaner_drops_action_suffixes(self):
        self.assertEqual(
            job_tracker.clean_html_job_title("tmk-direct", "Ведущий инженер ПОДРОБНЕЕ"),
            "Ведущий инженер",
        )

    @patch("job_tracker.fetch_text")
    def test_orionsoft_title_drops_details_suffix(self, fetch):
        fetch.return_value = (
            '<a href="/vacancy/admin">Младший администратор проектов Junior+ ПОДРОБНЕЕ</a>',
            "https://career.orionsoft.ru/vacancy",
        )
        jobs = job_tracker.html_jobs({
            "key": "orionsoft-direct", "company": "Orion soft", "url": "https://career.orionsoft.ru/vacancy",
            "job_url_pattern": r"/vacancy/(?P<id>[^/?#]+)", "min_expected_jobs": 1,
            "fetch_details": False,
        }, 5, 0)
        self.assertEqual(jobs[0].title, "Младший администратор проектов Junior+")

    def test_reksoft_title_drops_card_metadata(self):
        self.assertEqual(
            job_tracker.clean_html_job_title(
                "reksoft-direct",
                "Промышленная автоматизация Ведущий инженер АСУ ТП формат Гибрид Опыт работы больше 3 лет Москва",
            ),
            "Ведущий инженер АСУ ТП",
        )

    def test_generic_job_description_uses_vacancy_content_without_navigation(self):
        document = """
        <header>Вакансии · Карьера</header>
        <main><h1>Python-разработчик</h1><p>Разрабатывает сервисы для клиентов и поддерживает стабильную работу платформы.</p>
        <p>Работает с командой, тестами, распределёнными системами и документацией для внутренних пользователей.</p></main>
        <footer>Контакты</footer>
        """
        self.assertEqual(
            job_tracker.generic_job_description(document, "Python-разработчик"),
            "Разрабатывает сервисы для клиентов и поддерживает стабильную работу платформы.\nРаботает с командой, тестами, распределёнными системами и документацией для внутренних пользователей.",
        )

    def test_generic_job_description_falls_back_to_page_body(self):
        document = """
        <nav>Вакансии · Компания</nav><h1>Go-разработчик</h1>
        <section>Разрабатывает высоконагруженные сервисы и поддерживает качество кода в продуктовой команде.</section>
        <section>Работает с тестированием, мониторингом и документацией для стабильных релизов.</section>
        """
        self.assertIn(
            "Разрабатывает высоконагруженные сервисы",
            job_tracker.generic_job_description(document, "Go-разработчик"),
        )

    def test_cleans_titles_from_one_c_and_korus_catalogues(self):
        self.assertEqual(
            job_tracker.clean_one_c_title(
                "1С, Python, Linux Администратор 1С Чем предстоит заниматься: Администрирование"
            ),
            "1С, Python, Linux Администратор 1С",
        )
        self.assertEqual(
            job_tracker.clean_one_c_title("Программист 1С:ERP 1С:ERP – флагманский продукт"),
            "Программист 1С:ERP",
        )
        self.assertEqual(
            job_tracker.clean_one_c_title("Менеджер по мероприятиям и маркетингу Ищем сотрудника"),
            "Менеджер по мероприятиям и маркетингу",
        )
        self.assertEqual(
            job_tracker.clean_korus_title(
                "Департамент 1C Ведущий консультант 1С:ERP (Оперконтур) Удалённо, Гибрид"
            ),
            "Ведущий консультант 1С:ERP (Оперконтур)",
        )


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

    @patch("job_tracker.telegram_api_send")
    def test_digest_sends_only_matching_active_jobs(self, send):
        db = job_tracker.connect_db(self.db_path)
        job_tracker.persist_source(
            db,
            [make_job("1", "Python Developer"), make_job("2", "Java Developer")],
            "acme-gh", 2, "t1",
        )
        db.commit()
        db.close()

        sent = job_tracker.send_telegram_digest(
            self.db_path, "token", "chat",
            {"filter": {"technologies": ["Java"]}}, limit=10,
        )
        self.assertEqual(sent, 1)
        self.assertEqual(send.call_count, 1)
        self.assertIn("Java Developer", send.call_args.args[2])
        self.assertNotIn("Python Developer", send.call_args.args[2])


class AdapterTests(unittest.TestCase):
    def test_fetch_json_uses_shared_httpx_client(self):
        requests = []

        def handler(request):
            requests.append(request)
            return job_tracker.httpx.Response(200, json={"ok": True})

        client = job_tracker.httpx.Client(transport=job_tracker.httpx.MockTransport(handler))
        previous = job_tracker.HTTP_CLIENT
        job_tracker.HTTP_CLIENT = client
        try:
            self.assertEqual(job_tracker.fetch_json("https://api.example.test/jobs", 5, 0), {"ok": True})
        finally:
            job_tracker.HTTP_CLIENT = previous
            client.close()
        self.assertEqual(len(requests), 1)
        self.assertEqual(str(requests[0].url), "https://api.example.test/jobs")

    def test_hh_role_ids_are_cached_for_the_sync_process(self):
        with job_tracker.HH_ROLE_CACHE_LOCK:
            saved_cache = dict(job_tracker.HH_ROLE_CACHE)
            job_tracker.HH_ROLE_CACHE.clear()
        try:
            with patch("job_tracker.fetch_json", return_value={
                "categories": [{"name": "Cache test", "roles": [{"id": "7"}]}],
            }) as fetch:
                self.assertEqual(job_tracker.hh_role_ids("Cache test", 5, 0, "agent"), ["7"])
                self.assertEqual(job_tracker.hh_role_ids("CACHE TEST", 5, 0, "agent"), ["7"])
                self.assertEqual(fetch.call_count, 1)
        finally:
            with job_tracker.HH_ROLE_CACHE_LOCK:
                job_tracker.HH_ROLE_CACHE.clear()
                job_tracker.HH_ROLE_CACHE.update(saved_cache)

    def test_technology_detection_distinguishes_java_from_javascript(self):
        self.assertEqual(job_tracker.detect_technologies("Senior Java developer"), ["Java"])
        self.assertEqual(job_tracker.detect_technologies("Frontend JavaScript TypeScript"),
                         ["JavaScript", "TypeScript"])
        self.assertEqual(job_tracker.detect_technologies("Разработчик 1С:Предприятие 8.3"), ["1С"])
        self.assertEqual(job_tracker.detect_technologies("Senior 1C developer"), ["1С"])
        self.assertEqual(
            job_tracker.detect_technologies("Разработчик Bitrix24 и BPMSoft"),
            ["Bitrix24", "BPMSoft"],
        )

    def test_tbank_description_reads_tramvai_state(self):
        document = '''<script id="__TRAMVAI_STATE__" type="application/json">{
          "stores":{"vacancyDescriptionStore":{"vacancyDescription":{
            "title":"Java-разработчик","description":[]
          }}}
        }</script>'''
        self.assertEqual(job_tracker.tbank_description(document)["title"], "Java-разработчик")

    @patch("job_tracker.fetch_json")
    def test_magnit_tech_adapter_loads_full_job_card(self, fetch):
        fetch.side_effect = [
            {
                "results": [{"id": 42, "title": "Java-разработчик"}],
                "meta": {"has_more_pages": False},
            },
            {"results": {
                "id": 42,
                "title": "Java-разработчик",
                "description": "<p>Разрабатываем сервисы</p>",
                "tasks": "<ul><li>Писать код</li></ul>",
                "skills": "<p>Java и Spring</p>",
                "location": "Москва",
                "direction": {"name": "Backend"},
                "speciality": {"name": "Разработка"},
                "work_formats": [{"name": "Гибрид"}],
                "technologies": [{"name": "Java"}, {"name": "Spring"}],
            }},
        ]
        jobs = job_tracker.magnit_tech_jobs({
            "key": "magnit", "company": "Магнит Тех", "min_expected_jobs": 1,
            "detail_workers": 1,
        }, 5, 0)
        self.assertEqual(len(jobs), 1)
        self.assertEqual(
            (jobs[0].title, jobs[0].location, jobs[0].team, jobs[0].workplace_type),
            ("Java-разработчик", "Москва", "Backend, Разработка", "Гибрид"),
        )
        self.assertIn("Java и Spring", jobs[0].description)
        self.assertEqual(jobs[0].url, "https://magnit.tech/vacancies/42")

    @patch("job_tracker.fetch_json")
    def test_psb_adapter_keeps_only_it_and_loads_details(self, fetch):
        fetch.side_effect = [
            {
                "data": [
                    {"id": "17", "title": "Java-разработчик", "type": "It"},
                    {"id": "18", "title": "Менеджер", "type": "Business"},
                ],
                "total_count": 2,
            },
            {
                "id": "17", "title": "Java-разработчик", "locationName": "Москва",
                "profGroupName": "Разработка", "workTypeName": "Гибрид",
                "req": "Java и Spring", "duty": "Разрабатывать сервисы",
                "cond": "ДМС", "update_date": "2026-08-26T10:00:00+00:00",
            },
        ]
        jobs = job_tracker.psb_jobs({
            "key": "psb", "company": "ПСБ", "min_expected_jobs": 1,
            "detail_workers": 1,
        }, 5, 0)
        self.assertEqual(len(jobs), 1)
        self.assertEqual(
            (jobs[0].title, jobs[0].location, jobs[0].team, jobs[0].workplace_type),
            ("Java-разработчик", "Москва", "Разработка", "Гибрид"),
        )
        self.assertIn("Java и Spring", jobs[0].description)
        self.assertEqual(jobs[0].url, "https://job.psbank.ru/vacancies/it-specialists/17")

    @patch("job_tracker.fetch_text")
    def test_glowbyte_detail_extracts_tilda_content(self, fetch):
        fetch.return_value = ('''
            <html><head><title>GlowByte — Java Разработчик</title>
            <script>const noise = "ignore";</script></head>
            <body><h1>Java Разработчик</h1><p>Разработка сервисов на Spring</p>
            <p>Требуемый опыт работы: 1–3 года</p>
            <h2>Присоединяйся к команде GlowByte</h2><p>Форма отклика</p></body></html>
        ''', "https://job.glowbyteconsulting.com/java-developer")
        source_job = make_job(title="Смотреть вакансию")
        source_job = job_tracker.Job(**{
            **source_job.__dict__,
            "url": "https://job.glowbyteconsulting.com/java-developer",
            "description": "",
        })
        job = job_tracker.enrich_direct_job(source_job, 5, 0)
        self.assertEqual(job.title, "Java Разработчик")
        self.assertIn("Разработка сервисов на Spring", job.description)
        self.assertNotIn("Форма отклика", job.description)

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
    def test_samolet_adapter_maps_official_public_feed(self, fetch):
        fetch.return_value = {"count": 1, "results": [{
            "uuid": "abc", "name": "Java-разработчик", "externalUrl": "https://example.test/abc",
            "region": {"name": "Москва"}, "specialization": {"name": "Разработка"},
            "workplaceType": {"name": "Гибрид"}, "requirements": "<p>Java и Spring</p>",
        }]}
        jobs = job_tracker.samolet_jobs(
            {"key": "samolet", "company": "Самолет", "min_expected_jobs": 1}, 5, 0
        )
        self.assertEqual(
            (jobs[0].external_id, jobs[0].location, jobs[0].team, jobs[0].description),
            ("abc", "Москва", "Разработка", "Java и Spring"),
        )

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

    @patch("job_tracker.fetch_json")
    def test_rwb_adapter_loads_public_listing_and_details(self, fetch):
        def response(url, *_args, **_kwargs):
            if url.endswith("/7"):
                return {"data": {"id": 7, "name": "Java-разработчик", "description": "Spring",
                    "requirements_arr": ["Java 17"], "duties_arr": ["Разработка API"],
                    "conditions_arr": ["Удалённо"], "office_location_city_title": "Москва",
                    "direction_name": "Разработка", "employment_types_list": [{"title": "Удалённо"}]}}
            return {"data": {"items": [{"id": 7, "name": "Java-разработчик"}],
                "range": {"count": 1, "limit": 100, "offset": 0}}}
        fetch.side_effect = response
        jobs = job_tracker.rwb_jobs({"key": "rwb", "company": "RWB", "min_expected_jobs": 1}, 5, 0)
        self.assertEqual((jobs[0].title, jobs[0].location, jobs[0].team),
                         ("Java-разработчик", "Москва", "Разработка"))
        self.assertIn("Java 17", jobs[0].description)

    @patch("job_tracker.fetch_json")
    def test_rshb_digital_adapter_loads_it_cards(self, fetch):
        fetch.side_effect = [
            {"content": [{"id": "42", "title": "Backend-разработчик", "city": "Москва",
                "company": "РСХБ-Интех", "url": "https://hh.ru/vacancy/42",
                "publishDate": "1 августа 2026"}], "totalPages": 1},
            {"descriptionHtml": "<p>Java, Spring, Kafka</p>"},
        ]
        jobs = job_tracker.rshb_digital_jobs(
            {"key": "rshb", "company": "РСХБ.цифра", "min_expected_jobs": 1}, 5, 0
        )
        self.assertEqual((jobs[0].title, jobs[0].location, jobs[0].team),
                         ("Backend-разработчик", "Москва", "РСХБ-Интех"))
        self.assertEqual(jobs[0].description, "Java, Spring, Kafka")

    @patch("job_tracker.fetch_text")
    def test_aston_adapter_reads_embedded_ids_and_cards(self, fetch):
        def response(url, *_args, **_kwargs):
            if url.endswith("/500000001"):
                return ("<html><head><title>Java Developer — вакансия ASTON</title></head>"
                        "<body><h2>Java Developer</h2><p>Требования: Java 17, Spring Boot, Kafka, "
                        "PostgreSQL, Docker и опыт разработки высоконагруженных микросервисов.</p>"
                        "<p>Рекомендовать на вакансию</p></body></html>", url)
            return ("<a href='vacancy/500000001'>Java Developer</a>", url)
        fetch.side_effect = response
        jobs = job_tracker.aston_jobs(
            {"key": "aston", "company": "ASTON", "url": "https://career.test/vacancy",
             "min_expected_jobs": 1, "detail_workers": 1}, 5, 0
        )
        self.assertEqual(jobs[0].title, "Java Developer")
        self.assertIn("Spring Boot", jobs[0].description)

    @patch("job_tracker.fetch_json")
    def test_ertelecom_adapter_loads_listing_and_full_card(self, fetch):
        fetch.side_effect = [
            {"results": [{"id": 42}], "next": None},
            {"id": 42, "name": "Java-разработчик", "city": [{"name": "Москва"}],
             "scope_activity": [{"name": "IT"}], "employment": [{"name": "Гибрид"}],
             "content": "<p>Java 17, Spring Boot, Kafka</p>", "date_update": "31.08.2026"},
        ]
        jobs = job_tracker.ertelecom_jobs(
            {"key": "er", "company": "ЭР-Телеком", "min_expected_jobs": 1}, 5, 0
        )
        self.assertEqual((jobs[0].title, jobs[0].location, jobs[0].team),
                         ("Java-разработчик", "Москва", "IT"))
        self.assertEqual(jobs[0].description, "Java 17, Spring Boot, Kafka")


if __name__ == "__main__":
    unittest.main()
