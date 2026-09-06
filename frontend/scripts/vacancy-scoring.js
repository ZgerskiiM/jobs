const SCORING_ENGINE_VERSION = '2.0.0'

function scoringNormalizeText(value) {
  return String(value || '')
    .replace(/[ёЁ]/g, (character) => character === 'ё' ? 'е' : 'Е')
    .replace(/[—–−]/g, '-')
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('ru-RU')
}

const SCORING_BOUNDARY = 'A-Za-zА-Яа-яЁё0-9_+#'

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
  const profile = String(SCORING_CONFIG.meta?.profile || 'JAVA_BACKEND').toUpperCase()
  const matchedRole = (SCORING_CONFIG.roles || []).find((item) => item.aliases?.some((alias) => scoringPattern(scoringNormalizeText(alias)).test(title)))
  if (matchedRole) return { primary: String(matchedRole.concept || 'UNKNOWN').toUpperCase(), match: matchedRole.concept === 'FULLSTACK' ? 0.7 : 1, confidence: 1 }
  if (profile === 'DEVOPS') {
    if (/devops|sre|platform|инфраструктур|облачн(?:ый|ая) инженер/iu.test(title)) return { primary: 'DEVOPS', match: 0.9, confidence: 0.9 }
    const activeSignals = ['LINUX', 'KUBERNETES', 'DOCKER', 'TERRAFORM', 'ANSIBLE', 'HELM', 'PROMETHEUS', 'GRAFANA'].filter((concept) => concepts[concept]).length
    if (activeSignals >= 2 && /инфраструктур|эксплуатац|депло|мониторинг|контейнер|облачн|reliability/iu.test(description)) return { primary: 'DEVOPS', match: 0.75, confidence: 0.75 }
    return { primary: 'UNKNOWN', match: 0, confidence: 0.4 }
  }
  if (profile === 'ONE_C_DEVELOPER') {
    if (/(?:1с|1c)\s*(?:программист|разработчик|developer)|программист\s*(?:1с|1c)/iu.test(title)) return { primary: 'ONE_C_DEVELOPER', match: 0.9, confidence: 0.9 }
    const activeSignals = ['ONE_C_PLATFORM', 'ONE_C_LANGUAGE', 'ONE_C_QUERY_LANGUAGE', 'CONFIGURATOR', 'BSP', 'DCS_SKD'].filter((concept) => concepts[concept]).length
    if (activeSignals >= 2 && /(?:1с|1c)|конфигурац|бухгалтер|уч[её]т/iu.test(description)) return { primary: 'ONE_C_DEVELOPER', match: 0.75, confidence: 0.75 }
    return { primary: 'UNKNOWN', match: 0, confidence: 0.4 }
  }
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

function scoringCompactFeatures(features) {
  return {
    v: features.taxonomyVersion,
    p: String(SCORING_CONFIG.meta?.profile || 'JAVA_BACKEND').toUpperCase(),
    r: [features.role.primary, features.role.match, features.role.confidence],
    s: [features.seniority.level, features.seniority.confidence],
    e: features.minExperienceYears,
    c: Object.entries(features.concepts).sort(([left], [right]) => left.localeCompare(right)).map(([concept, value]) => [concept, value.match, value.contextMultiplier, value.confidence, value.mentions]),
    n: (features.negativeSignals || []).map((value) => [value.id, value.penalty, value.primaryRoleConflict, value.matchedText]),
    d: features.vacancyDate || ''
  }
}

