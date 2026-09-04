# Vacancy scoring engine

The engine is implemented in `jobtracker.vacancy_scoring` and uses the existing
`Job` entity plus the SQLite storage layer. It has no LLM or external AI
dependency.

## Index vacancies

The taxonomy is loaded once from
`config/java_backend_vacancy_relevance_ru_v1.json`. Build or refresh the
feature index for active vacancies with:

```powershell
python job_tracker.py --db data/jobs.sqlite3 reindex
```

The command only re-indexes a vacancy when its normalized title/description
hash changed, its feature index is missing, or the taxonomy version changed.
Use `--force` for a full rebuild, or `--taxonomy path/to/taxonomy.json` for a
different validated taxonomy.

`site-data` runs the same incremental check automatically and embeds a compact
feature payload into every exported vacancy. Exact aliases are found in one
text pass with a trie, then longest-match resolution, technology-aware token
boundaries, context modifiers, role/seniority/experience rules and negative
signals are applied. The hosted Worker inflates this payload and only performs
candidate-specific scoring; it does not scan catalogue descriptions during a
page request. Runtime-only sources without a payload (for example a fresh HH
response) retain the D1-backed lazy-index fallback.

## Score and rank in Python

```python
from jobtracker.vacancy_scoring import (
    CandidateProfile, CandidateRequirement, TaxonomyConfigLoader,
    VacancyFeatureRepository, VacancyRankingService, VacancyScorer,
)
from jobtracker.storage import connect_db

config = TaxonomyConfigLoader.load()
profile = CandidateProfile(
    target_role="BACKEND",
    target_seniority="SENIOR",
    experience_years=5,
    requirements=(
        CandidateRequirement("JAVA", "MUST_HAVE"),
        CandidateRequirement("SPRING_BOOT", "MUST_HAVE"),
        CandidateRequirement("KAFKA", "STRONG_PREFERENCE"),
    ),
)

db = connect_db("data/jobs.sqlite3")
features = VacancyFeatureRepository(db).all_active()
ranked = VacancyRankingService(VacancyScorer(config)).rank(profile, features)
for result in ranked[:20]:
    print(result.to_dict())
```

`VacancyFeatureExtractor.analyze(job)` is the only stage that reads raw
vacancy text. `VacancyScorer` and `VacancyRankingService` consume only
`VacancyFeatures`, so changing a candidate profile does not re-parse 3,000
descriptions.

## Update taxonomy

Edit the JSON aliases, relations, context modifiers, penalties, gates, or
weights and increment `meta.version`. A subsequent `reindex` automatically
marks all old feature records as outdated. Config validation rejects duplicate
concept IDs, missing aliases, unknown relations, invalid multipliers, broken
category weights, and invalid gate/penalty ranges.
