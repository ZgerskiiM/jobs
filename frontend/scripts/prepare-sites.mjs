import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dist = join(root, 'dist')
const client = join(dist, 'client')
const server = join(dist, 'server')
await rm(client, { recursive: true, force: true })
await mkdir(client, { recursive: true })
for (const entry of await readdir(dist, { withFileTypes: true })) {
  if (entry.name === 'client' || entry.name === 'server' || entry.name === '.openai') continue
  await cp(join(dist, entry.name), join(client, entry.name), { recursive: true })
}
await mkdir(server, { recursive: true })
const taxonomies = {
  JAVA_BACKEND: JSON.parse(await readFile(join(root, '..', 'config', 'java_backend_vacancy_relevance_ru_v1.json'), 'utf8')),
  DEVOPS: JSON.parse(await readFile(join(root, '..', 'config', 'devops_vacancy_relevance_ru_v1.json'), 'utf8')),
}
const scoring = await readFile(join(root, 'scripts', 'vacancy-scoring.js'), 'utf8')
const worker = await readFile(join(root, 'scripts', 'site-worker.js'), 'utf8')
await writeFile(join(server, 'index.js'), `const SCORING_CONFIGS = ${JSON.stringify(taxonomies)}
function createScoringEngine(SCORING_CONFIG) {
${scoring}
return { config: SCORING_CONFIG, analyze: scoringAnalyzeVacancy, compact: scoringCompactFeatures, inflate: scoringInflateFeatures, score: scoringScore, candidateProfile: scoringCandidateProfile, hash: scoringHash }
}
const SCORING_ENGINES = Object.fromEntries(Object.entries(SCORING_CONFIGS).map(([profile, config]) => [profile, createScoringEngine(config)]))
${worker}`)
await mkdir(join(dist, '.openai'), { recursive: true })
await cp(join(root, '..', '.openai', 'hosting.json'), join(dist, '.openai', 'hosting.json'))