function scoringInflateFeatures(compact, vacancyId) {
  if (!compact || compact.v !== String(SCORING_CONFIG.meta?.version || '') || compact.p !== String(SCORING_CONFIG.meta?.profile || 'JAVA_BACKEND').toUpperCase() || !Array.isArray(compact.c)) return null
  const concepts = {}
  for (const value of compact.c) {
    if (!Array.isArray(value) || value.length < 5) continue
    const concept = String(value[0] || '').toUpperCase()
    concepts[concept] = { concept, match: Number(value[1]), contextMultiplier: Number(value[2]), confidence: Number(value[3]), mentions: Number(value[4]) }
  }
  return {
    vacancyId,
    taxonomyVersion: compact.v,
    role: { primary: String(compact.r?.[0] || 'UNKNOWN'), match: Number(compact.r?.[1] || 0), confidence: Number(compact.r?.[2] || 0) },
    seniority: { level: String(compact.s?.[0] || 'UNKNOWN'), confidence: Number(compact.s?.[1] || 0) },
    minExperienceYears: compact.e === null || compact.e === undefined ? null : Number(compact.e),
    concepts,
    negativeSignals: (compact.n || []).filter(Array.isArray).map((value) => ({ id: String(value[0] || ''), penalty: Number(value[1] || 0), primaryRoleConflict: Boolean(value[2]), matchedText: String(value[3] || '') })),
    vacancyDate: String(compact.d || '')
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
    const coefficient = Number(item.match ?? SCORING_CONFIG.scoring?.defaultSemanticMatch?.RELATED_MEDIUM ?? 0)
    if (features.concepts[concept] && (!best || coefficient > best.coefficient)) best = { coefficient, concept }
  }
  return best ? { semantic: best.coefficient, found: best.concept, relation: best.coefficient } : { semantic: 0, found: null, relation: null }
}

function scoringEffectiveMatch(semantic, extracted) {
  const boost = SCORING_CONFIG.scoring?.frequencyBoost || {}
  let frequencyMultiplier = 1
  if (boost.enabled && Number(extracted.mentions || 0) >= Number(boost.minMentionsForBoost || 2)) {
    const minimum = Number(boost.minMentionsForBoost || 2)
    const maximum = Math.max(minimum, Number(boost.maxMentionsCounted || minimum))
    const progress = (Math.min(Number(extracted.mentions || 0), maximum) - minimum + 1) / (maximum - minimum + 1)
    frequencyMultiplier += Number(boost.maxBoost || 0) * progress
  }
  return Math.min(1, semantic * Number(extracted.contextMultiplier || 1) * Number(extracted.confidence || 1) * frequencyMultiplier)
}

function scoringGateResults(profile, features) {
  if (String(SCORING_CONFIG.meta?.profile || '').toUpperCase() === 'DEVOPS') {
    const linuxMatch = Math.max(Number(features.concepts.LINUX?.match || 0), Number(features.concepts.UNIX?.match || 0))
    const kubernetesIsMustHave = (profile.requirements || []).some((requirement) => requirement.concept === 'KUBERNETES' && requirement.importance === 'MUST_HAVE')
    const kubernetesMatch = Math.max(Number(features.concepts.KUBERNETES?.match || 0), Number(features.concepts.OPENSHIFT?.match || 0) * 0.7)
    const conditions = {
      DEVOPS_ROLE_MISSING: Number(features.role?.match || 0) < 0.5,
      LINUX_MISSING: linuxMatch < 0.5,
      KUBERNETES_CRITICAL_MISSING: kubernetesIsMustHave && kubernetesMatch < 0.5,
      WRONG_PRIMARY_ROLE: (features.negativeSignals || []).some((signal) => signal.primaryRoleConflict),
    }
    return (SCORING_CONFIG.gates || []).filter((gate) => conditions[gate.id]).map((gate) => ({ id: gate.id, maxScore: Number(gate.maxScore), reason: gate.reason }))
  }
  if (String(SCORING_CONFIG.meta?.profile || '').toUpperCase() === 'ONE_C_DEVELOPER') {
    const oneCMatch = Number(features.concepts.ONE_C_PLATFORM?.match || 0)
    const roleMatch = Number(features.role?.match || 0)
    const queryIsMustHave = (profile.requirements || []).some((requirement) => requirement.concept === 'ONE_C_QUERY_LANGUAGE' && requirement.importance === 'MUST_HAVE')
    const conditions = {
      ONE_C_PRIMARY_MISSING: oneCMatch < 0.5 && roleMatch < 0.5,
      DEVELOPER_ROLE_MISSING: roleMatch < 0.5,
      QUERY_LANGUAGE_CRITICAL_MISSING: queryIsMustHave && Number(features.concepts.ONE_C_QUERY_LANGUAGE?.match || 0) < 0.5,
      WRONG_PRIMARY_ROLE: (features.negativeSignals || []).some((signal) => signal.primaryRoleConflict),
    }
    return (SCORING_CONFIG.gates || []).filter((gate) => conditions[gate.id]).map((gate) => ({ id: gate.id, maxScore: Number(gate.maxScore), reason: gate.reason }))
  }
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
  if (candidate === null || minimum === null || candidate === undefined || minimum === undefined) return { candidateYears: candidate ?? null, vacancyMinYears: minimum ?? null, coefficient: null }
  const delta = Number(candidate) - Number(minimum)
  const rules = [...(SCORING_CONFIG.experienceParsing?.matchRules || [])].sort((left, right) => Number(right.candidateDeltaMin) - Number(left.candidateDeltaMin))
  return { candidateYears: Number(candidate), vacancyMinYears: Number(minimum), coefficient: Number(rules.find((rule) => delta >= Number(rule.candidateDeltaMin))?.coefficient || 0) }
}

