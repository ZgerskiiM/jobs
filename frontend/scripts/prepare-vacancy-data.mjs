import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const sourcePath = path.resolve(process.cwd(), '../data/vacancies.js');
// Keep generated static data outside /api: the Vite dev proxy reserves that
// prefix for the Django backend.
const outputPath = path.resolve(process.cwd(), 'public/vacancies.json');
const progressPath = path.resolve(process.cwd(), '../COMPANIES_PROGRESS.md');
const configPath = path.resolve(process.cwd(), '../config.direct.json');
const topCompaniesPath = path.resolve(process.cwd(), '../companies.top50.json');
const ozonSnapshotPath = path.resolve(process.cwd(), 'data/ozon-tech-vacancies.json');
const taxonomyPaths = {
  JAVA_BACKEND: path.resolve(process.cwd(), '../config/java_backend_vacancy_relevance_ru_v1.json'),
  DEVOPS: path.resolve(process.cwd(), '../config/devops_vacancy_relevance_ru_v1.json'),
  ONE_C_DEVELOPER: path.resolve(process.cwd(), '../config/1c_developer_vacancy_relevance_ru_v1.json'),
};
const scoringEnginePath = path.resolve(process.cwd(), 'scripts/vacancy-scoring.js');
const source = await readFile(sourcePath, 'utf8');
const progress = await readFile(progressPath, 'utf8');
const directConfig = JSON.parse(await readFile(configPath, 'utf8'));
const topCompanies = JSON.parse(await readFile(topCompaniesPath, 'utf8'));
const ozonSnapshot = JSON.parse(await readFile(ozonSnapshotPath, 'utf8'));
const scoringEngineSource = await readFile(scoringEnginePath, 'utf8');
const taxonomies = Object.fromEntries(await Promise.all(Object.entries(taxonomyPaths).map(async ([profile, taxonomyPath]) => [profile, JSON.parse(await readFile(taxonomyPath, 'utf8'))])));
const scoringEngines = Object.fromEntries(Object.entries(taxonomies).map(([profile, taxonomy]) => [profile, new Function(
  'SCORING_CONFIG',
  `${scoringEngineSource}\nreturn { analyze: scoringAnalyzeVacancy, compact: scoringCompactFeatures }`,
)(taxonomy)]));
const additionalCareerUrls = new Map([
  ['Московская биржа (MOEX)', 'https://career.moex.com/'],
  ['ЮMoney', 'https://jobs.yoomoney.ru/'],
  ['Orion soft', 'https://career.orionsoft.ru/vacancy'],
  ['Рексофт (Reksoft)', 'https://career.reksoft.com/'],
  ['Финам / FINAM IT', 'https://it.finam.ru/vacancies/all'],
  ['Криптонит', 'https://kryptonite.ru/career/'],
  ['Учи.ру', 'https://uchi.ru/career'],
  ['Innostage', 'https://promo.innostage-group.ru/'],
  ['KODE', 'https://kode.ru/career'],
  ['Picodata', 'https://picodata.io/careers/'],
  ['Mindbox', 'https://jobs.mindbox.ru/vacancies/'],
  ['ГАРАНТ', 'https://www.garant.ru/company/vacancy/'],
  ['МойСклад / Lognex', 'https://www.moysklad.ru/company/vacancies/'],
  ['NtechLab', 'https://ntechlab.com/career/'],
  ['Цифра / Zyfra', 'https://zyfra.com/career/'],
  ['BellSoft', 'https://bell-sw.com/company/careers/'],
  ['Сравни', 'https://www.sravni.ru/company/vacancies/'],
  ['Банки.ру', 'https://www.banki.ru/about/vacancies/'],
  ['R-Style Softlab', 'https://www.softlab.ru/career/'],
  ['Туту', 'https://c.tutu.ru/hr/vacancies'],
  ['UserGate', 'https://usergate.com/company/career#vacancies-block'],
  ['DNS Технологии', 'https://www.dns-tech.ru/vacancies'],
  ['Информзащита', 'https://www.infosec.ru/job/vacancy/'],
  ['InfoWatch', 'https://www.infowatch.ru/o-kompanii-infowatch/career/vakansii'],
  ['Код Безопасности', 'https://www.securitycode.ru/company/hr/'],
  ['Dr.Web', 'https://company.drweb.ru/careers/'],
  ['Directum', 'https://career.directum.ru/vacancy'],
  ['ELMA 365', 'https://elma365.com/ru/company/careers/#category-11'],
  ['SportMaster Lab', 'https://job.sportmaster.ru/vacancies/?category=96'],
  ['Aquarius', 'https://www.aq.ru/career/vacancies'],
  ['IVA Technologies', 'https://iva.ru/ru/karera/'],
  ['Auriga', 'https://hr.auriga.ru/'],
  ['Р-Софт', 'https://r-soft.org/vacancies/'],
  ['Digital Clouds', 'https://dclouds.ru/about/vacancy'],
  ['ITFB Group', 'https://itfbgroup.ru/career'],
]);
const meta = source.match(/window\.VACANCIES_META\s*=\s*(\{.*?\});/s)?.[1];
const vacancies = source.match(/window\.VACANCIES\s*=\s*(\[.*\])\s*;\s*$/s)?.[1];

