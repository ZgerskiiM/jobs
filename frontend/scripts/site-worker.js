const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, password_hash TEXT, name TEXT NOT NULL DEFAULT '', telegram_id TEXT UNIQUE, telegram_username TEXT NOT NULL DEFAULT '', telegram_photo_url TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT 'user', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS profiles (user_id INTEGER PRIMARY KEY, onboarding_json TEXT, settings_json TEXT NOT NULL, resume_json TEXT, resume_key TEXT, resume_file_name TEXT, cover_letter TEXT NOT NULL DEFAULT '', saved_job_ids_json TEXT NOT NULL DEFAULT '[]', saved_job_notes_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS applications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, job_id INTEGER NOT NULL, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (user_id, job_id), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS subscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, provider TEXT NOT NULL, external_id TEXT NOT NULL UNIQUE, plan TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', ends_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS payment_events (id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT NOT NULL, external_event_id TEXT NOT NULL UNIQUE, payload_json TEXT NOT NULL, processed_at TEXT, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id INTEGER, action TEXT NOT NULL, object_type TEXT NOT NULL DEFAULT '', object_id TEXT NOT NULL DEFAULT '', metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_applications_user ON applications(user_id, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_subscriptions_active ON subscriptions(user_id, status, ends_at)`,
  `CREATE TABLE IF NOT EXISTS hh_cache (cache_key TEXT PRIMARY KEY, payload_json TEXT NOT NULL, expires_at TEXT NOT NULL)`,
]
const DEFAULT_SETTINGS = {
  notifications: { newJobs: true, salaryDigest: true, trendDigest: false, companyActivity: false },
  account: { profileVisible: true, showSalaryExpectation: false },
}
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const TELEGRAM_MAX_AGE_SECONDS = 86400
let schemaPromise

function json(data, status = 200, extraHeaders = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders })
  return new Response(JSON.stringify(data), { status, headers })
}

function withCookie(response, value) {
  response.headers.append('Set-Cookie', value)
  return response
}

function redirect(location) {
  return new Response(null, { status: 302, headers: { Location: location } })
}

function cookie(request, name) {
  const header = request.headers.get('Cookie') || ''
  const pair = header.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${name}=`))
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : ''
}

function safeJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback } catch { return fallback }
}

function now() { return new Date().toISOString() }

function csrfCookie() {
  return `csrftoken=${encodeURIComponent(crypto.randomUUID())}; Path=/; SameSite=Lax; Secure`
}

function sessionCookie(token) {
  return `jobs_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${SESSION_TTL_MS / 1000}`
}

function clearSessionCookie() {
  return 'jobs_session=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0'
}

async function initSchema(env) {
  if (!schemaPromise) {
    schemaPromise = env.DB.batch(schemaStatements.map((statement) => env.DB.prepare(statement))).catch((error) => {
      schemaPromise = undefined
      throw error
    })
  }
  await schemaPromise
}

async function body(request) {
  const contentType = request.headers.get('content-type') || ''
  if (contentType.includes('multipart/form-data')) return request.formData()
  return request.json().catch(() => ({}))
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 120000, hash: 'SHA-256' }, key, 256)
  return `pbkdf2$120000$${toBase64(salt)}$${toBase64(new Uint8Array(bits))}`
}

async function verifyPassword(password, encoded) {
  if (!encoded?.startsWith('pbkdf2$')) return false
  const [, iterations, saltText, expectedText] = encoded.split('$')
  const salt = fromBase64(saltText)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: Number(iterations), hash: 'SHA-256' }, key, 256)
  return constantTimeEqual(new Uint8Array(bits), fromBase64(expectedText))
}

function toBase64(bytes) {
  let value = ''
  for (const byte of bytes) value += String.fromCharCode(byte)
  return btoa(value)
}

function fromBase64(value) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false
  let result = 0
  for (let index = 0; index < left.length; index += 1) result |= left[index] ^ right[index]
  return result === 0
}

async function telegramIsValid(claims, env) {
  if (!env.TELEGRAM_AUTH_BOT_TOKEN || !claims.id || !claims.auth_date || !claims.hash) return false
  const authDate = Number(claims.auth_date)
  if (!Number.isFinite(authDate) || Math.abs(Date.now() / 1000 - authDate) > TELEGRAM_MAX_AGE_SECONDS) return false
  const checkString = Object.keys(claims).filter((key) => key !== 'hash').sort().map((key) => `${key}=${claims[key]}`).join('\n')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.TELEGRAM_AUTH_BOT_TOKEN))
  const key = await crypto.subtle.importKey('raw', digest, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(checkString)))
  const expected = signature.reduce((result, byte) => result + byte.toString(16).padStart(2, '0'), '')
  return expected === String(claims.hash).toLowerCase()
}

async function createSession(env, userId) {
  const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '')
  await env.DB.prepare('INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(token, userId, new Date(Date.now() + SESSION_TTL_MS).toISOString(), now()).run()
  return token
}

async function currentUser(request, env) {
  const token = cookie(request, 'jobs_session')
  if (!token) return null
  const row = await env.DB.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?`).bind(token, now()).first()
  return row || null
}