function scoringSeniority(candidate, vacancy) {
  const levels = SCORING_CONFIG.seniority?.levels || {}
  if (!(candidate in levels) || !(vacancy in levels)) return { candidate, vacancy, coefficient: null }
  const distance = Math.abs(Number(levels[candidate] || 0) - Number(levels[vacancy] || 0))
  const values = SCORING_CONFIG.seniority?.distanceMatch || {}
  return { candidate, vacancy, coefficient: Number(values[String(distance)] ?? values[String(Math.max(...Object.keys(values).map(Number)))] ?? 0) }
}

function scoringVacancyRequirementCoverage(profile, features) {
  const candidateConcepts = new Set((profile.requirements || []).map((item) => String(item.concept || '').toUpperCase()))
  for (const concept of profile.excludedConcepts || []) candidateConcepts.delete(String(concept).toUpperCase())
  let total = 0
  let covered = 0
  for (const [concept, extracted] of Object.entries(features.concepts || {})) {
    const config = (SCORING_CONFIG.taxonomy || []).find((item) => String(item.concept || '').toUpperCase() === concept)
    const weight = Number(config?.weight || 0) * Number(extracted.contextMultiplier || 0)
    if (weight <= 0) continue
    total += weight
    let support = candidateConcepts.has(concept) ? 1 : 0
    if (!support) {
      support = [...candidateConcepts].some((candidate) => concept.startsWith(`${candidate}_`) && /_\d+$/.test(concept)) ? 1 : 0
    }
    if (!support) {
      support = Math.max(0, ...(config?.related || [])
        .filter((item) => candidateConcepts.has(String(item.concept || '').toUpperCase()))
        .map((item) => Number(item.match ?? SCORING_CONFIG.scoring?.defaultSemanticMatch?.RELATED_MEDIUM ?? 0)))
    }
    covered += weight * support
  }
  return total && candidateConcepts.size ? covered / total : null
}

function scoringCandidateSupportsVacancyConcept(candidateConcepts, vacancyConcept) {
  if (candidateConcepts.has(vacancyConcept)) return true
  if ([...candidateConcepts].some((candidate) => vacancyConcept.startsWith(`${candidate}_`) && /_\d+$/.test(vacancyConcept))) return true
  return [...candidateConcepts].some((candidate) => {
    const config = (SCORING_CONFIG.taxonomy || []).find((item) => String(item.concept || '').toUpperCase() === candidate)
    return (config?.related || []).some((item) => String(item.concept || '').toUpperCase() === vacancyConcept)
  })
}

function scoringVacancyMissing(profile, features) {
  const candidateConcepts = new Set((profile.requirements || []).map((item) => String(item.concept || '').toUpperCase()))
  return Object.entries(features.concepts || {})
    .filter(([concept, extracted]) => Number(extracted.match || 0) >= 0.5 && !scoringCandidateSupportsVacancyConcept(candidateConcepts, concept))
    .map(([concept, extracted]) => {
      const config = (SCORING_CONFIG.taxonomy || []).find((item) => String(item.concept || '').toUpperCase() === concept)
      return { concept, weight: Number(config?.weight || 0), mentions: Number(extracted.mentions || 0) }
    })
    .filter((item) => item.weight >= 4)
    .sort((left, right) => right.weight - left.weight || right.mentions - left.mentions || left.concept.localeCompare(right.concept))
    .map((item) => item.concept)
}

