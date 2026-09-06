import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../..');
const [config, engineSource, fixtures] = await Promise.all([
  readFile(path.join(root, 'config/java_backend_vacancy_relevance_ru_v1.json'), 'utf8').then(JSON.parse),
  readFile(path.join(root, 'frontend/scripts/vacancy-scoring.js'), 'utf8'),
  readFile(path.join(root, 'tests/fixtures/scoring_v2_cases.json'), 'utf8').then(JSON.parse),
]);
const engine = new Function('SCORING_CONFIG', `${engineSource}\nreturn { score: scoringScore, candidateProfile: scoringCandidateProfile }`)(config);

for (const fixture of fixtures) {
  test(`shared scoring fixture: ${fixture.name}`, () => {
    const result = engine.score(fixture.profile, fixture.features);
    assert.equal(result.score, fixture.expected.score);
    assert.equal(result.confidence, fixture.expected.confidence);
    assert.equal(result.eligibility, fixture.expected.eligibility);
    assert.equal(result.hardMatchScore, fixture.expected.hardMatchScore);
    assert.equal(result.vacancyRequirementCoverage, fixture.expected.vacancyRequirementCoverage);
    assert.equal(result.experienceMatch.coefficient, fixture.expected.experienceCoefficient);
    assert.equal(result.seniorityMatch.coefficient, fixture.expected.seniorityCoefficient);
  });
}

test('candidate profile does not silently default an unrelated resume to Java', () => {
  const profile = engine.candidateProfile({ resume: { position: 'Frontend Engineer', skills: [{ name: 'React', confirmed: true }] } });
  assert.equal(profile.targetProfile, 'UNKNOWN');
  assert.equal(profile.targetRole, 'UNKNOWN');
});