async function ensureProfile(env, userId) {
  await env.DB.prepare(`INSERT OR IGNORE INTO profiles (user_id, settings_json, updated_at) VALUES (?, ?, ?)`).bind(userId, JSON.stringify(DEFAULT_SETTINGS), now()).run()
  return env.DB.prepare('SELECT * FROM profiles WHERE user_id = ?').bind(userId).first()
}

async function accountPayload(env, user, isNew = false) {
  const profile = await ensureProfile(env, user.id)
  const resume = await refreshResumeAnalysis(env, profile)
  const applications = await env.DB.prepare('SELECT payload_json FROM applications WHERE user_id = ? ORDER BY updated_at DESC').bind(user.id).all()
  const pro = await env.DB.prepare(`SELECT id FROM subscriptions WHERE user_id = ? AND status = 'active' AND ends_at > ? LIMIT 1`).bind(user.id, now()).first()
  return {
    user: { id: user.id, name: user.name || user.telegram_username || user.email.split('@')[0], email: user.email.endsWith('@telegram.local') ? null : user.email, telegram: user.telegram_username ? `@${user.telegram_username}` : null, telegramPhotoUrl: user.telegram_photo_url || null },
    onboarding: safeJson(profile.onboarding_json, null), settings: safeJson(profile.settings_json, DEFAULT_SETTINGS), resume, coverLetter: profile.cover_letter || '',
    savedJobIds: safeJson(profile.saved_job_ids_json, []), savedJobNotes: safeJson(profile.saved_job_notes_json, {}), applications: applications.results.map((item) => safeJson(item.payload_json, {})), isPro: Boolean(pro), isNew,
  }
}

async function refreshResumeAnalysis(env, profile) {
  const resume = safeJson(profile.resume_json, null)
  if (!resume || resume.analysisVersion === RESUME_ANALYSIS_VERSION || !profile.resume_key || !env.MEDIA) return resume
  try {
    const object = await env.MEDIA.get(profile.resume_key)
    if (!object) return resume
    const analysis = await analyzeResume(profile.resume_file_name || resume.fileName || 'resume', new Uint8Array(await object.arrayBuffer()))
    const updated = { ...resume, ...analysis }
    await env.DB.prepare('UPDATE profiles SET resume_json = ?, updated_at = ? WHERE user_id = ?').bind(JSON.stringify(updated), now(), profile.user_id).run()
    return updated
  } catch {
    return resume
  }
}

async function requireUser(request, env) {
  const user = await currentUser(request, env)
  return user ? { user } : { response: json({ message: 'Требуется вход' }, 401) }
}

function checkCsrf(request) {
  const method = request.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD' || request.url.includes('/auth/telegram/')) return true
  return cookie(request, 'csrftoken') && cookie(request, 'csrftoken') === request.headers.get('X-CSRFToken')
}

async function authEmail(request, env) {
  const data = await body(request)
  const email = String(data.email || '').trim().toLowerCase()
  const password = String(data.password || '')
  const mode = data.mode === 'login' ? 'login' : 'register'
  if (!email.includes('@') || password.length < 8) return json({ message: 'Проверь email и пароль' }, 400)
  let user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first()
  let isNew = false
  if (mode === 'register') {
    if (user) return json({ message: 'Аккаунт с таким email уже существует' }, 409)
    user = { email, name: email.split('@')[0], telegram_username: '', telegram_photo_url: '' }
    const result = await env.DB.prepare('INSERT INTO users (email, password_hash, name, telegram_username, telegram_photo_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(email, await hashPassword(password), user.name, '', '', now(), now()).run()
    user.id = result.meta.last_row_id
    isNew = true
  } else if (!user || !(await verifyPassword(password, user.password_hash))) {
    return json({ message: 'Неверный email или пароль' }, 401)
  }
  await ensureProfile(env, user.id)
  return withCookie(json(await accountPayload(env, user, isNew)), sessionCookie(await createSession(env, user.id)))
}

async function authTelegram(request, env) {
  const source = request.method === 'GET' ? new URL(request.url).searchParams : await body(request)
  const claims = Object.fromEntries(source.entries())
  if (!(await telegramIsValid(claims, env))) {
    if (request.method === 'GET') return redirect(`${new URL(request.url).origin}/?auth_error=telegram`)
    return json({ message: 'Telegram не подтвердил вход или подпись устарела' }, 401)
  }
  const telegramId = String(claims.id)
  let user = await env.DB.prepare('SELECT * FROM users WHERE telegram_id = ?').bind(telegramId).first()
  const displayName = [claims.first_name, claims.last_name].filter(Boolean).join(' ').trim() || (claims.username ? `@${claims.username}` : 'telegram user')
  if (!user) {
    const email = `telegram_${telegramId}@telegram.local`
    const result = await env.DB.prepare('INSERT INTO users (email, name, telegram_id, telegram_username, telegram_photo_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(email, displayName, telegramId, claims.username || '', claims.photo_url || '', now(), now()).run()
    user = { id: result.meta.last_row_id, email, name: displayName, telegram_username: claims.username || '', telegram_photo_url: claims.photo_url || '' }
  } else {
    await env.DB.prepare('UPDATE users SET name = ?, telegram_username = ?, telegram_photo_url = ?, updated_at = ? WHERE id = ?').bind(displayName, claims.username || '', claims.photo_url || '', now(), user.id).run()
    user = { ...user, name: displayName, telegram_username: claims.username || '', telegram_photo_url: claims.photo_url || '' }
  }
  await ensureProfile(env, user.id)
  const token = await createSession(env, user.id)
  if (request.method === 'GET') return withCookie(redirect(`${new URL(request.url).origin}/profile`), sessionCookie(token))
  return withCookie(json(await accountPayload(env, user)), sessionCookie(token))
}

async function profilePatch(request, env, user) {
  const data = await body(request)
  const profile = await ensureProfile(env, user.id)
  const name = data.name === undefined ? user.name : String(data.name).trim()
  const onboarding = data.onboarding === undefined ? profile.onboarding_json : JSON.stringify(data.onboarding)
  const settings = data.settings === undefined ? profile.settings_json : JSON.stringify(data.settings)
  const coverLetter = data.coverLetter === undefined ? profile.cover_letter : String(data.coverLetter)
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET name = ?, updated_at = ? WHERE id = ?').bind(name || user.name, now(), user.id),
    env.DB.prepare('UPDATE profiles SET onboarding_json = ?, settings_json = ?, cover_letter = ?, updated_at = ? WHERE user_id = ?').bind(onboarding, settings, coverLetter, now(), user.id),
  ])
  return json(await accountPayload(env, { ...user, name: name || user.name }))
}

