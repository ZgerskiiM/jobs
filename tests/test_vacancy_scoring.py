import json
import tempfile
import unittest
from pathlib import Path

from jobtracker.models import Job
from jobtracker.storage import connect_db
from jobtracker.vacancy_scoring import (
    CandidateProfile,
    CandidateRequirement,
    TaxonomyConfigLoader,
    VacancyFeatureExtractor,
    VacancyFeatureRepository,
    VacancyIndexingService,
    VacancyRankingService,
    VacancyScorer,
)


ROOT = Path(__file__).resolve().parents[1]
TAXONOMY = ROOT / "config" / "java_backend_vacancy_relevance_ru_v1.json"


def make_job(title: str, description: str, external_id: str = "1", posted_at: str = "2026-09-01") -> Job:
    return Job(
        source_key="test", external_id=external_id, company="Acme", title=title,
        location="Remote", team="Engineering", workplace_type="remote",
        description=description, url=f"https://example.test/{external_id}",
        posted_at=posted_at, source_updated_at="",
    )


def profile(*requirements: tuple[str, str], years: int | None = 5) -> CandidateProfile:
    return CandidateProfile(
        target_role="BACKEND", target_seniority="SENIOR", experience_years=years,
        requirements=tuple(CandidateRequirement(concept, importance) for concept, importance in requirements),
    )


class VacancyScoringTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.config = TaxonomyConfigLoader.load(TAXONOMY)
        cls.extractor = VacancyFeatureExtractor(cls.config)
        cls.scorer = VacancyScorer(cls.config)

    def test_mixed_ru_en_and_longest_alias(self):
        features = self.extractor.analyze(make_job(
            "Senior Java Developer",
            "Разработка микросервисов на Java 17 и Spring Boot. Используем Kafka, PostgreSQL, Docker и Kubernetes.",
        ))
        self.assertEqual(features.role.primary, "BACKEND")
        self.assertEqual(features.seniority.level, "SENIOR")
        self.assertEqual(features.min_experience_years, None)
        self.assertTrue({"JAVA", "JAVA_17", "SPRING_BOOT", "MICROSERVICES", "KAFKA", "POSTGRESQL", "DOCKER", "KUBERNETES"}.issubset(features.concepts))
        self.assertNotIn("SPRING", features.concepts)

    def test_context_modifiers_and_migration_direction(self):
        features = self.extractor.analyze(make_job(
            "Senior Java Backend Developer",
            "Java и Spring Boot обязательны. Опыт Kafka будет плюсом. Kubernetes не обязателен. "
            "Мигрируем с RabbitMQ на Kafka.",
        ))
        self.assertAlmostEqual(features.concepts["KAFKA"].context_multiplier, 0.5)
        self.assertAlmostEqual(features.concepts["KUBERNETES"].context_multiplier, 0.15)
        self.assertAlmostEqual(features.concepts["RABBITMQ"].context_multiplier, 0.05)
        self.assertAlmostEqual(features.concepts["JAVA"].context_multiplier, 1.0)

    def test_duplicate_mentions_do_not_inflate_concept(self):
        features = self.extractor.analyze(make_job("Java Developer", "Java Java Java Java. Spring Boot."))
        result = self.scorer.score(profile(("JAVA", "MUST_HAVE")), features)
        self.assertGreaterEqual(features.concepts["JAVA"].mentions, 4)
        self.assertEqual(result.matched[0].coefficient, 1.0)

    def test_related_match_is_partial_and_not_recursive(self):
        partial = self.scorer.score(profile(("POSTGRESQL", "STRONG_PREFERENCE")), self.extractor.analyze(make_job("Java Backend", "Java, Spring Boot, MySQL.")))
        self.assertEqual(partial.partial_matches[0].found, "MYSQL")
        self.assertAlmostEqual(partial.partial_matches[0].coefficient, 0.65)
        cloud = self.scorer.score(profile(("AWS", "MUST_HAVE")), self.extractor.analyze(make_job("Java Backend", "Java, Spring Boot, Azure.")))
        self.assertAlmostEqual(cloud.partial_matches[0].coefficient, 0.6)

    def test_gates_and_negative_primary_role(self):
        wrong = self.extractor.analyze(make_job("Android Developer", "Java, Kotlin."))
        result = self.scorer.score(profile(("JAVA", "MUST_HAVE")), wrong)
        self.assertEqual(wrong.negative_signals[0].id, "ANDROID_PRIMARY")
        self.assertLessEqual(result.score, 20)
        self.assertIn("WRONG_PRIMARY_ROLE", {gate.id for gate in result.gates_applied})

    def test_company_technology_list_is_not_primary_conflict(self):
        features = self.extractor.analyze(make_job(
            "Senior Java Backend Developer",
            "В компании работают Android, iOS, frontend и backend команды. "
            "Вы будете разрабатывать Java сервисы на Spring Boot.",
        ))
        self.assertEqual(features.role.primary, "BACKEND")
        self.assertNotIn("ANDROID_PRIMARY", {signal.id for signal in features.negative_signals})
        self.assertNotIn("FRONTEND_PRIMARY", {signal.id for signal in features.negative_signals})

    def test_experience_ru_en_words_and_coefficients(self):
        self.assertEqual(self.extractor.analyze(make_job("Java Developer", "Коммерческий опыт Java-разработки от 3 лет.")).min_experience_years, 3)
        self.assertEqual(self.extractor.analyze(make_job("Java Developer", "At least 5 years of commercial Java development experience.")).min_experience_years, 5)
        self.assertEqual(self.extractor.analyze(make_job("Java Developer", "Опыт коммерческой разработки не менее трех лет.")).min_experience_years, 3)
        vacancy = self.extractor.analyze(make_job("Java Developer", "Опыт от 5 лет."))
        self.assertEqual(self.scorer.score(profile(("JAVA", "MUST_HAVE"), years=4), vacancy).experience_match.coefficient, 0.8)
        self.assertEqual(self.scorer.score(profile(("JAVA", "MUST_HAVE"), years=5), vacancy).experience_match.coefficient, 1.0)

    def test_hard_match_and_category_renormalization(self):
        features = self.extractor.analyze(make_job("Senior Java Backend Developer", "Java, Kafka."))
        result = self.scorer.score(profile(("JAVA", "MUST_HAVE"), ("SPRING_BOOT", "MUST_HAVE"), ("KAFKA", "NICE_TO_HAVE")), features)
        self.assertAlmostEqual(result.hard_match_score, 50.0)
        self.assertEqual(set(result.category_scores), {"LANGUAGE_CORE", "FRAMEWORK", "MESSAGING"})
        self.assertNotIn("KAFKA", result.missing_important)
        self.assertIn("SPRING_BOOT", result.missing_important)

    def test_reindex_by_content_and_taxonomy_version(self):
        with tempfile.TemporaryDirectory() as directory:
            db = connect_db(Path(directory) / "jobs.sqlite3")
            repository = VacancyFeatureRepository(db)
            service = VacancyIndexingService(self.config, repository)
            job = make_job("Java Backend Developer", "Java, Spring Boot.")
            _, changed = service.index(job)
            self.assertTrue(changed)
            _, changed = service.index(job)
            self.assertFalse(changed)
            changed_job = make_job(job.title, job.description + " Kafka.")
            self.assertTrue(repository.needs_reindex(changed_job, self.config.version))
            db.execute("UPDATE vacancy_feature_index SET taxonomy_version='0.9.0'")
            self.assertTrue(repository.needs_reindex(job, self.config.version))
            db.close()

    def test_compact_features_keep_every_scoring_signal(self):
        features = self.extractor.analyze(make_job(
            "Senior Java Backend Developer",
            "Java 17 и Spring Boot обязательны. Kafka будет плюсом. Опыт от 4 лет.",
        ))
        compact = features.to_compact_dict()
        self.assertEqual(compact["v"], self.config.version)
        self.assertEqual(compact["r"][0], "BACKEND")
        self.assertEqual(compact["s"][0], "SENIOR")
        self.assertEqual(compact["e"], 4)
        concepts = {item[0]: item for item in compact["c"]}
        self.assertTrue({"JAVA", "JAVA_17", "SPRING_BOOT", "KAFKA"}.issubset(concepts))
        self.assertEqual(concepts["KAFKA"][2], 0.5)

    def test_stable_ranking_uses_hard_match_then_date_then_id(self):
        first = self.extractor.analyze(make_job("Java Backend", "Java.", "a", "2026-09-01"))
        second = self.extractor.analyze(make_job("Java Backend", "Java, Spring Boot.", "b", "2026-08-01"))
        ranked = VacancyRankingService(self.scorer).rank(profile(("JAVA", "MUST_HAVE"), ("SPRING_BOOT", "MUST_HAVE")), [first, second])
        self.assertEqual([item.vacancy_id for item in ranked], ["b", "a"])

    def test_taxonomy_validation_rejects_unknown_related_concept(self):
        raw = json.loads(TAXONOMY.read_text(encoding="utf-8"))
        raw["taxonomy"][0]["related"] = [{"concept": "NOPE", "match": 0.5}]
        with self.assertRaises(ValueError):
            self.config.from_dict(raw)


if __name__ == "__main__":
    unittest.main()
