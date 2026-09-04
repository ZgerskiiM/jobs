const api = globalThis.browser;
const API_ORIGIN = "https://jobs-dev.zgerskiim.chatgpt.site";

const pageStatus = document.getElementById("page-status");
const resumeSelect = document.getElementById("resume-select");
const resumeMeta = document.getElementById("resume-meta");
const fillButton = document.getElementById("fill-button");
const result = document.getElementById("result");

let activeTab = null;
let account = null;

function setResult(message, kind = "") {
  result.textContent = message;
  result.className = `result ${kind}`.trim();
}

function selectedResume() {
  const id = resumeSelect.value;
  return account?.resumes?.find((item) => item.id === id) || account?.resume || null;
}

function renderResumes() {
  const resumes = account?.resumes?.length ? account.resumes : account?.resume ? [account.resume] : [];
  resumeSelect.replaceChildren();
  if (!resumes.length) {
    resumeSelect.add(new Option("сначала загрузите резюме", ""));
    resumeSelect.disabled = true;
    fillButton.disabled = true;
    resumeMeta.textContent = "В профиле jobs.dev пока нет резюме.";
    return;
  }
  for (const resume of resumes) {
    const label = resume.fullName || resume.position || resume.fileName || "Резюме";
    resumeSelect.add(new Option(label, resume.id));
  }
  const active = account.resume?.id || resumes.find((item) => item.isActive)?.id || resumes[0].id;
  resumeSelect.value = active;
  resumeSelect.disabled = false;
  fillButton.disabled = false;
  updateMeta();
}

function updateMeta() {
  const resume = selectedResume();
  if (!resume) return;
  const contacts = [resume.contactEmail, resume.contactPhone].filter(Boolean).join(" · ");
  resumeMeta.textContent = [resume.position, resume.experience, contacts].filter(Boolean).join(" · ") || "данные готовы к подстановке";
}

async function fetchAccount() {
  const response = await fetch(`${API_ORIGIN}/api/auth/me/`, { credentials: "include" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || "Войди в jobs.dev в этом браузере");
  return body;
}

async function fillCurrentPage() {
  const resume = selectedResume();
  if (!resume || !activeTab?.id) return;
  fillButton.disabled = true;
  setResult("получаем файл резюме...");
  try {
    const preparedFile = await api.runtime.sendMessage({ type: "prepare-file", resumeId: resume.id, source: resume.source, fileName: resume.fileName });
    await api.tabs.executeScript(activeTab.id, { file: "content-script.js" });
    const response = await api.tabs.sendMessage(activeTab.id, {
      type: "fill-resume",
      resume,
      coverLetter: account.coverLetter || "",
      fileRequestId: preparedFile?.ok ? preparedFile.requestId : null,
      fileError: preparedFile?.error || "",
    });
    setResult(response?.message || "форма заполнена — проверь данные перед отправкой", "success");
  } catch (error) {
    setResult(error instanceof Error ? error.message : "Не удалось заполнить форму", "error");
  } finally {
    fillButton.disabled = false;
  }
}

resumeSelect.addEventListener("change", updateMeta);
fillButton.addEventListener("click", () => void fillCurrentPage());

async function init() {
  try {
    [activeTab] = await api.tabs.query({ active: true, currentWindow: true });
    const isWebPage = /^https?:\/\//i.test(activeTab?.url || "");
    if (!isWebPage) {
      pageStatus.textContent = "Открой обычную веб-страницу с формой отклика";
      throw new Error("На этой вкладке нельзя заполнить форму.");
    }
    pageStatus.textContent = "вкладка готова — найду поля формы автоматически";
    account = await fetchAccount();
    renderResumes();
  } catch (error) {
    pageStatus.textContent = error instanceof Error ? error.message : "Не удалось загрузить профиль";
    pageStatus.className = "muted error";
    fillButton.disabled = true;
  }
}

void init();
