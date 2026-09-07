const extensionApi = globalThis.browser || globalThis.chrome;
const API_ORIGIN = "https://devver.ru";
const CHUNK_SIZE = 256 * 1024;
const pendingFiles = new Map();
const API_TIMEOUT_MS = 8000;

async function fetchWithTimeout(url, options = {}, timeoutMs = API_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    globalThis.clearTimeout(timer);
  }
}

function expireFile(requestId) {
  globalThis.setTimeout(() => pendingFiles.delete(requestId), 10 * 60 * 1000);
}

extensionApi.runtime.onMessage.addListener(async (message) => {
  if (message?.type === "get-account") {
    try {
      const response = await fetchWithTimeout(`${API_ORIGIN}/api/auth/me/`, { credentials: "include" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) return { ok: false, error: body.message || "Войди в devver в этом браузере" };
      return { ok: true, account: body };
    } catch (error) {
      if (error?.name === "AbortError") return { ok: false, error: "devver не ответил вовремя — нажми «проверить авторизацию» ещё раз" };
      return { ok: false, error: "Не удалось загрузить профиль devver" };
    }
  }

  if (message?.type === "track-application") {
    try {
      const response = await fetchWithTimeout(`${API_ORIGIN}/api/applications/from-extension/`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageUrl: String(message.pageUrl || "").slice(0, 2000),
          title: String(message.title || "").slice(0, 300),
          company: String(message.company || "").slice(0, 200),
          submittedAt: message.submittedAt || new Date().toISOString(),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) return { ok: false, error: body.message || ("Не удалось сохранить отклик (HTTP " + response.status + ")") };
      return { ok: true, ...body };
    } catch (error) {
      if (error?.name === "AbortError") return { ok: false, error: "devver не ответил вовремя — отклик можно добавить вручную" };
      return { ok: false, error: "Не удалось связаться с devver — отклик можно добавить вручную" };
    }
  }

  if (message?.type === "prepare-file") {
    if (!message.resumeId || message.source === "hh" || message.hasFile === false) return { ok: false, error: "У этого резюме нет сохранённого файла — загрузи его заново в профиле" };
    try {
      const response = await fetchWithTimeout(`${API_ORIGIN}/api/profile/resume/file/?id=${encodeURIComponent(message.resumeId)}`, { credentials: "include" }, 15000);
      if (!response.ok) return { ok: false, error: `Не удалось получить файл с devver (HTTP ${response.status})` };
      const requestId = crypto.randomUUID();
      const bytes = new Uint8Array(await response.arrayBuffer());
      pendingFiles.set(requestId, { bytes, fileName: message.fileName || "resume.pdf", type: response.headers.get("content-type") || "application/pdf" });
      expireFile(requestId);
      return { ok: true, requestId, size: bytes.byteLength };
    } catch (error) {
      if (error?.name === "AbortError") return { ok: false, error: "devver не ответил вовремя — повтори заполнение" };
      return { ok: false, error: "Не удалось получить файл с devver" };
    }
  }

  if (message?.type === "file-meta") {
    const file = pendingFiles.get(message.requestId);
    if (!file) return { ok: false, error: "Файл уже недоступен, повтори заполнение" };
    return { ok: true, size: file.bytes.byteLength, chunkSize: CHUNK_SIZE, fileName: file.fileName, type: file.type };
  }

  if (message?.type === "file-chunk") {
    const file = pendingFiles.get(message.requestId);
    if (!file) return { ok: false, error: "Файл уже недоступен" };
    const start = Number(message.index) * CHUNK_SIZE;
    const chunk = file.bytes.slice(start, start + CHUNK_SIZE);
    return { ok: true, index: Number(message.index), bytes: chunk.buffer };
  }

  if (message?.type === "release-file") {
    pendingFiles.delete(message.requestId);
    return { ok: true };
  }

  return undefined;
});