async function savedJobs(request, env, user) {
  const data = await body(request)
  const profile = await ensureProfile(env, user.id)
  const jobId = Number(data.jobId)
  if (!Number.isInteger(jobId) || jobId < 1) return json({ message: 'Некорректный id вакансии' }, 400)
  const ids = new Set(safeJson(profile.saved_job_ids_json, []))
  if (data.saved === false) ids.delete(jobId); else if (data.saved !== undefined || data.note !== undefined) ids.add(jobId)
  const notes = safeJson(profile.saved_job_notes_json, {})
  if (data.note !== undefined) { if (data.note) notes[String(jobId)] = String(data.note); else delete notes[String(jobId)] }
  const savedJobIds = [...ids].sort((a, b) => b - a)
  await env.DB.prepare('UPDATE profiles SET saved_job_ids_json = ?, saved_job_notes_json = ?, updated_at = ? WHERE user_id = ?').bind(JSON.stringify(savedJobIds), JSON.stringify(notes), now(), user.id).run()
  return json({ savedJobIds, savedJobNotes: notes })
}

const RESUME_ANALYSIS_VERSION = 3
const RESUME_SKILLS = [
  ['Python', 'Языки', ['python', 'питон']], ['JavaScript', 'Языки', ['javascript', 'js']], ['TypeScript', 'Языки', ['typescript', 'ts']],
  ['Go', 'Языки', ['go', 'golang', 'го']], ['Rust', 'Языки', ['rust']], ['Java', 'Языки', ['java']], ['Kotlin', 'Языки', ['kotlin']],
  ['C#', 'Языки', ['c#', 'c sharp']], ['C++', 'Языки', ['c++', 'cpp']], ['PHP', 'Языки', ['php']], ['Ruby', 'Языки', ['ruby']], ['SQL', 'Языки', ['sql']],
  ['Bash', 'Языки', ['bash', 'shell']], ['React', 'Фреймворки', ['react', 'react.js', 'reactjs']], ['Vue', 'Фреймворки', ['vue', 'vue.js', 'vuejs']],
  ['Angular', 'Фреймворки', ['angular']], ['Next.js', 'Фреймворки', ['next.js', 'nextjs']], ['Node.js', 'Фреймворки', ['node.js', 'nodejs']],
  ['Django', 'Фреймворки', ['django']], ['FastAPI', 'Фреймворки', ['fastapi']], ['Spring', 'Фреймворки', ['spring']], ['Spring Boot', 'Фреймворки', ['spring boot']],
  ['Spring Security', 'Фреймворки', ['spring security']], ['Spring Data JPA', 'Фреймворки', ['spring data jpa']], ['Hibernate', 'Фреймворки', ['hibernate']],
  ['Docker', 'Инфраструктура', ['docker']], ['Kubernetes', 'Инфраструктура', ['kubernetes', 'k8s']], ['Terraform', 'Инфраструктура', ['terraform']],
  ['Ansible', 'Инфраструктура', ['ansible']], ['Helm', 'Инфраструктура', ['helm']], ['AWS', 'Инфраструктура', ['aws', 'amazon web services']],
  ['Azure', 'Инфраструктура', ['azure']], ['GCP', 'Инфраструктура', ['gcp', 'google cloud']], ['Linux', 'Инфраструктура', ['linux']], ['Nginx', 'Инфраструктура', ['nginx']],
  ['GitHub Actions', 'Инфраструктура', ['github actions']], ['GitLab CI', 'Инфраструктура', ['gitlab ci']], ['Prometheus', 'Инфраструктура', ['prometheus']], ['Grafana', 'Инфраструктура', ['grafana']],
  ['PostgreSQL', 'Базы данных', ['postgresql', 'postgres', 'постгрес']], ['MySQL', 'Базы данных', ['mysql']], ['MongoDB', 'Базы данных', ['mongodb', 'mongo']],
  ['Redis', 'Базы данных', ['redis']], ['ClickHouse', 'Базы данных', ['clickhouse']], ['Elasticsearch', 'Базы данных', ['elasticsearch', 'elastic search']],
  ['REST API', 'Протоколы и фреймворки', ['rest api', 'restful', 'rest']], ['GraphQL', 'Протоколы и фреймворки', ['graphql']], ['gRPC', 'Протоколы и фреймворки', ['grpc']],
  ['Kafka', 'Протоколы и фреймворки', ['kafka', 'apache kafka']], ['RabbitMQ', 'Протоколы и фреймворки', ['rabbitmq']], ['OpenAPI', 'Протоколы и фреймворки', ['openapi', 'swagger']],
  ['OAuth', 'Протоколы и фреймворки', ['oauth']], ['CI/CD', 'Практики', ['ci/cd', 'cicd', 'continuous integration']], ['Git', 'Практики', ['git']],
  ['System Design', 'Практики', ['system design', 'системный дизайн']], ['Microservices', 'Практики', ['microservices', 'микросервисы']], ['Code Review', 'Практики', ['code review', 'код-ревью']],
  ['Agile', 'Практики', ['agile']], ['Scrum', 'Практики', ['scrum']], ['JUnit', 'Практики', ['junit']], ['Mockito', 'Практики', ['mockito']],
  ['Testcontainers', 'Практики', ['testcontainers']], ['Maven', 'Практики', ['maven']], ['Gradle', 'Практики', ['gradle']], ['Jenkins', 'Практики', ['jenkins']],
  ['Liquibase', 'Практики', ['liquibase']], ['ELK', 'Практики', ['elk']], ['SOLID', 'Практики', ['solid']], ['Selenium', 'Практики', ['selenium']], ['Playwright', 'Практики', ['playwright']],
]
const RESUME_POSITION_RE = /developer|engineer|разработчик|инженер|аналитик|analyst|designer|дизайнер|manager|менеджер|devops|sre|qa|тестировщик|data scientist|machine learning/i

