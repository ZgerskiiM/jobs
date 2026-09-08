"""Deterministic, explainable vacancy indexing and scoring.

The module deliberately works on :class:`jobtracker.models.Job` and compact
``VacancyFeatures`` objects.  Raw vacancy descriptions are read only while an
index is built; ranking uses the persisted feature payload exclusively.
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from dataclasses import asdict, dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

from .models import Job, utc_now


DEFAULT_TAXONOMY_PATH = Path(__file__).resolve().parents[1] / "config" / "java_backend_vacancy_relevance_ru_v1.json"
SCORING_ENGINE_VERSION = "2.0.1"
_BOUNDARY = r"A-Za-zА-Яа-яЁё0-9_+#"


def normalize_text(value: str | None) -> str:
    """Normalize RU/EN vacancy text without destroying technology syntax."""
    value = (value or "").replace("ё", "е").replace("Ё", "Е")
    value = value.replace("—", "-").replace("–", "-").replace("−", "-")
    value = re.sub(r"[\u00a0\u2007\u202f]", " ", value)
    return re.sub(r"\s+", " ", value).strip().casefold()


def vacancy_content_hash(vacancy: Job) -> str:
    normalized = normalize_text(vacancy.title) + "\n" + normalize_text(vacancy.description)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class ConceptConfig:
    concept: str
    category: str
    weight: float
    aliases: tuple[str, ...]
    related: Mapping[str, float] = field(default_factory=dict)


@dataclass(frozen=True)
class ContextModifier:
    id: str
    multiplier: float
    patterns: tuple[str, ...]


@dataclass(frozen=True)
class GateConfig:
    id: str
    max_score: float
    reason: str


@dataclass(frozen=True)
class NegativeConfig:
    id: str
    penalty: float
    primary_role_conflict: bool
    patterns: tuple[str, ...]


@dataclass(frozen=True)
class OutputBand:
    minimum: float
    maximum: float
    code: str
    label_ru: str


@dataclass(frozen=True)
class TaxonomyConfig:
    version: str
    category_weights: Mapping[str, float]
    importance_weights: Mapping[str, float]
    default_semantic_match: Mapping[str, float]
    frequency_boost: Mapping[str, Any]
    component_weights: Mapping[str, float]
    context_modifiers: tuple[ContextModifier, ...]
    experience_parsing: Mapping[str, Any]
    seniority_levels: Mapping[str, int]
    seniority_aliases: Mapping[str, tuple[str, ...]]
    seniority_distance: Mapping[int, float]
    gates: tuple[GateConfig, ...]
    negative_signals: tuple[NegativeConfig, ...]
    roles: Mapping[str, tuple[str, ...]]
    concepts: Mapping[str, ConceptConfig]
    output_bands: tuple[OutputBand, ...]
    profile: str = "JAVA_BACKEND"

    @classmethod
    def from_dict(cls, raw: Mapping[str, Any]) -> "TaxonomyConfig":
        meta = raw.get("meta") or {}
        scoring = raw.get("scoring") or {}
        concepts_raw = raw.get("taxonomy") or []
        if isinstance(concepts_raw, Mapping):
            concepts_raw = concepts_raw.get("concepts") or []
        related_match_default = float((scoring.get("defaultSemanticMatch") or {}).get("RELATED_MEDIUM", 0))
        concepts: dict[str, ConceptConfig] = {}
        for item in concepts_raw:
            concept = str(item.get("concept", "")).strip().upper()
            if concept in concepts:
                raise ValueError(f"Concept IDs must be unique: {concept}")
            related = {
                str(entry.get("concept", "")).strip().upper(): float(entry.get("match", related_match_default))
                for entry in item.get("related", [])
            }
            concepts[concept] = ConceptConfig(
                concept=concept,
                category=str(item.get("category", "")).strip(),
                weight=float(item.get("weight", 0)),
                aliases=tuple(normalize_text(alias) for alias in item.get("aliases", []) if normalize_text(alias)),
                related=related,
            )
        modifier_items = []
        for item in raw.get("contextModifiers", []):
            patterns = [normalize_text(pattern) for pattern in item.get("patterns", [])]
            if item.get("id") == "REQUIRED":
                patterns.extend(("обязателен", "обязательна", "обязательны"))
            if item.get("id") == "NOT_REQUIRED":
                patterns.extend(("не обязателен", "не обязательна", "не обязательны"))
            modifier_items.append(ContextModifier(str(item["id"]), float(item["multiplier"]), tuple(dict.fromkeys(patterns))))
        modifiers = tuple(modifier_items)
        seniority = raw.get("seniority") or {}
        roles = {
            str(item.get("concept", "")).upper(): tuple(
                normalize_text(alias) for alias in item.get("aliases", []) if normalize_text(alias)
            )
            for item in raw.get("roles", [])
        }
        config = cls(
            profile=str(meta.get("profile", "JAVA_BACKEND")).upper(),
            version=str(meta.get("version", "")).strip(),
            category_weights={str(k): float(v) for k, v in (scoring.get("categoryWeights") or {}).items()},
            importance_weights={str(k): float(v) for k, v in (scoring.get("importanceWeights") or {}).items()},
            default_semantic_match={str(k): float(v) for k, v in (scoring.get("defaultSemanticMatch") or {}).items()},
            frequency_boost=dict(scoring.get("frequencyBoost") or {}),
            component_weights={str(k): float(v) for k, v in (scoring.get("componentWeights") or {}).items()},
            context_modifiers=modifiers,
            experience_parsing=dict(raw.get("experienceParsing") or {}),
            seniority_levels={str(k): int(v) for k, v in (seniority.get("levels") or {}).items()},
            seniority_aliases={
                str(k): tuple(normalize_text(alias) for alias in aliases if normalize_text(alias))
                for k, aliases in (seniority.get("aliases") or {}).items()
            },
            seniority_distance={int(k): float(v) for k, v in (seniority.get("distanceMatch") or {}).items()},
            gates=tuple(
                GateConfig(str(item["id"]), float(item["maxScore"]), str(item.get("reason", "")))
                for item in raw.get("gates", [])
            ),
            negative_signals=tuple(
                NegativeConfig(
                    str(item["id"]), float(item.get("penalty", 0)),
                    bool(item.get("primaryRoleConflict", False)),
                    tuple(normalize_text(pattern) for pattern in item.get("patterns", [])),
                )
                for item in raw.get("negativeSignals", [])
            ),
            roles=roles,
            concepts=concepts,
            output_bands=tuple(
                OutputBand(float(item["min"]), float(item["max"]), str(item["code"]), str(item.get("labelRu", "")))
                for item in raw.get("outputBands", [])
            ),
        )
        validate_taxonomy(config)
        return config


class TaxonomyConfigLoader:
    """Load and validate taxonomy once; callers can keep the immutable result."""

    @staticmethod
    def load(path: Path = DEFAULT_TAXONOMY_PATH) -> TaxonomyConfig:
        with path.open(encoding="utf-8") as handle:
            return TaxonomyConfig.from_dict(json.load(handle))


def validate_taxonomy(config: TaxonomyConfig) -> None:
    if not config.version:
        raise ValueError("Taxonomy version is required")
    if not config.concepts:
        raise ValueError("Taxonomy must contain concepts")
    if not config.category_weights or not 0.98 <= sum(config.category_weights.values()) <= 1.02:
        raise ValueError("Category weights must approximately sum to 1.0")
    if any(weight <= 0 for weight in config.category_weights.values()):
        raise ValueError("Category weights must be positive")
    if not config.component_weights or not 0.98 <= sum(config.component_weights.values()) <= 1.02:
        raise ValueError("Scoring component weights must approximately sum to 1.0")
    if any(weight < 0 for weight in config.component_weights.values()):
        raise ValueError("Scoring component weights cannot be negative")
    if len(config.concepts) != len(set(config.concepts)):
        raise ValueError("Concept IDs must be unique")
    for concept in config.concepts.values():
        if not concept.aliases:
            raise ValueError(f"Concept {concept.concept} has no aliases")
        if concept.category not in config.category_weights:
            raise ValueError(f"Unknown category for {concept.concept}: {concept.category}")
        for related, coefficient in concept.related.items():
            if related not in config.concepts:
                raise ValueError(f"Unknown related concept: {concept.concept} -> {related}")
            if not 0 <= coefficient <= 1:
                raise ValueError(f"Related coefficient out of range: {concept.concept} -> {related}")
    for modifier in config.context_modifiers:
        if not 0 <= modifier.multiplier <= 1 or not modifier.patterns:
            raise ValueError(f"Invalid context modifier: {modifier.id}")
    for gate in config.gates:
        if not 0 <= gate.max_score <= 100:
            raise ValueError(f"Gate max score out of range: {gate.id}")
    if any(signal.penalty < 0 for signal in config.negative_signals):
        raise ValueError("Negative penalties cannot be negative")
    if not config.output_bands:
        raise ValueError("Output bands are required")


@dataclass(frozen=True)
class RoleMatch:
    primary: str
    match: float
    confidence: float


@dataclass(frozen=True)
class SeniorityMatch:
    level: str
    confidence: float


@dataclass(frozen=True)
class ExtractedConcept:
    concept: str
    match: float
    context_multiplier: float
    confidence: float
    mentions: int


@dataclass(frozen=True)
class DetectedNegativeSignal:
    id: str
    penalty: float
    primary_role_conflict: bool
    matched_text: str = ""


@dataclass(frozen=True)
class VacancyFeatures:
    vacancy_id: str
    taxonomy_version: str
    content_hash: str
    indexed_at: str
    role: RoleMatch
    seniority: SeniorityMatch
    min_experience_years: int | None
    concepts: Mapping[str, ExtractedConcept]
    negative_signals: tuple[DetectedNegativeSignal, ...]
    vacancy_date: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "vacancyId": self.vacancy_id,
            "taxonomyVersion": self.taxonomy_version,
            "contentHash": self.content_hash,
            "indexedAt": self.indexed_at,
            "role": asdict(self.role),
            "seniority": asdict(self.seniority),
            "minExperienceYears": self.min_experience_years,
            "concepts": {key: asdict(value) for key, value in self.concepts.items()},
            "negativeSignals": [asdict(value) for value in self.negative_signals],
            "vacancyDate": self.vacancy_date,
        }

    def to_compact_dict(self) -> dict[str, Any]:
        """Return the browser payload used by the precomputed site index.

        Identity, hashes and timestamps remain in SQLite.  The browser only
        receives fields required by the scorer, encoded with short stable keys
        to keep the catalogue response reasonably small.
        """
        return {
            "v": self.taxonomy_version,
            "r": [self.role.primary, self.role.match, self.role.confidence],
            "s": [self.seniority.level, self.seniority.confidence],
            "e": self.min_experience_years,
            "c": [
                [key, value.match, value.context_multiplier, value.confidence, value.mentions]
                for key, value in sorted(self.concepts.items())
            ],
            "n": [
                [value.id, value.penalty, value.primary_role_conflict, value.matched_text]
                for value in self.negative_signals
            ],
            "d": self.vacancy_date,
        }

    @classmethod
    def from_dict(cls, payload: Mapping[str, Any]) -> "VacancyFeatures":
        role = payload.get("role") or {}
        seniority = payload.get("seniority") or {}
        concepts = {
            key: ExtractedConcept(
                concept=str(value.get("concept", key)), match=float(value.get("match", 0)),
                context_multiplier=float(value.get("contextMultiplier", value.get("context_multiplier", 1))),
                confidence=float(value.get("confidence", 0)), mentions=int(value.get("mentions", 0)),
            )
            for key, value in (payload.get("concepts") or {}).items()
        }
        return cls(
            vacancy_id=str(payload.get("vacancyId", payload.get("vacancy_id", ""))),
            taxonomy_version=str(payload.get("taxonomyVersion", payload.get("taxonomy_version", ""))),
            content_hash=str(payload.get("contentHash", payload.get("content_hash", ""))),
            indexed_at=str(payload.get("indexedAt", payload.get("indexed_at", ""))),
            role=RoleMatch(str(role.get("primary", "UNKNOWN")), float(role.get("match", 0)), float(role.get("confidence", 0))),
            seniority=SeniorityMatch(str(seniority.get("level", "UNKNOWN")), float(seniority.get("confidence", 0))),
            min_experience_years=payload.get("minExperienceYears", payload.get("min_experience_years")),
            concepts=concepts,
            negative_signals=tuple(
                DetectedNegativeSignal(
                    str(value.get("id", "")), float(value.get("penalty", 0)),
                    bool(value.get("primaryRoleConflict", value.get("primary_role_conflict", False))),
                    str(value.get("matchedText", value.get("matched_text", ""))),
                )
                for value in payload.get("negativeSignals", payload.get("negative_signals", []))
            ),
            vacancy_date=str(payload.get("vacancyDate", payload.get("vacancy_date", ""))),
        )


@dataclass(frozen=True)
class CandidateRequirement:
    concept: str
    importance: str


class Importance(str, Enum):
    MUST_HAVE = "MUST_HAVE"
    STRONG_PREFERENCE = "STRONG_PREFERENCE"
    NICE_TO_HAVE = "NICE_TO_HAVE"
    BONUS = "BONUS"


@dataclass(frozen=True)
class CandidateProfile:
    target_role: str
    target_seniority: str
    experience_years: float | None
    requirements: tuple[CandidateRequirement, ...]
    excluded_concepts: frozenset[str] = frozenset()

    @classmethod
    def from_dict(cls, payload: Mapping[str, Any]) -> "CandidateProfile":
        return cls(
            target_role=str(payload.get("targetRole", payload.get("target_role", ""))).upper(),
            target_seniority=str(payload.get("targetSeniority", payload.get("target_seniority", ""))).upper(),
            experience_years=(
                float(payload.get("experienceYears", payload.get("experience_years")))
                if payload.get("experienceYears", payload.get("experience_years")) is not None
                else None
            ),
            requirements=tuple(
                CandidateRequirement(str(item.get("concept", "")).upper(), str(item.get("importance", "BONUS")).upper())
                for item in payload.get("requirements", [])
            ),
            excluded_concepts=frozenset(
                str(value).upper() for value in payload.get("excludedConcepts", payload.get("excluded_concepts", []))
            ),
        )


@dataclass(frozen=True)
class RequirementMatch:
    required: str
    found: str
    coefficient: float


@dataclass(frozen=True)
class PartialMatch:
    required: str
    found: str
    coefficient: float


@dataclass(frozen=True)
class GateResult:
    id: str
    max_score: float
    reason: str


@dataclass(frozen=True)
class ExperienceMatch:
    candidate_years: float | None
    vacancy_min_years: float | None
    coefficient: float | None


@dataclass(frozen=True)
class SeniorityCompatibility:
    candidate: str
    vacancy: str
    coefficient: float | None


@dataclass(frozen=True)
class ScoringResult:
    vacancy_id: str
    scoring_version: str
    score: float
    level: str
    confidence: float
    eligibility: str
    eligibility_reasons: tuple[str, ...]
    hard_match_score: float | None
    vacancy_requirement_coverage: float | None
    category_scores: Mapping[str, float]
    matched: tuple[RequirementMatch, ...]
    partial_matches: tuple[PartialMatch, ...]
    missing_important: tuple[str, ...]
    negative_signals: tuple[DetectedNegativeSignal, ...]
    gates_applied: tuple[GateResult, ...]
    experience_match: ExperienceMatch
    seniority_match: SeniorityCompatibility
    summary: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "vacancyId": self.vacancy_id,
            "scoringVersion": self.scoring_version,
            "score": round(self.score, 2),
            "confidence": round(self.confidence * 100, 2),
            "eligibility": self.eligibility,
            "eligibilityReasons": list(self.eligibility_reasons),
            "level": self.level,
            "hardMatchScore": round(self.hard_match_score, 2) if self.hard_match_score is not None else None,
            "vacancyRequirementCoverage": round(self.vacancy_requirement_coverage * 100, 2) if self.vacancy_requirement_coverage is not None else None,
            "categoryScores": {key: round(value * 100, 2) for key, value in self.category_scores.items()},
            "matched": [asdict(value) for value in self.matched],
            "partialMatches": [asdict(value) for value in self.partial_matches],
            "missingImportant": list(self.missing_important),
            "negativeSignals": [asdict(value) for value in self.negative_signals],
            "gatesApplied": [asdict(value) for value in self.gates_applied],
            "experienceMatch": asdict(self.experience_match),
            "seniorityMatch": asdict(self.seniority_match),
            "summary": self.summary,
        }


@dataclass(frozen=True)
class _Occurrence:
    concept: str
    start: int
    end: int
    alias: str


class _AliasMatcher:
    """Single-pass exact alias matcher with technology-aware boundaries.

    This is a compact trie rather than one regular-expression scan per alias.
    Its runtime is proportional to the vacancy text plus actual matches, which
    keeps a full catalogue rebuild predictable without another dependency.
    """

    _OUTPUT = "\0"

    def __init__(self, aliases: Iterable[tuple[str, str]]):
        self.root: dict[str, Any] = {}
        for concept, alias in aliases:
            node = self.root
            for character in alias:
                node = node.setdefault(character, {})
            node.setdefault(self._OUTPUT, []).append((concept, alias))

    @staticmethod
    def _wordish(character: str) -> bool:
        return bool(character) and (character.isalnum() or character in "_+#")

    def find(self, text: str) -> list[_Occurrence]:
        found: list[_Occurrence] = []
        for start in range(len(text)):
            if start and self._wordish(text[start - 1]):
                continue
            node = self.root
            cursor = start
            while cursor < len(text) and text[cursor] in node:
                node = node[text[cursor]]
                cursor += 1
                for concept, alias in node.get(self._OUTPUT, ()):
                    if cursor == len(text) or not self._wordish(text[cursor]):
                        found.append(_Occurrence(concept, start, cursor, alias))
        return found


def _phrase_pattern(phrase: str) -> re.Pattern[str]:
    return re.compile(
        rf"(?<![{_BOUNDARY}]){re.escape(phrase)}(?![{_BOUNDARY}])",
        re.IGNORECASE,
    )


def _phrase_patterns(phrase: str) -> tuple[re.Pattern[str], ...]:
    patterns = [_phrase_pattern(phrase)]
    # Vacancy prose inflects RU technology nouns ("микросервисы" ->
    # "микросервисов"). Keep the exact alias and add a narrow plural stem
    # fallback; English and product names remain exact matches.
    if re.fullmatch(r"[а-яё]+", phrase) and phrase.endswith(("ы", "и")) and len(phrase) > 5:
        stem = phrase[:-1]
        patterns.append(re.compile(rf"(?<![{_BOUNDARY}]){re.escape(stem)}[а-яё]*(?![{_BOUNDARY}])", re.IGNORECASE))
    return tuple(patterns)


class VacancyFeatureExtractor:
    def __init__(self, config: TaxonomyConfig):
        self.config = config
        self._alias_matcher = _AliasMatcher(
            (concept, alias)
            for concept, item in config.concepts.items()
            for alias in item.aliases
        )
        self._inflected_patterns = tuple(
            (concept, alias, _phrase_patterns(alias)[1])
            for concept, item in config.concepts.items()
            for alias in item.aliases
            if len(_phrase_patterns(alias)) > 1
        )
        self._modifier_patterns = tuple(
            (modifier, tuple((pattern, _phrase_pattern(pattern)) for pattern in modifier.patterns))
            for modifier in config.context_modifiers
        )

    def analyze(self, vacancy: Job) -> VacancyFeatures:
        title = normalize_text(vacancy.title)
        description = normalize_text(vacancy.description)
        text = f"{title}\n{description}".strip()
        occurrences = self._find_occurrences(text)
        concepts: dict[str, ExtractedConcept] = {}
        for concept in self.config.concepts:
            matches = [item for item in occurrences if item.concept == concept]
            if not matches:
                continue
            contexts = [self._context_for(text, item) for item in matches]
            concepts[concept] = ExtractedConcept(
                concept=concept,
                match=1.0,
                context_multiplier=max(context[0] for context in contexts),
                confidence=max(context[1] for context in contexts),
                mentions=len(matches),
            )
        role = self._detect_role(title, description, concepts)
        seniority = self._detect_seniority(title, description)
        negative_signals = self._detect_negative_signals(title, description)
        return VacancyFeatures(
            vacancy_id=str(vacancy.external_id), taxonomy_version=self.config.version,
            content_hash=vacancy_content_hash(vacancy), indexed_at=utc_now(),
            role=role, seniority=seniority,
            min_experience_years=self.extract_experience(text), concepts=concepts,
            negative_signals=tuple(negative_signals), vacancy_date=vacancy.posted_at or vacancy.source_updated_at,
        )

    def extract_experience(self, text: str) -> int | None:
        normalized = normalize_text(text)
        values: list[int] = []
        patterns = self.config.experience_parsing.get("patterns", [])
        for pattern in patterns:
            try:
                compiled = re.compile(pattern, re.IGNORECASE)
            except re.error:
                continue
            for match in compiled.finditer(normalized):
                value = self._relevant_experience_value(normalized, match.start(), match.end(), match.group(1))
                if value is not None:
                    values.append(value)
        word_numbers = {
            normalize_text(str(key)): int(value)
            for key, value in (self.config.experience_parsing.get("wordNumbers") or {}).items()
        }
        words = "|".join(re.escape(word) for word in sorted(word_numbers, key=len, reverse=True))
        if words:
            word_pattern = re.compile(
                rf"(?:от|не менее|минимум)\s+({words})\s+(?:лет|года|год|years?)",
                re.IGNORECASE,
            )
            for match in word_pattern.finditer(normalized):
                window = normalized[max(0, match.start() - 90):min(len(normalized), match.end() + 90)]
                if re.search(r"опыт|experience|commercial|коммерч|разработк|developer|engineer", window, re.IGNORECASE):
                    values.append(word_numbers[normalize_text(match.group(1))])
        return max(values) if values else None

    @staticmethod
    def _relevant_experience_value(text: str, start: int, end: int, raw_value: str) -> int | None:
        window = text[max(0, start - 90):min(len(text), end + 90)]
        if not re.search(r"опыт|experience|commercial|коммерч|разработк|developer|engineer", window, re.IGNORECASE):
            return None
        try:
            return int(raw_value)
        except (TypeError, ValueError):
            return None

    def _find_occurrences(self, text: str) -> list[_Occurrence]:
        found = self._alias_matcher.find(text)
        for concept, alias, pattern in self._inflected_patterns:
            found.extend(_Occurrence(concept, match.start(), match.end(), alias) for match in pattern.finditer(text))
        found.sort(key=lambda item: (item.start, -(item.end - item.start), item.concept))
        retained: list[_Occurrence] = []
        for candidate in sorted(found, key=lambda item: (-(item.end - item.start), item.start, item.concept)):
            overlaps = [item for item in retained if item.start < candidate.end and candidate.start < item.end]
            if not overlaps or all(self._allow_version_overlap(candidate, item) for item in overlaps):
                retained.append(candidate)
        return sorted(retained, key=lambda item: (item.start, item.end, item.concept))

    @staticmethod
    def _allow_version_overlap(first: _Occurrence, second: _Occurrence) -> bool:
        longer, shorter = (first, second) if len(first.alias) >= len(second.alias) else (second, first)
        return longer.concept.startswith(shorter.concept + "_") and longer.concept.rsplit("_", 1)[-1].isdigit()

    def _context_for(self, text: str, occurrence: _Occurrence) -> tuple[float, float]:
        sentence_start = max(text.rfind(mark, 0, occurrence.start) for mark in ".!?\n;" ) + 1
        sentence_end_candidates = [text.find(mark, occurrence.end) for mark in ".!?\n;"]
        sentence_end_candidates = [value for value in sentence_end_candidates if value >= 0]
        sentence_end = min(sentence_end_candidates, default=len(text))
        window_start = max(0, sentence_start - 120)
        window_end = sentence_end
        window = text[window_start:window_end]
        candidates: list[tuple[int, int, ContextModifier]] = []
        for modifier, patterns in self._modifier_patterns:
            for pattern_text, pattern in patterns:
                for match in pattern.finditer(window):
                    global_start = window_start + match.start()
                    global_end = window_start + match.end()
                    if modifier.id == "NEGATED_OR_DEPRECATED" and not (
                        global_end <= occurrence.start and occurrence.start - global_end <= 6
                    ):
                        continue
                    distance = min(abs(occurrence.start - global_end), abs(global_start - occurrence.end))
                    if distance <= 120:
                        candidates.append((distance, -len(pattern_text), modifier))
        if not candidates:
            return 1.0, 1.0
        candidates.sort(key=lambda item: (item[0], item[1]))
        modifier = candidates[0][2]
        return modifier.multiplier, 1.0

    def _detect_role(self, title: str, description: str, concepts: Mapping[str, ExtractedConcept]) -> RoleMatch:
        for role, aliases in self.config.roles.items():
            if any(_phrase_pattern(alias).search(title) for alias in aliases):
                return RoleMatch(role, 0.7 if role == "FULLSTACK" else 1.0, 1.0)
        if self.config.profile == "DEVOPS":
            if re.search(r"devops|sre|platform|инфраструктур|облачн(?:ый|ая) инженер", title):
                return RoleMatch("DEVOPS", 0.9, 0.9)
            signals = sum(concept in concepts for concept in ("LINUX", "KUBERNETES", "DOCKER", "TERRAFORM", "ANSIBLE", "HELM", "PROMETHEUS", "GRAFANA"))
            if signals >= 2 and re.search(r"инфраструктур|эксплуатац|депло|мониторинг|контейнер|облачн|reliability", description):
                return RoleMatch("DEVOPS", 0.75, 0.75)
            return RoleMatch("UNKNOWN", 0.0, 0.4)
        if self.config.profile == "ONE_C_DEVELOPER":
            if re.search(r"(?:1с|1c)\s*(?:программист|разработчик|developer)|программист\s*(?:1с|1c)", title):
                return RoleMatch("ONE_C_DEVELOPER", 0.9, 0.9)
            signals = sum(concept in concepts for concept in ("ONE_C_PLATFORM", "ONE_C_LANGUAGE", "ONE_C_QUERY_LANGUAGE", "CONFIGURATOR", "BSP", "DCS_SKD"))
            if signals >= 2 and re.search(r"(?:1с|1c)|конфигурац|бухгалтер|уч[её]т", description):
                return RoleMatch("ONE_C_DEVELOPER", 0.75, 0.75)
            return RoleMatch("UNKNOWN", 0.0, 0.4)
        backend_aliases = self.config.roles.get("BACKEND", ())
        fullstack_aliases = self.config.roles.get("FULLSTACK", ())
        if any(_phrase_pattern(alias).search(title) for alias in backend_aliases):
            return RoleMatch("BACKEND", 1.0, 1.0)
        if any(_phrase_pattern(alias).search(title) for alias in fullstack_aliases):
            return RoleMatch("FULLSTACK", 0.7, 0.95)
        active_description = description
        active_signals = sum(
            bool(concepts.get(concept))
            for concept in ("SPRING_BOOT", "MICROSERVICES", "REST", "GRPC", "WEBFLUX")
        )
        if re.search(r"java\s+(?:developer|engineer|разработчик)|java-разработчик", title):
            return RoleMatch("BACKEND", 0.8, 0.8)
        if active_signals >= 2 and re.search(r"разработ|сервис|backend|back-end|api|микросервис", active_description):
            return RoleMatch("BACKEND", 0.8, 0.75)
        return RoleMatch("UNKNOWN", 0.0, 0.4)

    def _detect_seniority(self, title: str, description: str) -> SeniorityMatch:
        for source, confidence in ((title, 1.0), (description, 0.85)):
            matches: list[tuple[int, int, str]] = []
            for level, aliases in self.config.seniority_aliases.items():
                for alias in aliases:
                    pattern = _phrase_pattern(alias)
                    if pattern.search(source):
                        matches.append((len(alias), self.config.seniority_levels.get(level, 0), level))
            if matches:
                _, _, level = max(matches, key=lambda item: (item[0], item[1]))
                return SeniorityMatch(level, confidence)
        experience = self.extract_experience(description)
        if experience is not None and experience >= 5:
            return SeniorityMatch("SENIOR", 0.6)
        if experience is not None and experience >= 3:
            return SeniorityMatch("MIDDLE", 0.55)
        return SeniorityMatch("UNKNOWN", 0.35)

    def _detect_negative_signals(self, title: str, description: str) -> list[DetectedNegativeSignal]:
        detected: list[DetectedNegativeSignal] = []
        for signal in self.config.negative_signals:
            match = next((pattern for pattern in signal.patterns if _phrase_pattern(pattern).search(title)), None)
            if match is None:
                for sentence in re.split(r"[.!?\n;]+", description):
                    if re.search(r"в компании|команд\w*|работают|есть|много", sentence) and signal.primary_role_conflict:
                        continue
                    match = next((pattern for pattern in signal.patterns if _phrase_pattern(pattern).search(sentence)), None)
                    if match:
                        break
            if match:
                detected.append(DetectedNegativeSignal(signal.id, signal.penalty, signal.primary_role_conflict, match))
        return detected


class VacancyScorer:
    def __init__(self, config: TaxonomyConfig):
        self.config = config

    def score(self, profile: CandidateProfile | Mapping[str, Any], vacancy: VacancyFeatures) -> ScoringResult:
        if isinstance(profile, Mapping):
            profile = CandidateProfile.from_dict(profile)
        requirements = tuple(profile.requirements)
        for requirement in requirements:
            if requirement.concept.upper() not in self.config.concepts:
                raise ValueError(f"UNKNOWN_CONCEPT: {requirement.concept}")
        category_requirements: dict[str, list[tuple[CandidateRequirement, float, float]]] = {}
        matched: list[RequirementMatch] = []
        partial: list[PartialMatch] = []
        missing: list[str] = []
        hard_total = 0.0
        hard_matched = 0.0
        for requirement in requirements:
            concept = requirement.concept.upper()
            importance = requirement.importance.upper()
            requirement_weight = float(self.config.importance_weights.get(importance, 0))
            if not requirement_weight:
                raise ValueError(f"UNKNOWN_IMPORTANCE: {requirement.importance}")
            semantic, found, relation = self._resolve_match(concept, vacancy.concepts, profile.excluded_concepts)
            effective = 0.0
            if found:
                extracted = vacancy.concepts[found]
                effective = self._effective_match(semantic, extracted)
                if relation is None:
                    matched.append(RequirementMatch(concept, found, round(effective, 4)))
                else:
                    partial.append(PartialMatch(concept, found, round(relation, 4)))
            if effective == 0 and importance in {"MUST_HAVE", "STRONG_PREFERENCE"}:
                missing.append(concept)
            category = self.config.concepts[concept].category
            category_requirements.setdefault(category, []).append((requirement, requirement_weight, effective))
            if importance == "MUST_HAVE":
                hard_total += 1.0
                hard_matched += min(1.0, effective)
        category_scores = {
            category: sum(weight * effective for _, weight, effective in entries) / sum(weight for _, weight, _ in entries)
            for category, entries in category_requirements.items()
        }
        active_weight_sum = sum(self.config.category_weights.get(category, 0) for category in category_scores)
        raw_score = (
            sum(self.config.category_weights.get(category, 0) / active_weight_sum * value for category, value in category_scores.items())
            if active_weight_sum else 0.0
        )
        experience = self._experience_match(profile.experience_years, vacancy.min_experience_years)
        seniority = self._seniority_match(profile.target_seniority, vacancy.seniority.level)
        vacancy_requirement_coverage = self._vacancy_requirement_coverage(profile, vacancy)
        component_weights = self.config.component_weights
        combined_score = (
            component_weights.get("candidateSkillFit", 0) * raw_score
            + component_weights.get("vacancyRequirementCoverage", 0) * (vacancy_requirement_coverage or 0.0)
            + component_weights.get("experience", 0) * (experience.coefficient or 0.0)
            + component_weights.get("seniority", 0) * (seniority.coefficient or 0.0)
        )
        penalties = sum(signal.penalty for signal in vacancy.negative_signals)
        gated_score = combined_score * 100 - penalties
        gates = tuple(self._evaluate_gates(profile, vacancy))
        if gates:
            gated_score = min(gated_score, min(gate.max_score for gate in gates))
        final_score = max(0.0, min(100.0, gated_score))
        confidence = self._confidence(profile, vacancy, vacancy_requirement_coverage, experience, seniority)
        eligibility, eligibility_reasons = self._eligibility(profile, vacancy, gates)
        band = next((band for band in sorted(self.config.output_bands, key=lambda band: band.minimum, reverse=True) if band.minimum <= final_score), self.config.output_bands[-1])
        return ScoringResult(
            vacancy_id=vacancy.vacancy_id, scoring_version=SCORING_ENGINE_VERSION, score=final_score, level=band.code,
            confidence=confidence, eligibility=eligibility, eligibility_reasons=eligibility_reasons,
            hard_match_score=(hard_matched / hard_total * 100 if hard_total else None),
            vacancy_requirement_coverage=vacancy_requirement_coverage,
            category_scores=category_scores, matched=tuple(matched), partial_matches=tuple(partial),
            missing_important=tuple(missing), negative_signals=vacancy.negative_signals,
            gates_applied=gates, experience_match=experience, seniority_match=seniority,
            summary=self._summary(band.code, gates),
        )

    def _resolve_match(self, required: str, concepts: Mapping[str, ExtractedConcept], excluded: Iterable[str]) -> tuple[float, str | None, float | None]:
        if required in excluded:
            return 0.0, None, None
        if required in concepts:
            return concepts[required].match, required, None
        best: tuple[float, str] | None = None
        for found, coefficient in self.config.concepts[required].related.items():
            if found in concepts and (best is None or coefficient > best[0]):
                best = (coefficient, found)
        if best is None:
            return 0.0, None, None
        return best[0], best[1], best[0]

    def _effective_match(self, semantic: float, extracted: ExtractedConcept) -> float:
        boost = self.config.frequency_boost
        frequency_multiplier = 1.0
        if boost.get("enabled") and extracted.mentions >= int(boost.get("minMentionsForBoost", 2)):
            minimum = int(boost.get("minMentionsForBoost", 2))
            maximum = max(minimum, int(boost.get("maxMentionsCounted", minimum)))
            progress = (min(extracted.mentions, maximum) - minimum + 1) / (maximum - minimum + 1)
            frequency_multiplier += float(boost.get("maxBoost", 0)) * progress
        return min(1.0, semantic * extracted.context_multiplier * extracted.confidence * frequency_multiplier)

    def _vacancy_requirement_coverage(self, profile: CandidateProfile, vacancy: VacancyFeatures) -> float | None:
        """Measure how much of the vacancy's stated stack is present in the profile.

        Context multipliers turn preferred and deprecated technologies into a
        proportionally smaller part of the denominator. This prevents a sparse
        candidate profile from receiving a perfect match simply because every
        listed skill was found in the vacancy.
        """
        candidate_concepts = {requirement.concept.upper() for requirement in profile.requirements}
        candidate_concepts.difference_update(profile.excluded_concepts)
        total = 0.0
        covered = 0.0
        for concept, extracted in vacancy.concepts.items():
            concept_weight = self.config.concepts.get(concept, ConceptConfig(concept, "", 0, ())).weight
            weight = concept_weight * extracted.context_multiplier
            if weight <= 0:
                continue
            total += weight
            covered += weight * self._candidate_supports(concept, candidate_concepts)
        return covered / total if total and candidate_concepts else None

    def _confidence(
        self,
        profile: CandidateProfile,
        vacancy: VacancyFeatures,
        coverage: float | None,
        experience: ExperienceMatch,
        seniority: SeniorityCompatibility,
    ) -> float:
        """Return evidence completeness separately from the relevance score."""
        weights = self.config.component_weights
        confidence = 0.0
        if profile.requirements and vacancy.concepts:
            concept_confidence = sum(item.confidence for item in vacancy.concepts.values()) / len(vacancy.concepts)
            confidence += weights.get("candidateSkillFit", 0) * concept_confidence
        if coverage is not None:
            confidence += weights.get("vacancyRequirementCoverage", 0)
        if experience.coefficient is not None:
            confidence += weights.get("experience", 0)
        if seniority.coefficient is not None:
            confidence += weights.get("seniority", 0) * vacancy.seniority.confidence
        return max(0.0, min(1.0, confidence))

    @staticmethod
    def _eligibility(
        profile: CandidateProfile,
        vacancy: VacancyFeatures,
        gates: Sequence[GateResult],
    ) -> tuple[str, tuple[str, ...]]:
        gate_ids = {gate.id for gate in gates}
        reasons = tuple(gate.reason for gate in gates)
        if "WRONG_PRIMARY_ROLE" in gate_ids:
            return "INELIGIBLE", reasons
        if not profile.requirements:
            return "UNCERTAIN", ("В резюме недостаточно подтвержденных навыков для оценки.",)
        if vacancy.role.primary == "UNKNOWN" or not vacancy.concepts:
            return "UNCERTAIN", reasons or ("В описании вакансии недостаточно данных для уверенной оценки.",)
        primary_missing = gate_ids.intersection({"JAVA_PRIMARY_MISSING", "DEVOPS_ROLE_MISSING", "ONE_C_PRIMARY_MISSING"})
        if primary_missing:
            return "INELIGIBLE", reasons
        return "ELIGIBLE", ()

    def _candidate_supports(self, vacancy_concept: str, candidate_concepts: set[str]) -> float:
        if vacancy_concept in candidate_concepts:
            return 1.0
        if any(
            vacancy_concept.startswith(candidate + "_")
            and vacancy_concept.rsplit("_", 1)[-1].isdigit()
            for candidate in candidate_concepts
        ):
            return 1.0
        related = self.config.concepts[vacancy_concept].related
        return max((coefficient for concept, coefficient in related.items() if concept in candidate_concepts), default=0.0)

    def _evaluate_gates(self, profile: CandidateProfile, vacancy: VacancyFeatures) -> list[GateResult]:
        concepts = vacancy.concepts
        java_match = concepts.get("JAVA", ExtractedConcept("JAVA", 0, 0, 0, 0)).match
        framework_match = max(
            concepts.get(concept, ExtractedConcept(concept, 0, 0, 0, 0)).match
            for concept in ("SPRING_BOOT", "SPRING", "QUARKUS", "MICRONAUT")
        )
        wrong_role = any(signal.primary_role_conflict for signal in vacancy.negative_signals)
        must_have = {item.concept.upper() for item in profile.requirements if item.importance.upper() == "MUST_HAVE"}
        def match(concept: str) -> float:
            return concepts.get(concept, ExtractedConcept(concept, 0, 0, 0, 0)).match
        applied: list[GateResult] = []
        for gate in self.config.gates:
            applies = {
                "JAVA_PRIMARY_MISSING": java_match < 0.5,
                "BACKEND_ROLE_MISSING": vacancy.role.match < 0.5,
                "JAVA_BACKEND_FRAMEWORK_MISSING": java_match >= 0.5 and framework_match < 0.5,
                "WRONG_PRIMARY_ROLE": wrong_role,
                "DEVOPS_ROLE_MISSING": vacancy.role.match < 0.5,
                "LINUX_MISSING": max(match("LINUX"), match("UNIX")) < 0.5,
                "KUBERNETES_CRITICAL_MISSING": "KUBERNETES" in must_have and max(match("KUBERNETES"), match("OPENSHIFT") * 0.7) < 0.5,
                "ONE_C_PRIMARY_MISSING": match("ONE_C_PLATFORM") < 0.5 and vacancy.role.match < 0.5,
                "DEVELOPER_ROLE_MISSING": vacancy.role.match < 0.5,
                "QUERY_LANGUAGE_CRITICAL_MISSING": "ONE_C_QUERY_LANGUAGE" in must_have and match("ONE_C_QUERY_LANGUAGE") < 0.5,
            }.get(gate.id, False)
            if applies:
                applied.append(GateResult(gate.id, gate.max_score, gate.reason))
        return applied

    def _experience_match(self, candidate: float | None, minimum: float | None) -> ExperienceMatch:
        if candidate is None or minimum is None:
            return ExperienceMatch(candidate, minimum, None)
        delta = float(candidate) - float(minimum)
        rules = sorted(
            ((int(key.get("candidateDeltaMin", -999999)), float(key.get("coefficient", 0))) for key in self.config.experience_parsing.get("matchRules", [])),
            reverse=True,
        )
        coefficient = next((value for threshold, value in rules if delta >= threshold), 0.0)
        return ExperienceMatch(candidate, minimum, coefficient)

    def _seniority_match(self, candidate: str, vacancy: str) -> SeniorityCompatibility:
        if candidate not in self.config.seniority_levels or vacancy not in self.config.seniority_levels:
            return SeniorityCompatibility(candidate, vacancy, None)
        candidate_level = self.config.seniority_levels.get(candidate, 0)
        vacancy_level = self.config.seniority_levels.get(vacancy, 0)
        distance = abs(candidate_level - vacancy_level)
        coefficient = self.config.seniority_distance.get(distance, self.config.seniority_distance.get(max(self.config.seniority_distance), 0.0))
        return SeniorityCompatibility(candidate, vacancy, coefficient)

    def _summary(self, level: str, gates: Sequence[GateResult]) -> str:
        if gates:
            return "Низкая релевантность: " + "; ".join(gate.reason for gate in gates)
        name = {"DEVOPS": "DevOps/SRE", "ONE_C_DEVELOPER": "1С-разработки"}.get(self.config.profile, "Java Backend")
        return {
            "EXCELLENT_MATCH": f"Отличное совпадение по основному {name} стеку.",
            "STRONG_MATCH": f"Сильное совпадение по основному {name} стеку.",
            "GOOD_MATCH": f"Хорошее совпадение по {name} стеку.",
            "PARTIAL_MATCH": "Частичное совпадение, проверь важные пробелы.",
            "WEAK_MATCH": "Слабое совпадение по заявленным требованиям.",
        }.get(level, "Вакансия почти не соответствует заявленным требованиям.")


class VacancyRankingService:
    def __init__(self, scorer: VacancyScorer):
        self.scorer = scorer

    def rank(self, profile: CandidateProfile | Mapping[str, Any], vacancies: Iterable[VacancyFeatures]) -> list[ScoringResult]:
        features = list(vacancies)
        scored = [self.scorer.score(profile, vacancy) for vacancy in features]
        dates = {vacancy.vacancy_id: vacancy.vacancy_date for vacancy in features}

        def date_key(value: str) -> float:
            try:
                return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
            except (TypeError, ValueError, OverflowError):
                return float("-inf")

        return sorted(
            scored,
            key=lambda result: (
                -result.score,
                -(result.hard_match_score if result.hard_match_score is not None else -1.0),
                -date_key(dates.get(result.vacancy_id, "")),
                result.vacancy_id,
            ),
        )


class VacancyFeatureRepository:
    """SQLite repository for the compact feature index."""

    def __init__(self, db: sqlite3.Connection):
        self.db = db

    def save(self, job: Job, features: VacancyFeatures) -> None:
        self.db.execute(
            """INSERT INTO vacancy_feature_index
               (source_key, external_id, taxonomy_version, indexed_at, content_hash, features)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(source_key, external_id) DO UPDATE SET
                 taxonomy_version=excluded.taxonomy_version, indexed_at=excluded.indexed_at,
                 content_hash=excluded.content_hash, features=excluded.features""",
            (job.source_key, job.external_id, features.taxonomy_version, features.indexed_at,
             features.content_hash, json.dumps(features.to_dict(), ensure_ascii=False, sort_keys=True)),
        )

    def get(self, job: Job) -> VacancyFeatures | None:
        row = self.db.execute(
            "SELECT features FROM vacancy_feature_index WHERE source_key=? AND external_id=?",
            (job.source_key, job.external_id),
        ).fetchone()
        return VacancyFeatures.from_dict(json.loads(row["features"] if isinstance(row, sqlite3.Row) else row[0])) if row else None

    def needs_reindex(self, job: Job, taxonomy_version: str) -> bool:
        row = self.db.execute(
            "SELECT taxonomy_version, content_hash FROM vacancy_feature_index WHERE source_key=? AND external_id=?",
            (job.source_key, job.external_id),
        ).fetchone()
        return not row or row["taxonomy_version"] != taxonomy_version or row["content_hash"] != vacancy_content_hash(job)

    def all_active(self) -> list[VacancyFeatures]:
        rows = self.db.execute(
            "SELECT features FROM vacancy_feature_index i JOIN jobs j USING (source_key, external_id) "
            "WHERE j.active=1 AND j.stale=0 ORDER BY j.first_seen_at DESC"
        ).fetchall()
        return [VacancyFeatures.from_dict(json.loads(row["features"] if isinstance(row, sqlite3.Row) else row[0])) for row in rows]


def job_from_row(row: Mapping[str, Any]) -> Job:
    return Job(
        source_key=row["source_key"], external_id=row["external_id"], company=row["company"], title=row["title"],
        location=row["location"], team=row["team"], workplace_type=row["workplace_type"], description=row["description"],
        url=row["url"], posted_at=row["posted_at"], source_updated_at=row["source_updated_at"],
    )


class VacancyIndexingService:
    def __init__(self, config: TaxonomyConfig, repository: VacancyFeatureRepository):
        self.config = config
        self.repository = repository
        self.extractor = VacancyFeatureExtractor(config)

    def index(self, job: Job, force: bool = False) -> tuple[VacancyFeatures, bool]:
        if not force and not self.repository.needs_reindex(job, self.config.version):
            existing = self.repository.get(job)
            if existing is not None:
                return existing, False
        features = self.extractor.analyze(job)
        self.repository.save(job, features)
        return features, True

    def reindex_outdated(self, jobs: Iterable[Job] | None = None, force: bool = False) -> int:
        if jobs is None:
            jobs = (
                job_from_row(row)
                for row in self.repository.db.execute("SELECT * FROM jobs WHERE active=1 AND stale=0").fetchall()
            )
        count = 0
        for job in jobs:
            _, changed = self.index(job, force=force)
            count += int(changed)
        return count


def analyze(vacancy: Job, config: TaxonomyConfig | None = None) -> VacancyFeatures:
    """Convenience form of the extraction contract."""
    return VacancyFeatureExtractor(config or TaxonomyConfigLoader.load()).analyze(vacancy)


def score(
    profile: CandidateProfile | Mapping[str, Any], vacancy: VacancyFeatures,
    config: TaxonomyConfig | None = None,
) -> ScoringResult:
    """Convenience form of the scoring contract."""
    return VacancyScorer(config or TaxonomyConfigLoader.load()).score(profile, vacancy)


def rank(
    profile: CandidateProfile | Mapping[str, Any], vacancies: Iterable[VacancyFeatures],
    config: TaxonomyConfig | None = None,
) -> list[ScoringResult]:
    """Convenience form of the ranking contract."""
    return VacancyRankingService(VacancyScorer(config or TaxonomyConfigLoader.load())).rank(profile, vacancies)

