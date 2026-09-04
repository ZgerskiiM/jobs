function scoringNormalizeText(value) {
  return String(value || '')
    .replace(/[ёЁ]/g, (character) => character === 'ё' ? 'е' : 'Е')
    .replace(/[—–−]/g, '-')
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('ru-RU')
}

const SCORING_BOUNDARY = 'A-Za-zА-Яа-яЁё0-9_+#.'

function scoringEscape(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\ /g, '\\s+')
}

function scoringPattern(phrase, flags = 'iu') {
  return new RegExp(`(?<![${SCORING_BOUNDARY}])${scoringEscape(phrase)}(?![${SCORING_BOUNDARY}])`, flags)
}

function scoringPatterns(phrase) {
  const patterns = [scoringPattern(phrase)]
  if (/^[а-яё]+$/iu.test(phrase) && /[ыи]$/iu.test(phrase) && phrase.length > 5) {
    patterns.push(new RegExp(`(?<![${SCORING_BOUNDARY}])${scoringEscape(phrase.slice(0, -1))}[а-яё]*(?![${SCORING_BOUNDARY}])`, 'iu'))
  }
  return patterns
}

function scoringFindMatches(text, pattern) {
  const global = new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`)
  return [...text.matchAll(global)].map((match) => ({ start: match.index || 0, end: (match.index || 0) + match[0].length }))
}

function scoringAllowOverlap(first, second) {
  const longer = first.alias.length >= second.alias.length ? first : second
  const shorter = longer === first ? second : first
  return longer.concept.startsWith(`${shorter.concept}_`) && /_\d+$/.test(longer.concept)
}

function scoringContext(text, occurrence) {
  const sentenceStart = Math.max(text.lastIndexOf('.', occurrence.start), text.lastIndexOf('!', occurrence.start), text.lastIndexOf('?', occurrence.start), text.lastIndexOf('\n', occurrence.start), text.lastIndexOf(';', occurrence.start)) + 1
  const ends = ['.', '!', '?', '\n', ';'].map((mark) => text.indexOf(mark, occurrence.end)).filter((value) => value >= 0)
  const sentenceEnd = ends.length ? Math.min(...ends) : text.length
  const windowStart = Math.max(0, sentenceStart - 120)
  const window = text.slice(windowStart, sentenceEnd)
  const candidates = []
  for (const modifier of SCORING_CONFIG.contextModifiers || []) {
    for (const rawPattern of modifier.patterns || []) {
      const normalizedPattern = scoringNormalizeText(rawPattern)
      for (const match of scoringFindMatches(window, scoringPattern(normalizedPattern))) {
        const globalStart = windowStart + match.start
        const globalEnd = windowStart + match.end
        if (modifier.id === 'NEGATED_OR_DEPRECATED' && !(globalEnd <= occurrence.start && occurrence.start - globalEnd <= 6)) continue
        const distance = Math.min(Math.abs(occurrence.start - globalEnd), Math.abs(globalStart - occurrence.end))
        if (distance <= 120) candidates.push({ distance, length: normalizedPattern.length, modifier })
      }
    }
  }
  if (!candidates.length) return { multiplier: 1, confidence: 1 }
  candidates.sort((left, right) => left.distance - right.distance || right.length - left.length)
  return { multiplier: Number(candidates[0].modifier.multiplier ?? 1), confidence: 1 }
}

function scoringExtractExperience(text) {
  const normalized = scoringNormalizeText(text)
  const values = []
  for (const rawPattern of SCORING_CONFIG.experienceParsing?.patterns || []) {
    try {
      for (const match of normalized.matchAll(new RegExp(rawPattern, 'giu'))) {
        const window = normalized.slice(Math.max(0, (match.index || 0) - 90), Math.min(normalized.length, (match.index || 0) + match[0].length + 90))
        if (/опыт|experience|commercial|коммерч|разработк|developer|engineer/iu.test(window)) values.push(Number(match[1]))
      }
    } catch { /* Ignore malformed optional taxonomy patterns. */ }
  }
  const wordNumbers = SCORING_CONFIG.experienceParsing?.wordNumbers || {}
  const words = Object.keys(wordNumbers).sort((left, right) => right.length - left.length).map(scoringEscape).join('|')
  if (words) {
    const pattern = new RegExp(`(?:от|не менее|минимум)\\s+(${words})\\s+(?:лет|года|год|years?)`, 'giu')
    for (const match of normalized.matchAll(pattern)) {
      const window = normalized.slice(Math.max(0, (match.index || 0) - 90), Math.min(normalized.length, (match.index || 0) + match[0].length + 90))
      if (/опыт|experience|commercial|коммерч|разработк|developer|engineer/iu.test(window)) values.push(Number(wordNumbers[match[1]]))
    }
  }
  return values.filter(Number.isFinite).length ? Math.max(...values.filter(Number.isFinite)) : null
}

function scoringDetectRole(title, description, concepts) {
  const role = (SCORING_CONFIG.roles || []).find((item) => item.concept === 'BACKEND')
  const fullstack = (SCORING_CONFIG.roles || []).find((item) => item.concept === 'FULLSTACK')
  if (role?.aliases?.some((alias) => scoringPattern(scoringNormalizeText(alias)).test(title))) return { primary: 'BACKEND', match: 1, confidence: 1 }
  if (fullstack?.aliases?.some((alias) => scoringPattern(scoringNormalizeText(alias)).test(title))) return { primary: 'FULLSTACK', match: 0.7, confidence: 0.95 }
  if (/java\s+(?:developer|engineer|разработчик)|java-разработчик/iu.test(title)) return { primary: 'BACKEND', match: 0.8, confidence: 0.8 }
  const activeSignals = ['SPRING_BOOT', 'MICROSERVICES', 'REST', 'GRPC', 'WEBFLUX'].filter((concept) => concepts[concept]).length
  if (activeSignals >= 2 && /разработ|сервис|backend|back-end|api|микросервис/iu.test(description)) return { primary: 'BACKEND', match: 0.8, confidence: 0.75 }
  return { primary: 'UNKNOWN', match: 0, confidence: 0.4 }
}

function scoringDetectSeniority(title, description, minimumExperience) {
  const aliases = SCORING_CONFIG.seniority?.aliases || {}
  const levels = SCORING_CONFIG.seniority?.levels || {}
  for (const [source, confidence] of [[title, 1], [description, 0.85]]) {
    const matches = []
    for (const [level, values] of Object.entries(aliases)) {
      for (const alias of values) if (scoringPattern(scoringNormalizeText(alias)).test(source)) matches.push({ length: alias.length, rank: levels[level] || 0, level })
    }
    if (matches.length) {
      matches.sort((left, right) => right.length - left.length || right.rank - left.rank)
      return { level: matches[0].level, confidence }
    }
  }
  if (minimumExperience !== null && minimumExperience >= 5) return { level: 'SENIOR', confidence: 0.6 }
  if (minimumExperience !== null && minimumExperience >= 3) return { level: 'MIDDLE', confidence: 0.55 }
  return { level: 'UNKNOWN', confidence: 0.35 }
}

function scoringDetectNegatives(title, description) {
  const result = []
  for (const signal of SCORING_CONFIG.negativeSignals || []) {
    let matchedText = (signal.patterns || []).find((pattern) => scoringPattern(scoringNormalizeText(pattern)).test(title)) || ''
    if (!matchedText) {
      for (const sentence of description.split(/[.!?\n;]+/)) {
        if (/в компании|команд\w*|работают|есть|много/iu.test(sentence) && signal.primaryRoleConflict) continue
        matchedText = (signal.patterns || []).find((pattern) => scoringPattern(scoringNormalizeText(pattern)).test(sentence)) || ''
        if (matchedText) break
      }
    }
    if (matchedText) result.push({ id: signal.id, penalty: Number(signal.penalty || 0), primaryRoleConflict: Boolean(signal.primaryRoleConflict), matchedText })
  }
  return result
}

async function scoringHash(title, description) {
  const normalized = `${scoringNormalizeText(title)}\n${scoringNormalizeText(description)}`
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized)))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function scoringAnalyzeVacancy(vacancy, vacancyId) {
  const title = scoringNormalizeText(vacancy.title)
  const description = scoringNormalizeText(vacancy.description)
  const text = `${title}\n${description}`.trim()
  const found = []
  for (const item of SCORING_CONFIG.taxonomy || []) {
    const concept = String(item.concept || '').toUpperCase()
    for (const rawAlias of item.aliases || []) {
      const alias = scoringNormalizeText(rawAlias)
      for (const pattern of scoringPatterns(alias)) {
        for (const match of scoringFindMatches(text, pattern)) found.push({ concept, alias, start: match.start, end: match.end })
      }
    }
  }
  found.sort((left, right) => right.alias.length - left.alias.length || left.start - right.start || left.concept.localeCompare(right.concept))
  const retained = []
  for (const candidate of found) {
    const overlaps = retained.filter((item) => item.start < candidate.end && candidate.start < item.end)
    if (!overlaps.length || overlaps.every((item) => scoringAllowOverlap(candidate, item))) retained.push(candidate)
  }
  const concepts = {}
  for (const item of SCORING_CONFIG.taxonomy || []) {
    const concept = String(item.concept || '').toUpperCase()
    const matches = retained.filter((entry) => entry.concept === concept)
    if (!matches.length) continue
    const contexts = matches.map((entry) => scoringContext(text, entry))
    concepts[concept] = { concept, match: 1, contextMultiplier: Math.max(...contexts.map((value) => value.multiplier)), confidence: Math.max(...contexts.map((value) => value.confidence)), mentions: matches.length }
  }
  const minimumExperience = scoringExtractExperience(text)
  return {
    vacancyId,
    taxonomyVersion: String(SCORING_CONFIG.meta?.version || ''),
    contentHash: await scoringHash(vacancy.title, vacancy.description),
    indexedAt: new Date().toISOString(),
    role: scoringDetectRole(title, description, concepts),
    seniority: scoringDetectSeniority(title, description, minimumExperience),
    minExperienceYears: minimumExperience,
    concepts,
    negativeSignals: scoringDetectNegatives(title, description),
    vacancyDate: vacancy.posted_at || vacancy.first_seen_at || ''
  }
}

function scoringResolveMatch(required, features, excluded) {
  if (excluded.includes(required)) return { semantic: 0, found: null, relation: null }
  if (features.concepts[required]) return { semantic: Number(features.concepts[required].match || 0), found: required, relation: null }
  const config = (SCORING_CONFIG.taxonomy || []).find((item) => String(item.concept).toUpperCase() === required)
  const related = config?.related || []
  let best = null
  for (const item of related) {
    const concept = String(item.concept || '').toUpperCase()
    const coefficient = Number(item.match || 0)
    if (features.concepts[concept] && (!best || coefficient > best.coefficient)) best = { coefficient, concept }
  }
  return best ? { semantic: best.coefficient, found: best.concept, relation: best.coefficient } : { semantic: 0, found: null, relation: null }
}

function scoringGateResults(profile, features) {
  const javaMatch = Number(features.concepts.JAVA?.match || 0)
  const frameworkMatch = Math.max(...['SPRING_BOOT', 'SPRING', 'QUARKUS', 'MICRONAUT'].map((concept) => Number(features.concepts[concept]?.match || 0)))
  const wrongRole = (features.negativeSignals || []).some((signal) => signal.primaryRoleConflict)
  const conditions = {
    JAVA_PRIMARY_MISSING: javaMatch < 0.5,
    BACKEND_ROLE_MISSING: Number(features.role?.match || 0) < 0.5,
    JAVA_BACKEND_FRAMEWORK_MISSING: javaMatch >= 0.5 && frameworkMatch < 0.5,
    WRONG_PRIMARY_ROLE: wrongRole
  }
  return (SCORING_CONFIG.gates || []).filter((gate) => conditions[gate.id]).map((gate) => ({ id: gate.id, maxScore: Number(gate.maxScore), reason: gate.reason }))
}

function scoringExperience(candidate, minimum) {
  if (candidate === null || minimum === null || candidate === undefined || minimum === undefined) return { candidateYears: candidate ?? null, vacancyMinYears: minimum ?? null, coefficient: 1 }
  const delta = Number(candidate) - Number(minimum)
  const rules = [...(SCORING_CONFIG.experienceParsing?.matchRules || [])].sort((left, right) => Number(right.candidateDeltaMin) - Number(left.candidateDeltaMin))
  return { candidateYears: Number(candidate), vacancyMinYears: Number(minimum), coefficient: Number(rules.find((rule) => delta >= Number(rule.candidateDeltaMin))?.coefficient || 0) }
}

function scoringSeniority(candidate, vacancy) {
  const levels = SCORING_CONFIG.seniority?.levels || {}
  const distance = Math.abs(Number(levels[candidate] || 0) - Number(levels[vacancy] || 0))
  const values = SCORING_CONFIG.seniority?.distanceMatch || {}
  return { candidate, vacancy, coefficient: Number(values[String(distance)] ?? values[String(Math.max(...Object.keys(values).map(Number)))] ?? 0) }
}

function scoringSummary(level, gates) {
  if (gates.length) return `Низкая релевантность: ${gates.map((gate) => gate.reason).join('; ')}`
  return {
    EXCELLENT_MATCH: 'Отличное совпадение по основному Java Backend стеку.',
    STRONG_MATCH: 'Сильное совпадение по основному Java Backend стеку.',
    GOOD_MATCH: 'Хорошее совпадение по Java Backend стеку.',
    PARTIAL_MATCH: 'Частичное совпадение, проверь важные пробелы.',
    WEAK_MATCH: 'Слабое совпадение по заявленным требованиям.'
  }[level] || 'Вакансия почти не соответствует заявленным требованиям.'
}

function scoringScore(profile, features) {
  const categoryRequirements = {}
  const matched = []
  const partialMatches = []
  const missingImportant = []
  let hardTotal = 0
  let hardMatched = 0
  for (const requirement of profile.requirements || []) {
    const concept = String(requirement.concept || '').toUpperCase()
    const importance = String(requirement.importance || 'BONUS').toUpperCase()
    const config = (SCORING_CONFIG.taxonomy || []).find((item) => String(item.concept).toUpperCase() === concept)
    if (!config) continue
    const requirementWeight = Number(SCORING_CONFIG.scoring?.importanceWeights?.[importance] || 0)
    if (!requirementWeight) continue
    const resolved = scoringResolveMatch(concept, features, profile.excludedConcepts || [])
    let effective = 0
    if (resolved.found) {
      const extracted = features.concepts[resolved.found]
      effective = resolved.semantic * Number(extracted.contextMultiplier || 1) * Number(extracted.confidence || 1)
      if (resolved.relation === null) matched.push({ required: concept, found: resolved.found, coefficient: Number(effective.toFixed(4)) })
      else partialMatches.push({ required: concept, found: resolved.found, coefficient: Number(resolved.relation.toFixed(4)) })
    }
    if (effective === 0 && ['MUST_HAVE', 'STRONG_PREFERENCE'].includes(importance)) missingImportant.push(concept)
    const category = config.category
    categoryRequirements[category] ||= []
    categoryRequirements[category].push({ weight: requirementWeight, effective })
    if (importance === 'MUST_HAVE') { hardTotal += 1; hardMatched += Math.min(1, effective) }
  }
  const categoryScores = {}
  for (const [category, entries] of Object.entries(categoryRequirements)) {
    const total = entries.reduce((sum, entry) => sum + entry.weight, 0)
    categoryScores[category] = total ? entries.reduce((sum, entry) => sum + entry.weight * entry.effective, 0) / total : 0
  }
  const weights = SCORING_CONFIG.scoring?.categoryWeights || {}
  const activeWeight = Object.keys(categoryScores).reduce((sum, category) => sum + Number(weights[category] || 0), 0)
  const raw = activeWeight ? Object.entries(categoryScores).reduce((sum, [category, value]) => sum + Number(weights[category] || 0) / activeWeight * value, 0) : 0
  const negativeSignals = features.negativeSignals || []
  const gatesApplied = scoringGateResults(profile, features)
  let score = raw * 100 - negativeSignals.reduce((sum, signal) => sum + Number(signal.penalty || 0), 0)
  if (gatesApplied.length) score = Math.min(score, ...gatesApplied.map((gate) => gate.maxScore))
  score = Math.max(0, Math.min(100, score))
  const band = (SCORING_CONFIG.outputBands || []).find((item) => score >= Number(item.min) && score <= Number(item.max)) || SCORING_CONFIG.outputBands?.at(-1) || { code: 'WEAK_MATCH', labelRu: 'Слабое совпадение' }
  return {
    vacancyId: features.vacancyId,
    score: Number(score.toFixed(2)),
    level: band.code,
    label: band.labelRu,
    hardMatchScore: hardTotal ? Number((hardMatched / hardTotal * 100).toFixed(2)) : 100,
    categoryScores: Object.fromEntries(Object.entries(categoryScores).map(([key, value]) => [key, Number((value * 100).toFixed(2))])),
    matched,
    partialMatches,
    missingImportant,
    negativeSignals,
    gatesApplied,
    experienceMatch: scoringExperience(profile.experienceYears ?? null, features.minExperienceYears ?? null),
    seniorityMatch: scoringSeniority(profile.targetSeniority || 'UNKNOWN', features.seniority?.level || 'UNKNOWN'),
    summary: scoringSummary(band.code, gatesApplied)
  }
}

function scoringCandidateProfile(account) {
  const resume = account.resume || {}
  const onboarding = account.onboarding || {}
  const position = scoringNormalizeText(resume.position)
  const skills = Array.isArray(resume.skills) ? resume.skills : []
  const requirements = []
  for (const skill of skills) {
    if (skill?.confirmed === false) continue
    const name = scoringNormalizeText(skill?.name)
    const concept = (SCORING_CONFIG.taxonomy || []).find((item) => (item.aliases || []).some((alias) => scoringPattern(scoringNormalizeText(alias)).test(name)))
    if (!concept || requirements.some((item) => item.concept === concept.concept)) continue
    requirements.push({ concept: String(concept.concept).toUpperCase(), importance: /^java(?:\s|$)/iu.test(name) ? 'MUST_HAVE' : 'STRONG_PREFERENCE' })
  }
  const role = /backend|back-end|java|сервер|бэкенд|разработчик/iu.test(position) || onboarding.roles?.some((value) => /backend|back-end|java/iu.test(value)) ? 'BACKEND' : 'UNKNOWN'
  const levelAliases = SCORING_CONFIG.seniority?.aliases || {}
  const targetSeniority = Object.entries(levelAliases).find(([, aliases]) => aliases.some((alias) => scoringPattern(scoringNormalizeText(alias)).test(position)))?.[0]
    || (Number(resume.experienceYears) >= 5 ? 'SENIOR' : Number(resume.experienceYears) >= 3 ? 'MIDDLE' : 'UNKNOWN')
  return { targetRole: role, targetSeniority, experienceYears: Number.isFinite(Number(resume.experienceYears)) ? Number(resume.experienceYears) : null, requirements, excludedConcepts: [] }
}