function hexNumber(bytes, offset, length) {
  let value = 0
  for (let index = 0; index < length; index += 1) value += bytes[offset + index] * 2 ** (8 * index)
  return value
}

async function inflate(bytes, format = 'deflate-raw') {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function docxEntry(bytes, wantedName) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const decoder = new TextDecoder()
  for (let end = bytes.length - 22; end >= 0; end -= 1) {
    if (hexNumber(bytes, end, 4) !== 0x06054b50) continue
    const centralOffset = view.getUint32(end + 16, true)
    const centralSize = view.getUint32(end + 12, true)
    let offset = centralOffset
    const centralEnd = centralOffset + centralSize
    while (offset < centralEnd && hexNumber(bytes, offset, 4) === 0x02014b50) {
      const method = view.getUint16(offset + 10, true)
      const compressedSize = view.getUint32(offset + 20, true)
      const nameLength = view.getUint16(offset + 28, true)
      const extraLength = view.getUint16(offset + 30, true)
      const commentLength = view.getUint16(offset + 32, true)
      const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength))
      const localOffset = view.getUint32(offset + 42, true)
      if (name === wantedName) {
        const localNameLength = view.getUint16(localOffset + 26, true)
        const localExtraLength = view.getUint16(localOffset + 28, true)
        const compressed = bytes.slice(localOffset + 30 + localNameLength + localExtraLength, localOffset + 30 + localNameLength + localExtraLength + compressedSize)
        if (method === 0) return compressed
        if (method === 8) return inflate(compressed)
        throw new Error('Неподдерживаемое сжатие DOCX')
      }
      offset += 46 + nameLength + extraLength + commentLength
    }
    break
  }
  throw new Error('В DOCX не найден текст документа')
}

function decodeXml(value) {
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}

async function extractDocxText(bytes) {
  const xml = new TextDecoder().decode(await docxEntry(bytes, 'word/document.xml'))
  const paragraphs = []
  const paragraphRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/gi
  let paragraph
  while ((paragraph = paragraphRe.exec(xml))) {
    const parts = []
    const textRe = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gi
    let text
    while ((text = textRe.exec(paragraph[1]))) parts.push(decodeXml(text[1]))
    if (parts.length) paragraphs.push(parts.join(''))
  }
  return paragraphs.join('\n')
}

