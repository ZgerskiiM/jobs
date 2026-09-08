import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
const [config, engineSource, fixtures] = await Promise.all([
  readFile(path.join(root, 'config/java_backend_vacancy_relevance_ru_v1.json'), 'utf8').then(JSON.parse),
  readFile(path.join(root, 'frontend/scripts/vacancy-scoring.js'), 'utf8'),
  readFile(path.join(root, 'tests/fixtures/scoring_v2_cases.json'), 'utf8').then(JSON.parse),
]);
const engine = new Function('SCORING_CONFIG', `${engineSource}\nreturn { score: scoringScore, candidateProfile: scoringCandidateProfile }`)(config);

test('missing experience stays unknown while explicit zero stays zero', () => {
  for (const value of [null, undefined, '', ' ', false, -1, 'unknown']) {
    assert.equal(engine.candidateProfile({ resume: { experienceYears: value } }).experienceYears, null);
  }
  assert.equal(engine.candidateProfile({ resume: { experienceYears: 0 } }).experienceYears, 0);
  assert.equal(engine.candidateProfile({ resume: { experienceYears: 1.5 } }).experienceYears, 1.5);
});

test('candidate skills prefer the specific alias over the parent concept', () => {
  const result = engine.candidateProfile({ resume: { position: 'Java Developer', skills: [{ name: 'Spring Boot' }, { name: 'Java 17' }] } });
  assert.deepEqual(result.requirements.map(item => item.concept), ['SPRING_BOOT', 'JAVA_17']);
});

test('role inference prioritizes job title and ignores rejected or substring signals', () => {
  for (const [position, expected] of [['JavaScript Developer', 'UNKNOWN'], ['Java Developer', 'JAVA_BACKEND'], ['DevOps Engineer', 'DEVOPS'], ['Разработчик 1С', 'ONE_C_DEVELOPER']]) {
    assert.equal(engine.candidateProfile({ resume: { position, skills: [] } }).targetProfile, expected);
  }
  assert.equal(engine.candidateProfile({ resume: { position: 'Engineer', skills: [{ name: 'Linux', confirmed: false }, { name: 'Docker', confirmed: false }] } }).targetProfile, 'UNKNOWN');
});

test('fractional scores between configured band endpoints keep their correct label', () => {
  const changed = structuredClone(config);
  changed.scoring.componentWeights = { candidateSkillFit: 0.54995 };
  const scorer = new Function('SCORING_CONFIG', `${engineSource}\nreturn scoringScore`)(changed);
  const fixture = fixtures[0];
  const result = scorer({ ...fixture.profile, requirements: [{ concept: 'JAVA', importance: 'MUST_HAVE' }] }, fixture.features);
  assert.equal(result.level, 'WEAK_MATCH');
});

test('API bridge selects the inferred DevOps taxonomy before mapping skills', () => {
  const response = JSON.parse(execFileSync(process.execPath, [path.join(root, 'frontend/scripts/scoring-api.mjs')], {
    input: JSON.stringify({ account: { resume: { position: 'DevOps Engineer', skills: [{ name: 'Linux' }, { name: 'Terraform' }] } }, items: [{ id: 1, title: 'DevOps Engineer', description: 'Linux, Terraform.' }] }),
    encoding: 'utf8',
  }));
  assert.equal(response.profile.targetProfile, 'DEVOPS');
  assert.deepEqual(response.profile.requirements.map(item => item.concept), ['LINUX', 'TERRAFORM']);
  assert.equal(response.scores[0].scoringVersion, '2.0.1');
  assert.equal(response.scores[0].experienceMatch.coefficient, null);
});

test('missing skills follow vacancy-to-candidate relations and exclusions', () => {
  const changed = structuredClone(config);
  changed.taxonomy.find(item => item.concept === 'POSTGRESQL').related = [{ concept: 'MYSQL', match: 0.65 }];
  changed.taxonomy.find(item => item.concept === 'MYSQL').related = [];
  const scorer = new Function('SCORING_CONFIG', `${engineSource}\nreturn scoringScore`)(changed);
  const features = structuredClone(fixtures[0].features);
  features.concepts = { POSTGRESQL: { match: 1, contextMultiplier: 1, confidence: 1, mentions: 1 } };
  const profile = { ...fixtures[0].profile, requirements: [{ concept: 'MYSQL', importance: 'STRONG_PREFERENCE' }] };
  assert.deepEqual(scorer(profile, features).vacancyMissing, []);
  assert.deepEqual(scorer({ ...profile, excludedConcepts: ['MYSQL'] }, features).vacancyMissing, ['POSTGRESQL']);
});

for (const fixture of fixtures) {
  test(`shared scoring fixture: ${fixture.name}`, async () => {
    const fixtureConfig = fixture.taxonomy ? JSON.parse(await readFile(path.join(root, 'config', fixture.taxonomy), 'utf8')) : config;
    const fixtureEngine = new Function('SCORING_CONFIG', `${engineSource}\nreturn { score: scoringScore }`)(fixtureConfig);
    const result = fixtureEngine.score(fixture.profile, fixture.features);
    assert.equal(result.score, fixture.expected.score);
    assert.equal(result.confidence, fixture.expected.confidence);
    assert.equal(result.eligibility, fixture.expected.eligibility);
    assert.equal(result.hardMatchScore, fixture.expected.hardMatchScore);
    assert.equal(result.vacancyRequirementCoverage, fixture.expected.vacancyRequirementCoverage);
    assert.equal(result.experienceMatch.coefficient, fixture.expected.experienceCoefficient);
    assert.equal(result.seniorityMatch.coefficient, fixture.expected.seniorityCoefficient);
    if (fixture.expected.gates) assert.deepEqual(result.gatesApplied.map(gate => gate.id), fixture.expected.gates);
  });
}

test('candidate profile does not silently default an unrelated resume to Java', () => {
  const profile = engine.candidateProfile({ resume: { position: 'Frontend Engineer', skills: [{ name: 'React', confirmed: true }] } });
  assert.equal(profile.targetProfile, 'UNKNOWN');
  assert.equal(profile.targetRole, 'UNKNOWN');
});

test('reports vacancy requirements missing from the candidate resume', () => {
  const result = engine.score({
    targetRole: 'BACKEND',
    targetSeniority: 'SENIOR',
    experienceYears: 5,
    requirements: [{ concept: 'JAVA', importance: 'MUST_HAVE' }],
  }, {
    vacancyId: 'fixture:missing-vacancy-requirements',
    role: { primary: 'BACKEND', match: 1, confidence: 1 },
    seniority: { level: 'SENIOR', confidence: 1 },
    minExperienceYears: 3,
    concepts: {
      JAVA: { concept: 'JAVA', match: 1, contextMultiplier: 1, confidence: 1, mentions: 1 },
      KAFKA: { concept: 'KAFKA', match: 1, contextMultiplier: 1, confidence: 1, mentions: 1 },
      CLICKHOUSE: { concept: 'CLICKHOUSE', match: 1, contextMultiplier: 1, confidence: 1, mentions: 1 },
    },
    negativeSignals: [],
  });
  assert.deepEqual(result.vacancyMissing, ['KAFKA', 'CLICKHOUSE']);
});