if (!meta || !vacancies) throw new Error('Не удалось прочитать data/vacancies.js');

const companies = [];
const seen = new Set();
for (const line of progress.split(/\r?\n/)) {
  const match = line.match(/^- \[[x!]\] (\d+)\. ([^—]+?)\s+—/);
  if (!match || seen.has(match[2].trim())) continue;
  const name = match[2].trim();
  const inlineUrl = line.match(/https?:\/\/[^\s]+/)?.[0]?.replace(/[),.;]+$/, '') || null;
  seen.add(name);
  companies.push({ rank: Number(match[1]), name, career_url: inlineUrl });
}

const careerUrls = new Map();
for (const item of [
  ...directConfig.sources,
  ...topCompanies.companies,
  ...[...additionalCareerUrls.entries()].map(([company, url]) => ({ company, career_url: url })),
]) {
  const name = item.company;
  const url = item.url || item.career_url || additionalCareerUrls.get(name);
  if (name && url && !careerUrls.has(name)) careerUrls.set(name, url);
}

const registry = companies.map((company) => ({
  ...company,
  career_url: company.career_url || careerUrls.get(company.name) || null,
}));

const vacancyRecords = [
  ...JSON.parse(vacancies),
  ...ozonSnapshot.map((item) => ({
    id: item.id,
    company: 'Ozon',
    title: item.title,
    location: '',
    workplace_type: '',
    description: 'Подробное описание вакансии доступно на сайте Ozon Tech.',
    url: item.url,
    posted_at: '',
    first_seen_at: '2026-09-02T00:00:00+00:00',
    source_key: 'ozon-tech-direct',
    technologies: [],
  })),
];

let preparedScoringFeatures = 0;
for (const vacancy of vacancyRecords) {
  const vacancyId = `${vacancy.source_key || 'catalog'}:${vacancy.id}`;
  const currentFeatures = vacancy.scoring_features && !vacancy.scoring_features.v ? vacancy.scoring_features : {};
  vacancy.scoring_features = currentFeatures;
  for (const [profile, engine] of Object.entries(scoringEngines)) {
    if (currentFeatures[profile]?.v === taxonomies[profile].meta.version && currentFeatures[profile]?.p === profile) continue;
    currentFeatures[profile] = engine.compact(await engine.analyze(vacancy, vacancyId));
    preparedScoringFeatures += 1;
  }
}

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify({
  meta: { ...JSON.parse(meta), count: vacancyRecords.length, taxonomy_versions: Object.fromEntries(Object.entries(taxonomies).map(([profile, taxonomy]) => [profile, taxonomy.meta.version])), scoring_features_built: preparedScoringFeatures },
  vacancies: vacancyRecords,
  companies: registry,
}), 'utf8');