function parseCMap(value) {
  const codeLength = Number((value.match(/begincodespacerange\s*<([0-9a-f]+)>/i) || [0, '00'])[1].length / 2)
  const map = new Map()
  const chars = value.match(/beginbfchar([\s\S]*?)endbfchar/i)?.[1] || ''
  for (const match of chars.matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi)) map.set(parseInt(match[1], 16), String.fromCodePoint(parseInt(match[2], 16)))
  const ranges = value.match(/beginbfrange([\s\S]*?)endbfrange/i)?.[1] || ''
  for (const match of ranges.matchAll(/<([0-9a-f]+)>\s+<([0-9a-f]+)>\s+<([0-9a-f]+)>/gi)) {
    const start = parseInt(match[1], 16); const finish = parseInt(match[2], 16); const target = parseInt(match[3], 16)
    for (let code = start; code <= finish; code += 1) map.set(code, String.fromCodePoint(target + code - start))
  }
  return { codeLength, map }
}

function decodeMapped(bytes, cmap) {
  if (!cmap) return new TextDecoder('latin1').decode(bytes)
  let result = ''
  for (let index = 0; index < bytes.length; index += cmap.codeLength) {
    let code = 0
    for (let part = 0; part < cmap.codeLength && index + part < bytes.length; part += 1) code = (code << 8) | bytes[index + part]
    result += cmap.map.get(code) ?? (code < 128 ? String.fromCharCode(code) : '')
  }
  return result
}

function pdfLiteral(value, start) {
  let index = start + 1; let depth = 1; const bytes = []
  while (index < value.length && depth) {
    const char = value[index]
    if (char === '\\') {
      const next = value[index + 1]
      if (/[0-7]/.test(next || '')) {
        const octal = value.slice(index + 1).match(/^[0-7]{1,3}/)?.[0] || ''
        bytes.push(parseInt(octal, 8)); index += octal.length + 1; continue
      }
      bytes.push({ n: 10, r: 13, t: 9, b: 8, f: 12 }[next] ?? next?.charCodeAt(0) ?? 0); index += 2; continue
    }
    if (char === '(') { depth += 1; bytes.push(char.charCodeAt(0)); index += 1; continue }
    if (char === ')') { depth -= 1; if (depth) bytes.push(char.charCodeAt(0)); index += 1; continue }
    bytes.push(char.charCodeAt(0)); index += 1
  }
  return { bytes: new Uint8Array(bytes), end: index }
}

function pdfHex(value, start) {
  const end = value.indexOf('>', start + 1)
  const hex = (end < 0 ? value.slice(start + 1) : value.slice(start + 1, end)).replace(/\s/g, '')
  const bytes = new Uint8Array(Math.ceil(hex.length / 2))
  for (let index = 0; index < hex.length; index += 2) bytes[index / 2] = parseInt(hex.slice(index, index + 2).padEnd(2, '0'), 16)
  return { bytes, end: end < 0 ? value.length : end + 1 }
}

