const API_ORIGIN = "https://jobs-dev.zgerskiim.chatgpt.site";
const CHUNK_SIZE = 256 * 1024;
const pendingFiles = new Map();

function expireFile(requestId) {
  globalThis.setTimeout(() => pendingFiles.delete(requestId), 10 * 60 * 1000);
}

browser.runtime.onMessage.addListener(async (message) => {
  if (message?.type === "get-account") {
    try {
      const response = await fetch(`${API_ORIGIN}/api/auth/me/`, { credentials: "include" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) return { ok: false, error: body.message || "Войди в jobs.dev в этом браузере" };
      return { ok: true, account: body };
    } catch {
      return { ok: false, error: "Не удалось загрузить профиль jobs.dev" };
    }
  }

  if (message?.type === "prepare-file") {
    if (!message.resumeId || message.source === "hh" || message.hasFile === false) return { ok: false, error: "У этого резюме нет сохранённого файла — загрузи его заново в профиле" };
    try {
      const response = await fetch(`${API_ORIGIN}/api/profile/resume/file/?id=${encodeURIComponent(message.resumeId)}`, { credentials: "include" });
      if (!response.ok) return { ok: false, error: `Не удалось получить файл с jobs.dev (HTTP ${response.status})` };
      const requestId = crypto.randomUUID();
      const bytes = new Uint8Array(await response.arrayBuffer());
      pendingFiles.set(requestId, { bytes, fileName: message.fileName || "resume.pdf", type: response.headers.get("content-type") || "application/pdf" });
      expireFile(requestId);
      return { ok: true, requestId, size: bytes.byteLength };
    } catch {
      return { ok: false, error: "Не удалось получить файл с jobs.dev" };
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
