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

async function fetchResumeFile(resume) {
  if (!resume?.id || resume.source === "hh") return null;
  const response = await fetch(`${API_ORIGIN}/api/profile/resume/file/?id=${encodeURIComponent(resume.id)}`, { credentials: "include" });
  if (!response.ok) return null;
  return response.arrayBuffer();
}

async function fillCurrentPage() {
  const resume = selectedResume();
  if (!resume || !activeTab?.id) return;
  fillButton.disabled = true;
  setResult("получаем файл резюме...");
  try {
    const fileBytes = await fetchResumeFile(resume);
    const response = await api.tabs.sendMessage(activeTab.id, {
      type: "fill-resume",
      resume,
      coverLetter: account.coverLetter || "",
      fileBytes,
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
    const isAston = /^https:\/\/career\.astondevs\.ru\/vacancy\//i.test(activeTab?.url || "");
    if (!isAston) {
      pageStatus.textContent = "Открой вакансию на career.astondevs.ru";
      throw new Error("Расширение сейчас работает с формами ASTON.");
    }
    pageStatus.textContent = "страница ASTON найдена";
    account = await fetchAccount();
    renderResumes();
  } catch (error) {
    pageStatus.textContent = error instanceof Error ? error.message : "Не удалось загрузить профиль";
    pageStatus.className = "muted error";
    fillButton.disabled = true;
  }
}

void init();