function pdfContentText(value, fonts) {
  let font = ''; let result = ''; let index = 0
  const append = (bytes) => { result += decodeMapped(bytes, fonts[font]) + ' ' }
  while (index < value.length) {
    const fontMatch = value.slice(index).match(/^\/([^\s]+)\s+[\d.-]+\s+Tf\b/)
    if (fontMatch) { font = fontMatch[1]; index += fontMatch[0].length; continue }
    if (value[index] === '(') {
      const token = pdfLiteral(value, index); let next = token.end
      while (/\s/.test(value[next] || '')) next += 1
      if (/^(?:Tj|TJ|'|")\b/.test(value.slice(next))) append(token.bytes)
      index = token.end; continue
    }
    if (value[index] === '<' && value[index + 1] !== '<') {
      const token = pdfHex(value, index); let next = token.end
      while (/\s/.test(value[next] || '')) next += 1
      if (/^(?:Tj|TJ|'|")\b/.test(value.slice(next))) append(token.bytes)
      index = token.end; continue
    }
    if (value[index] === '[') {
      const close = value.indexOf(']', index + 1); const array = close < 0 ? value.slice(index + 1) : value.slice(index + 1, close); let part = 0
      while (part < array.length) {
        if (array[part] === '(') { const token = pdfLiteral(array, part); append(token.bytes); part = token.end }
        else if (array[part] === '<' && array[part + 1] !== '<') { const token = pdfHex(array, part); append(token.bytes); part = token.end }
        else part += 1
      }
      index = close < 0 ? value.length : close + 1; continue
    }
    index += 1
  }
  return result
}

async function extractPdfText(bytes) {
  if (new TextDecoder('latin1').decode(bytes.slice(0, 5)) !== '%PDF-') throw new Error('Файл не похож на PDF')
  const source = new TextDecoder('latin1').decode(bytes); const objects = new Map(); const objectRe = /(\d+)\s+(\d+)\s+obj\b/g; let match
  while ((match = objectRe.exec(source))) { const end = source.indexOf('endobj', objectRe.lastIndex); if (end < 0) continue; objects.set(Number(match[1]), { body: source.slice(objectRe.lastIndex, end), start: match.index, end }); objectRe.lastIndex = end + 6 }
  const streams = new Map(); const streamRe = /stream\r?\n/g
  while ((match = streamRe.exec(source))) {
    const end = source.indexOf('endstream', streamRe.lastIndex); if (end < 0) continue
    const owner = [...objects.entries()].find(([, object]) => match.index > object.start && match.index < object.end)?.[0]
    if (owner === undefined) continue
    let data = bytes.slice(streamRe.lastIndex, end); while (data.at(-1) === 10 || data.at(-1) === 13) data = data.slice(0, -1)
    const dictionary = objects.get(owner)?.body || ''
    if (dictionary.includes('/FlateDecode')) {
      try { data = await inflate(data, 'deflate') } catch { streamRe.lastIndex = end + 10; continue }
    }
    streams.set(owner, data); streamRe.lastIndex = end + 10
  }
  const cmapByFont = new Map(); const fontRe = /\/ToUnicode\s+(\d+)\s+\d+\s+R/g
  for (const [fontId, object] of objects) { const cmapRef = fontRe.exec(object.body)?.[1]; if (cmapRef && streams.has(Number(cmapRef))) cmapByFont.set(fontId, parseCMap(new TextDecoder('latin1').decode(streams.get(Number(cmapRef))))) }
  const fonts = {}; const resourceRe = /\/Font\s*<<([\s\S]*?)>>/g
  for (const object of objects.values()) { let resources; while ((resources = resourceRe.exec(object.body))) for (const font of resources[1].matchAll(/\/([\w.-]+)\s+(\d+)\s+\d+\s+R/g)) if (cmapByFont.has(Number(font[2]))) fonts[font[1]] = cmapByFont.get(Number(font[2])) }
  return [...streams.entries()].filter(([id]) => !cmapByFont.has(id)).map(([, data]) => pdfContentText(new TextDecoder('latin1').decode(data), fonts)).join('\n')
}

function normalizedResumeText(text) {
  return text.replace(/(?<=\w)-\s*\n\s*(?=\w)/g, '').replace(/\s+/g, ' ').trim()
}

function resumeSkills(text) {
  const normalized = normalizedResumeText(text).toLowerCase()
  return RESUME_SKILLS.filter(([, , aliases]) => aliases.some((alias) => {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\ /g, '\\s+')
    return new RegExp(`(?<![\\p{L}\\p{N}_+#.])${escaped}(?![\\p{L}\\p{N}_+#.])`, 'iu').test(normalized)
  })).map(([name, category]) => ({ name, category, confirmed: true }))
}

function resumePosition(text) {
  const normalized = normalizedResumeText(text)
  const match = normalized.match(/(?:[A-Za-z0-9+#./-]+\s+){0,3}(?:developer|engineer|analyst|designer|manager|devops|sre|qa|data scientist|machine learning)\b/i)
    || normalized.match(/(?:[А-Яа-яЁё0-9+#./-]+\s+){0,3}(?:разработчик|инженер|аналитик|дизайнер|менеджер|тестировщик)\b/i)
  return match?.[0].trim() || ''
}

function resumeExperience(text) {
  const normalized = normalizedResumeText(text)
  const match = normalized.match(/(?:опыт|experience)[^.!?]{0,100}?(\d{1,2}(?:[.,]\d+)?)\s*(лет|года|год|years?|yrs?)(?=$|[^\p{L}\p{N}_])/iu)
  if (!match) return ''
  return `${match[1].replace(',', '.')} ${/years?|yrs?/i.test(match[2]) ? 'лет' : match[2]}`
}

async function analyzeResume(fileName, bytes) {
  const lowerName = fileName.toLowerCase(); const text = lowerName.endsWith('.pdf') ? await extractPdfText(bytes) : lowerName.endsWith('.docx') ? await extractDocxText(bytes) : ''
  if (!text.trim()) throw new Error('Не удалось извлечь текст. Если это скан, сохраните резюме с текстовым слоем')
  return { analysisVersion: RESUME_ANALYSIS_VERSION, experience: resumeExperience(text), position: resumePosition(text), skills: resumeSkills(text) }
}

async function resume(request, env, user) {
  const profile = await ensureProfile(env, user.id)
  if (request.method === 'DELETE') {
    if (profile.resume_key && env.MEDIA) await env.MEDIA.delete(profile.resume_key)
    await env.DB.prepare('UPDATE profiles SET resume_json = NULL, resume_key = NULL, resume_file_name = NULL, updated_at = ? WHERE user_id = ?').bind(now(), user.id).run()
    return json({ resume: null })
  }
  if (request.method === 'PATCH') {
    const data = await body(request)
    const current = safeJson(profile.resume_json, null)
    if (!current || !Array.isArray(data.skills)) return json({ message: 'Сначала загрузите резюме' }, 400)
    const updated = { ...current, skills: data.skills }
    await env.DB.prepare('UPDATE profiles SET resume_json = ?, updated_at = ? WHERE user_id = ?').bind(JSON.stringify(updated), now(), user.id).run()
    return json({ resume: updated })
  }
  const form = await body(request)
  const file = form.get('resume')
  if (!file || typeof file.arrayBuffer !== 'function') return json({ message: 'Файл резюме не получен' }, 400)
  if (file.size > 8 * 1024 * 1024) return json({ message: 'Файл больше 8 МБ' }, 413)
  const fileName = String(file.name || 'resume')
  if (!/\.(pdf|docx)$/i.test(fileName)) return json({ message: 'Поддерживаются только файлы PDF и DOCX' }, 400)
  const bytes = new Uint8Array(await file.arrayBuffer())
  let analysis
  try { analysis = await analyzeResume(fileName, bytes) } catch (error) { return json({ message: error instanceof Error ? error.message : 'Не удалось проанализировать резюме' }, 400) }
  const key = `resumes/${user.id}/${crypto.randomUUID()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  if (env.MEDIA) await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: file.type || 'application/octet-stream' } })
  const resumeData = { fileName, uploadedAt: now().slice(0, 10), ...analysis }
  if (profile.resume_key && env.MEDIA) await env.MEDIA.delete(profile.resume_key)
  await env.DB.prepare('UPDATE profiles SET resume_json = ?, resume_key = ?, resume_file_name = ?, updated_at = ? WHERE user_id = ?').bind(JSON.stringify(resumeData), key, fileName, now(), user.id).run()
  return json({ resume: resumeData })
}

async function applications(request, env, user, jobId) {
  if (request.method === 'POST') {
    const data = await body(request)
    if (!data.id) return json({ message: 'В отклике не указан id вакансии' }, 400)
    const id = Number(data.id)
    await env.DB.prepare(`INSERT INTO applications (user_id, job_id, payload_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, job_id) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at`).bind(user.id, id, JSON.stringify(data), now()).run()
    return json(data, 201)
  }
  const data = await body(request)
  const current = await env.DB.prepare('SELECT payload_json FROM applications WHERE user_id = ? AND job_id = ?').bind(user.id, jobId).first()
  if (!current) return json({ message: 'Отклик не найден' }, 404)
  const updated = { ...safeJson(current.payload_json, {}), ...(data || {}) }
  await env.DB.prepare('UPDATE applications SET payload_json = ?, updated_at = ? WHERE user_id = ? AND job_id = ?').bind(JSON.stringify(updated), now(), user.id, jobId).run()
  return json(updated)
}

function stripHtml(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim()
}

function hhSkills(item) {
  const text = `${item.name || ''} ${item.snippet?.requirement || ''} ${item.snippet?.responsibility || ''}`.toLowerCase()
  const names = ['Java', 'Python', 'Go', 'Rust', 'Kotlin', 'C++', 'C#', 'JavaScript', 'TypeScript', 'React', 'Vue', 'Node.js', 'PostgreSQL', 'Redis', 'Kafka', 'Docker', 'Kubernetes', 'Terraform', 'SQL', 'Linux', 'Golang']
  return names.filter((name) => text.includes(name.toLowerCase()))
}

function mapHhVacancy(item) {
  const employer = item.employer?.name || 'Работодатель на HH.ru'
  const area = item.area?.name || item.address?.city || 'Россия'
  const workplace = [item.schedule?.name, item.employment?.name].filter(Boolean).join(' · ')
  const description = [item.snippet?.requirement, item.snippet?.responsibility].filter(Boolean).map(stripHtml).join(' ') || 'Описание вакансии доступно на HH.ru.'
  return { id: item.id, company: employer, title: item.name, location: area, workplace_type: workplace, description, url: item.alternate_url || `https://hh.ru/vacancy/${item.id}`, posted_at: item.published_at, source_key: 'hh', technologies: hhSkills(item) }
}

async function hhVacancies(request, env) {
  const incoming = new URL(request.url)
  const query = new URLSearchParams()
  query.set('text', (incoming.searchParams.get('text') || 'разработчик').slice(0, 120))
  query.set('area', (incoming.searchParams.get('area') || '1').slice(0, 8))
  query.set('page', String(Math.min(4, Math.max(0, Number(incoming.searchParams.get('page') || 0)))))
  query.set('per_page', String(Math.min(100, Math.max(1, Number(incoming.searchParams.get('per_page') || 100)))))
  query.set('order_by', incoming.searchParams.get('order_by') || 'publication_time')
  const cacheKey = query.toString()
  const cached = await env.DB.prepare('SELECT payload_json FROM hh_cache WHERE cache_key = ? AND expires_at > ?').bind(cacheKey, now()).first()
  if (cached) return json(safeJson(cached.payload_json, { source: 'hh', vacancies: [], meta: { updated_at: now() } }))
  const userAgent = env.HH_USER_AGENT || 'jobs.dev/1.0 (support@jobs.dev)'
  const headers = { Accept: 'application/json', 'HH-User-Agent': userAgent, 'User-Agent': userAgent }
  if (env.HH_API_TOKEN) headers.Authorization = `Bearer ${env.HH_API_TOKEN}`
  const response = await fetch(`https://api.hh.ru/vacancies?${query.toString()}`, { headers })
  if (!response.ok) {
    const message = response.status === 403
      ? 'HH.ru отклонил запрос (403). Для production нужен OAuth access token в секрете HH_API_TOKEN.'
      : response.status === 429
        ? 'HH.ru временно ограничил частоту запросов. Повторите позже.'
        : `HH.ru вернул ошибку ${response.status}`
    return json({ source: 'hh', vacancies: [], error: message, meta: { status: response.status, updated_at: now() } }, response.status === 429 ? 429 : 502)
  }
  const payload = await response.json()
  const result = { source: 'hh', vacancies: (payload.items || []).map(mapHhVacancy), meta: { found: payload.found || 0, page: payload.page || 0, pages: payload.pages || 0, updated_at: now() } }
  await env.DB.prepare('INSERT INTO hh_cache (cache_key, payload_json, expires_at) VALUES (?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET payload_json = excluded.payload_json, expires_at = excluded.expires_at').bind(cacheKey, JSON.stringify(result), new Date(Date.now() + 5 * 60 * 1000).toISOString()).run()
  return json(result)
}

async function routeApi(request, env) {
  const url = new URL(request.url)
  const path = url.pathname
  if (path === '/api/vacancies/hh/' && request.method === 'GET') return hhVacancies(request, env)
  if (path === '/api/auth/config/' && request.method === 'GET') return json({ enabled: Boolean(env.TELEGRAM_AUTH_BOT_TOKEN && env.TELEGRAM_AUTH_BOT_USERNAME), username: env.TELEGRAM_AUTH_BOT_USERNAME || '' })
  if (path === '/api/auth/csrf/' && request.method === 'GET') return withCookie(json({ ok: true }), csrfCookie())
  if (path === '/api/auth/telegram/' && ['GET', 'POST'].includes(request.method)) return authTelegram(request, env)
  if (path === '/api/auth/email/' && request.method === 'POST') return authEmail(request, env)
  const auth = await requireUser(request, env)
  if (auth.response) return auth.response
  const { user } = auth
  if (!checkCsrf(request)) return json({ message: 'CSRF-проверка не пройдена' }, 403)
  if (path === '/api/auth/me/' && request.method === 'GET') return json(await accountPayload(env, user))
  if (path === '/api/auth/logout/' && request.method === 'POST') return withCookie(json({ ok: true }), clearSessionCookie())
  if (path === '/api/auth/password/' && request.method === 'POST') {
    const data = await body(request)
    if (String(data.new || '').length < 8 || !(await verifyPassword(String(data.current || ''), user.password_hash))) return json({ message: 'Неверный текущий пароль или новый пароль слишком короткий' }, 400)
    await env.DB.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').bind(await hashPassword(String(data.new)), now(), user.id).run()
    return json({ ok: true })
  }
  if (path === '/api/auth/account/' && request.method === 'DELETE') {
    const profile = await ensureProfile(env, user.id)
    if (profile.resume_key && env.MEDIA) await env.MEDIA.delete(profile.resume_key)
    await env.DB.batch([env.DB.prepare('DELETE FROM applications WHERE user_id = ?').bind(user.id), env.DB.prepare('DELETE FROM profiles WHERE user_id = ?').bind(user.id), env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id), env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id)])
    return withCookie(json({ ok: true }), clearSessionCookie())
  }
  if (path === '/api/profile/' && request.method === 'PATCH') return profilePatch(request, env, user)
  if (path === '/api/profile/saved/' && request.method === 'POST') return savedJobs(request, env, user)
  if (path === '/api/profile/resume/' && ['POST', 'PATCH', 'DELETE'].includes(request.method)) return resume(request, env, user)
  if (path === '/api/applications/' && request.method === 'POST') return applications(request, env, user)
  const applicationMatch = path.match(/^\/api\/applications\/(\d+)\/$/)
  if (applicationMatch && request.method === 'PATCH') return applications(request, env, user, Number(applicationMatch[1]))
  return json({ message: 'Маршрут не найден' }, 404)
}

async function fetchHandler(request, env) {
  await initSchema(env)
  const url = new URL(request.url)
  if (url.pathname.startsWith('/api/')) {
    try { return await routeApi(request, env) } catch (error) { console.error(error); return json({ message: 'Внутренняя ошибка сервера' }, 500) }
  }
  let response = await env.ASSETS.fetch(request)
  if (response.status === 404 && request.method === 'GET' && request.headers.get('accept')?.includes('text/html')) response = await env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request))
  const headers = new Headers(response.headers)
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

export default { fetch: fetchHandler }
