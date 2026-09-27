import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dist = join(root, 'dist')
const client = join(dist, 'client')
const server = join(dist, 'server')

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

function plainText(value) {
  return String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function xmlEscape(value) {
  return escapeHtml(value)
}

function stableHash(value) {
  let result = 0
  for (let index = 0; index < value.length; index += 1) result = (Math.imul(result, 31) + value.charCodeAt(index)) | 0
  return Math.abs(result)
}

function companySlug(name) {
  return `${name.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-').replace(/^-|-$/g, '')}-${stableHash(name).toString(36)}`
}

function jobId(vacancy) {
  return stableHash(`${vacancy.source_key || vacancy.company}:${vacancy.id}`)
}

function withSeoPage(template, { title, description, canonical, body, structuredData }) {
  let html = template
    .replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/i, `<meta name="description" content="${escapeHtml(description)}">`)
  html = html.replace('</head>', [
    `<link rel="canonical" href="${escapeHtml(canonical)}">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    structuredData ? `<script type="application/ld+json">${JSON.stringify(structuredData).replace(/<\//g, '<\\/')}</script>` : '',
    '</head>',
  ].filter(Boolean).join('\n'))
  return html.replace('<div id="root"></div>', `<div id="root">${body}</div>`)
}

async function writePublicRoute(roots, route, html) {
  for (const outputRoot of roots) {
    const outputPath = join(outputRoot, route, 'index.html')
    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(outputPath, html)
  }
}

async function generateSeoPages() {
  const roots = [dist, client]
  const origin = (process.env.SITE_ORIGIN || 'https://devver.ru').replace(/\/$/, '')
  const template = await readFile(join(dist, 'index.html'), 'utf8')
  const catalog = JSON.parse(await readFile(join(dist, 'vacancies.json'), 'utf8'))
  const vacancies = Array.isArray(catalog.vacancies) ? catalog.vacancies : []
  const companiesById = new Map()
  const seenJobIds = new Set()
  const indexedVacancies = []

  for (const vacancy of vacancies) {
    const id = jobId(vacancy)
    if (seenJobIds.has(id)) continue
    seenJobIds.add(id)
    const item = { ...vacancy, pageId: id, companyId: companySlug(String(vacancy.company || '')) }
    indexedVacancies.push(item)
    if (!companiesById.has(item.companyId)) companiesById.set(item.companyId, { id: item.companyId, name: item.company, vacancies: [] })
    companiesById.get(item.companyId).vacancies.push(item)
  }

  const companies = [...companiesById.values()].sort((left, right) => right.vacancies.length - left.vacancies.length || left.name.localeCompare(right.name, 'ru'))
  const generatedAt = new Date().toISOString().slice(0, 10)
  const urls = [
    '/', '/companies/', '/trends/',
    ...companies.map((company) => `/companies/${company.id}/`),
    ...indexedVacancies.map((vacancy) => `/jobs/${vacancy.pageId}/`),
  ]
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((path) => `  <url><loc>${xmlEscape(`${origin}${path}`)}</loc><lastmod>${generatedAt}</lastmod></url>`).join('\n')}\n</urlset>\n`
  for (const outputRoot of roots) await writeFile(join(outputRoot, 'sitemap.xml'), sitemap)

  const latestVacancies = [...indexedVacancies]
    .sort((left, right) => String(right.posted_at || right.first_seen_at || '').localeCompare(String(left.posted_at || left.first_seen_at || '')))
    .slice(0, 80)
  const homeItems = latestVacancies.map((vacancy) => `<li><a href="/jobs/${vacancy.pageId}/">${escapeHtml(vacancy.title)}</a> — ${escapeHtml(vacancy.company)}${vacancy.location ? ` · ${escapeHtml(vacancy.location)}` : ''}</li>`).join('\n')
  const companyItems = companies.map((company) => `<li><a href="/companies/${company.id}/">${escapeHtml(company.name)}</a> — ${company.vacancies.length} вакансий</li>`).join('\n')
  const homepage = withSeoPage(template, {
    title: 'IT-вакансии от прямых работодателей — devver',
    description: `Каталог актуальных IT-вакансий от ${companies.length} компаний. Вакансии в разработке, DevOps, аналитике и других направлениях.`,
    canonical: `${origin}/`,
    body: `<main><h1>IT-вакансии от прямых работодателей</h1><p>Каталог вакансий в разработке, DevOps, аналитике и других технических направлениях. Сейчас в каталоге ${indexedVacancies.length} вакансий от ${companies.length} компаний.</p><h2>Свежие вакансии</h2><ul>${homeItems}</ul><h2>Компании</h2><ul>${companyItems}</ul></main>`,
    structuredData: { '@context': 'https://schema.org', '@type': 'WebSite', name: 'devver', url: `${origin}/`, inLanguage: 'ru' },
  })
  for (const outputRoot of roots) await writeFile(join(outputRoot, 'index.html'), homepage)

  const companiesDirectory = withSeoPage(template, {
    title: 'Компании с IT-вакансиями — devver',
    description: `Список ${companies.length} компаний с открытыми вакансиями в IT и цифровых профессиях.`,
    canonical: `${origin}/companies/`,
    body: `<main><h1>Компании с открытыми IT-вакансиями</h1><ul>${companyItems}</ul></main>`,
    structuredData: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'Компании с IT-вакансиями', url: `${origin}/companies/`, inLanguage: 'ru' },
  })
  const trendsPage = withSeoPage(template, {
    title: 'Вакансии и тренды рынка IT — devver',
    description: 'Открытые вакансии и направления найма в IT. Изучите актуальный каталог работодателей и технических ролей.',
    canonical: `${origin}/trends/`,
    body: `<main><h1>Тренды и вакансии IT-рынка</h1><p>Изучайте открытые вакансии от прямых работодателей и направления найма в IT.</p><p><a href="/">Перейти к вакансиям</a> · <a href="/companies/">Компании</a></p><ul>${homeItems.slice(0, 30)}</ul></main>`,
    structuredData: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'Тренды и вакансии IT-рынка', url: `${origin}/trends/`, inLanguage: 'ru' },
  })
  await writePublicRoute(roots, 'companies', companiesDirectory)
  await writePublicRoute(roots, 'trends', trendsPage)

  for (const vacancy of indexedVacancies) {
    const title = String(vacancy.title || 'IT-вакансия')
    const company = String(vacancy.company || 'Работодатель')
    const description = plainText(vacancy.description).slice(0, 500)
    const canonical = `${origin}/jobs/${vacancy.pageId}/`
    const structuredData = {
      '@context': 'https://schema.org',
      '@type': 'JobPosting',
      title,
      description: plainText(vacancy.description),
      hiringOrganization: { '@type': 'Organization', name: company },
      identifier: { '@type': 'PropertyValue', name: String(vacancy.source_key || 'catalog'), value: String(vacancy.id || '') },
      url: String(vacancy.url || canonical),
      datePosted: String(vacancy.posted_at || vacancy.first_seen_at || generatedAt).slice(0, 10),
      inLanguage: 'ru',
    }
    const vacancyPage = withSeoPage(template, {
      title: `${title} — ${company} | devver`,
      description: `${title} в компании ${company}${vacancy.location ? `, ${vacancy.location}` : ''}. ${description}`.slice(0, 300),
      canonical,
      body: `<main><nav><a href="/">Все вакансии</a> / <a href="/companies/${vacancy.companyId}/">${escapeHtml(company)}</a></nav><article><h1>${escapeHtml(title)}</h1><p>${escapeHtml(company)}${vacancy.location ? ` · ${escapeHtml(vacancy.location)}` : ''}</p>${description ? `<p>${escapeHtml(description)}</p>` : ''}<p><a href="${escapeHtml(vacancy.url || '#')}" rel="nofollow">Открыть вакансию на сайте работодателя</a></p><p><a href="/companies/${vacancy.companyId}/">Другие вакансии компании ${escapeHtml(company)}</a></p></article></main>`,
      structuredData,
    })
    await writePublicRoute(roots, `jobs/${vacancy.pageId}`, vacancyPage)
  }

  for (const company of companies) {
    const canonical = `${origin}/companies/${company.id}/`
    const items = company.vacancies.map((vacancy) => `<li><a href="/jobs/${vacancy.pageId}/">${escapeHtml(vacancy.title)}</a>${vacancy.location ? ` — ${escapeHtml(vacancy.location)}` : ''}</li>`).join('\n')
    const companyPage = withSeoPage(template, {
      title: `Вакансии компании ${company.name} — devver`,
      description: `Открытые вакансии компании ${company.name} в каталоге devver: ${company.vacancies.length} позиций.`,
      canonical,
      body: `<main><nav><a href="/companies/">Компании</a></nav><article><h1>Вакансии компании ${escapeHtml(company.name)}</h1><p>Открытых вакансий: ${company.vacancies.length}</p><ul>${items}</ul></article></main>`,
      structuredData: { '@context': 'https://schema.org', '@type': 'Organization', name: company.name, url: canonical, inLanguage: 'ru' },
    })
    await writePublicRoute(roots, `companies/${company.id}`, companyPage)
  }

  console.log(`Generated SEO pages for ${indexedVacancies.length} vacancies and ${companies.length} companies.`)
}

await rm(client, { recursive: true, force: true })
await mkdir(client, { recursive: true })
for (const entry of await readdir(dist, { withFileTypes: true })) {
  if (entry.name === 'client' || entry.name === 'server' || entry.name === '.openai') continue
  await cp(join(dist, entry.name), join(client, entry.name), { recursive: true })
}
await generateSeoPages()
await mkdir(server, { recursive: true })
const taxonomies = {
  JAVA_BACKEND: JSON.parse(await readFile(join(root, '..', 'config', 'java_backend_vacancy_relevance_ru_v1.json'), 'utf8')),
  DEVOPS: JSON.parse(await readFile(join(root, '..', 'config', 'devops_vacancy_relevance_ru_v1.json'), 'utf8')),
  ONE_C_DEVELOPER: JSON.parse(await readFile(join(root, '..', 'config', '1c_developer_vacancy_relevance_ru_v1.json'), 'utf8')),
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
