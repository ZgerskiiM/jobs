import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const resume = request.account?.resume || {};
const profileKey = ['DEVOPS', 'ONE_C_DEVELOPER'].includes(resume.targetRole) ? resume.targetRole : 'JAVA_BACKEND';
const taxonomyNames = {
  JAVA_BACKEND: 'java_backend_vacancy_relevance_ru_v1.json',
  DEVOPS: 'devops_vacancy_relevance_ru_v1.json',
  ONE_C_DEVELOPER: '1c_developer_vacancy_relevance_ru_v1.json',
};
const [config, engineSource] = await Promise.all([
  readFile(path.join(root, 'config', taxonomyNames[profileKey]), 'utf8').then(JSON.parse),
  readFile(path.join(root, 'frontend/scripts/vacancy-scoring.js'), 'utf8'),
]);
const engine = new Function('SCORING_CONFIG', `${engineSource}\nreturn { analyze: scoringAnalyzeVacancy, inflate: scoringInflateFeatures, score: scoringScore, candidateProfile: scoringCandidateProfile }`)(config);
const candidate = engine.candidateProfile(request.account || {});
const scores = [];
for (const item of (request.items || []).slice(0, 4000)) {
  if (!item) continue;
  const vacancyId = `catalog:${String(item.id || '')}`;
  let features = engine.inflate(item.features, vacancyId);
  if (!features && String(item.title || '').trim()) {
    features = await engine.analyze({
      title: String(item.title || '').slice(0, 300),
      description: String(item.description || '').slice(0, 20000),
      posted_at: String(item.posted_at || ''),
    }, vacancyId);
  }
  if (!features) continue;
  const score = engine.score(candidate, features);
  scores.push(request.compact ? { vacancyId: score.vacancyId, scoringVersion: score.scoringVersion, score: score.score, confidence: score.confidence, eligibility: score.eligibility, level: score.level, label: score.label } : score);
}
scores.sort((left, right) => right.score - left.score || Number(right.hardMatchScore || 0) - Number(left.hardMatchScore || 0) || left.vacancyId.localeCompare(right.vacancyId));
process.stdout.write(JSON.stringify({ scoringVersion: scores[0]?.scoringVersion || '2.0.0', taxonomyVersion: String(config.meta?.version || ''), profile: candidate, scores }));