function scoringConfidence(profile, features, coverage, experience, seniority) {
  const weights = SCORING_CONFIG.scoring?.componentWeights || {}
  let confidence = 0
  const concepts = Object.values(features.concepts || {})
  if ((profile.requirements || []).length && concepts.length) {
    const conceptConfidence = concepts.reduce((sum, item) => sum + Number(item.confidence || 0), 0) / concepts.length
    confidence += Number(weights.candidateSkillFit || 0) * conceptConfidence
  }
  if (coverage !== null) confidence += Number(weights.vacancyRequirementCoverage || 0)
  if (experience.coefficient !== null) confidence += Number(weights.experience || 0)
  if (seniority.coefficient !== null) confidence += Number(weights.seniority || 0) * Number(features.seniority?.confidence || 0)
  return Math.max(0, Math.min(1, confidence))
}

function scoringEligibility(profile, features, gates) {
  const gateIds = new Set(gates.map((gate) => gate.id))
  const reasons = gates.map((gate) => gate.reason)
  if (gateIds.has('WRONG_PRIMARY_ROLE')) return { status: 'INELIGIBLE', reasons }
  if (!(profile.requirements || []).length) return { status: 'UNCERTAIN', reasons: ['В резюме недостаточно подтвержденных навыков для оценки.'] }
  if (features.role?.primary === 'UNKNOWN' || !Object.keys(features.concepts || {}).length) {
    return { status: 'UNCERTAIN', reasons: reasons.length ? reasons : ['В описании вакансии недостаточно данных для уверенной оценки.'] }
  }
  if (['JAVA_PRIMARY_MISSING', 'DEVOPS_ROLE_MISSING', 'ONE_C_PRIMARY_MISSING'].some((id) => gateIds.has(id))) {
    return { status: 'INELIGIBLE', reasons }
  }
  return { status: 'ELIGIBLE', reasons: [] }
}

function scoringSummary(level, gates) {
  if (gates.length) return `Низкая релевантность: ${gates.map((gate) => gate.reason).join('; ')}`
  const profileCode = String(SCORING_CONFIG.meta?.profile || '').toUpperCase()
  const profileName = profileCode === 'DEVOPS' ? 'DevOps/SRE' : profileCode === 'ONE_C_DEVELOPER' ? '1С-разработки' : 'Java Backend'
  return {
    EXCELLENT_MATCH: `Отличное совпадение по основному ${profileName} стеку.`,
    STRONG_MATCH: `Сильное совпадение по основному ${profileName} стеку.`,
    GOOD_MATCH: `Хорошее совпадение по ${profileName} стеку.`,
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
      effective = scoringEffectiveMatch(resolved.semantic, extracted)
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
  const experienceMatch = scoringExperience(profile.experienceYears ?? null, features.minExperienceYears ?? null)
  const seniorityMatch = scoringSeniority(profile.targetSeniority || 'UNKNOWN', features.seniority?.level || 'UNKNOWN')
  const vacancyRequirementCoverage = scoringVacancyRequirementCoverage(profile, features)
  const componentWeights = SCORING_CONFIG.scoring?.componentWeights || {}
  const combined = Number(componentWeights.candidateSkillFit || 0) * raw
    + Number(componentWeights.vacancyRequirementCoverage || 0) * (vacancyRequirementCoverage ?? 0)
    + Number(componentWeights.experience || 0) * (experienceMatch.coefficient ?? 0)
    + Number(componentWeights.seniority || 0) * (seniorityMatch.coefficient ?? 0)
  const negativeSignals = features.negativeSignals || []
  const gatesApplied = scoringGateResults(profile, features)
  let score = combined * 100 - negativeSignals.reduce((sum, signal) => sum + Number(signal.penalty || 0), 0)
  if (gatesApplied.length) score = Math.min(score, ...gatesApplied.map((gate) => gate.maxScore))
  score = Math.max(0, Math.min(100, score))
  const confidence = scoringConfidence(profile, features, vacancyRequirementCoverage, experienceMatch, seniorityMatch)
  const eligibility = scoringEligibility(profile, features, gatesApplied)
  const vacancyMissing = scoringVacancyMissing(profile, features)
  const band = (SCORING_CONFIG.outputBands || []).find((item) => score >= Number(item.min) && score <= Number(item.max)) || SCORING_CONFIG.outputBands?.at(-1) || { code: 'WEAK_MATCH', labelRu: 'Слабое совпадение' }
  return {
    vacancyId: features.vacancyId,
    scoringVersion: SCORING_ENGINE_VERSION,
    score: Number(score.toFixed(2)),
    confidence: Number((confidence * 100).toFixed(2)),
    eligibility: eligibility.status,
    eligibilityReasons: eligibility.reasons,
    level: band.code,
    label: band.labelRu,
    hardMatchScore: hardTotal ? Number((hardMatched / hardTotal * 100).toFixed(2)) : null,
    vacancyRequirementCoverage: vacancyRequirementCoverage === null ? null : Number((vacancyRequirementCoverage * 100).toFixed(2)),
    categoryScores: Object.fromEntries(Object.entries(categoryScores).map(([key, value]) => [key, Number((value * 100).toFixed(2))])),
    matched,
    partialMatches,
    missingImportant,
    vacancyMissing,
    negativeSignals,
    gatesApplied,
    experienceMatch,
    seniorityMatch,
    summary: scoringSummary(band.code, gatesApplied)
  }
}

function scoringCandidateProfile(account) {
  const resume = account.resume || {}
  const onboarding = account.onboarding || {}
  const position = scoringNormalizeText(resume.position)
  const skills = Array.isArray(resume.skills) ? resume.skills : []
  const skillNames = skills.filter((skill) => skill?.confirmed !== false).map((skill) => scoringNormalizeText(skill?.name))
  const signalText = `${position} ${skillNames.join(' ')}`
  const explicitProfile = String(resume.targetRole || '').toUpperCase()
  let profile = ['JAVA_BACKEND', 'DEVOPS', 'ONE_C_DEVELOPER', 'UNKNOWN'].includes(explicitProfile) ? explicitProfile : ''
  if (!profile) {
    const scores = {
      DEVOPS: ['devops', 'sre', 'kubernetes', 'docker', 'ansible', 'terraform', 'helm', 'linux', 'ci/cd'].filter((value) => signalText.includes(value)).length,
      ONE_C_DEVELOPER: ['1с', '1c', 'конфигуратор', 'скд', 'бсп'].filter((value) => signalText.includes(value)).length,
      JAVA_BACKEND: ['java', 'spring', 'hibernate', 'jvm'].filter((value) => signalText.includes(value)).length
    }
    const ranked = Object.entries(scores).sort((left, right) => right[1] - left[1])
    profile = ranked[0][1] >= 2 && ranked[0][1] > ranked[1][1] ? ranked[0][0] : 'UNKNOWN'
  }
  const requirements = []
  for (const skill of skills) {
    if (skill?.confirmed === false) continue
    const name = scoringNormalizeText(skill?.name)
    const concept = (SCORING_CONFIG.taxonomy || []).find((item) => (item.aliases || []).some((alias) => scoringPattern(scoringNormalizeText(alias)).test(name)))
    if (!concept || requirements.some((item) => item.concept === concept.concept)) continue
    const requirementConcept = String(concept.concept).toUpperCase()
    const mustHave = profile === 'DEVOPS'
      ? ['LINUX', 'KUBERNETES', 'TERRAFORM', 'ANSIBLE'].includes(requirementConcept)
      : profile === 'ONE_C_DEVELOPER'
        ? ['ONE_C_PLATFORM', 'ONE_C_QUERY_LANGUAGE'].includes(requirementConcept)
        : requirementConcept === 'JAVA'
    requirements.push({ concept: requirementConcept, importance: mustHave ? 'MUST_HAVE' : 'STRONG_PREFERENCE' })
  }
  const role = profile === 'DEVOPS'
    ? 'DEVOPS'
    : profile === 'ONE_C_DEVELOPER'
      ? 'ONE_C_DEVELOPER'
    : profile === 'JAVA_BACKEND' && (/backend|back-end|java|сервер|бэкенд|разработчик/iu.test(position) || onboarding.roles?.some((value) => /backend|back-end|java/iu.test(value))) ? 'BACKEND' : 'UNKNOWN'
  const levelAliases = SCORING_CONFIG.seniority?.aliases || {}
  const targetSeniority = Object.entries(levelAliases).find(([, aliases]) => aliases.some((alias) => scoringPattern(scoringNormalizeText(alias)).test(position)))?.[0]
    || (Number(resume.experienceYears) >= 5 ? 'SENIOR' : Number(resume.experienceYears) >= 3 ? 'MIDDLE' : 'UNKNOWN')
  return { targetRole: role, targetProfile: profile, targetSeniority, experienceYears: Number.isFinite(Number(resume.experienceYears)) ? Number(resume.experienceYears) : null, requirements, excludedConcepts: [] }
}
