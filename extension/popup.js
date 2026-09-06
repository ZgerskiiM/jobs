const api = globalThis.browser || globalThis.chrome;

const pageStatus = document.getElementById("page-status");
const authPanel = document.getElementById("auth-panel");
const resumePanel = document.getElementById("resume-panel");
const loginButton = document.getElementById("login-button");
const checkAuthButton = document.getElementById("check-auth-button");
const resumeSelect = document.getElementById("resume-select");
const resumeMeta = document.getElementById("resume-meta");
const fillButton = document.getElementById("fill-button");
const result = document.getElementById("result");
const profileLink = document.getElementById("profile-link");

let activeTab = null;
let account = null;
async function loadApiOrigin() {
  profileLink.href = "http://139.100.233.153:8080/profile";
}

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
    const label = resume.position || resume.fileName || "Резюме";
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
  if (resume.experienceYears != null) {
    const years = Math.max(0, Math.floor(Number(resume.experienceYears)));
    const months = resume.experienceMonths ?? Math.round((Number(resume.experienceYears) - years) * 12);
    resumeMeta.textContent = months > 0 ? `${years} лет ${months} мес.` : `${years} лет`;
  } else {
    resumeMeta.textContent = resume.experience || "опыт не указан";
  }
}

async function fetchAccount() {
  const response = await api.runtime.sendMessage({ type: "get-account" });
  if (!response?.ok) throw new Error(response?.error || "Войди в jobs.dev в этом браузере");
  return response.account;
}

function showAuthState(error = "") {
  account = null;
  authPanel.hidden = false;
  resumePanel.hidden = true;
  resumeSelect.replaceChildren(new Option("войдите в jobs.dev", ""));
  resumeSelect.disabled = true;
  resumeMeta.textContent = "";
  fillButton.disabled = true;
  pageStatus.textContent = error || "Войди в jobs.dev, чтобы использовать резюме";
  pageStatus.className = "muted";
}

function showAccountState(nextAccount) {
  account = nextAccount;
  authPanel.hidden = true;
  resumePanel.hidden = false;
  pageStatus.textContent = "вкладка готова — найду поля формы автоматически";
  pageStatus.className = "muted";
  renderResumes();
}

async function checkAuthorization() {
  checkAuthButton.disabled = true;
  checkAuthButton.textContent = "проверяем вход...";
  try {
    showAccountState(await fetchAccount());
  } catch (error) {
    showAuthState(error instanceof Error ? error.message : "Войди в jobs.dev в этом браузере");
  } finally {
    checkAuthButton.disabled = false;
    checkAuthButton.textContent = "я уже вошёл — проверить";
  }
}

async function fillCurrentPage() {
  const resume = selectedResume();
  if (!resume || !activeTab?.id) return;
  fillButton.disabled = true;
  setResult("получаем файл резюме...");
  try {
    const preparedFile = await api.runtime.sendMessage({ type: "prepare-file", resumeId: resume.id, source: resume.source, hasFile: resume.hasFile, fileName: resume.fileName });
    if (api.scripting?.executeScript) {
      await api.scripting.executeScript({ target: { tabId: activeTab.id }, files: ["content-script.js"] });
    } else {
      await api.tabs.executeScript(activeTab.id, { file: "content-script.js" });
    }
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
loginButton.addEventListener("click", () => void api.tabs.create({ url: "http://139.100.233.153:8080/?extension_login=1" }));
checkAuthButton.addEventListener("click", () => void checkAuthorization());

async function init() {
  try {
    await loadApiOrigin();
    [activeTab] = await api.tabs.query({ active: true, currentWindow: true });
    const isWebPage = /^https?:\/\//i.test(activeTab?.url || "");
    if (!isWebPage) {
      pageStatus.textContent = "Открой обычную веб-страницу с формой отклика";
      pageStatus.className = "muted error";
      fillButton.disabled = true;
      authPanel.hidden = true;
      resumePanel.hidden = false;
      return;
    }
    showAccountState(await fetchAccount());
  } catch (error) {
    showAuthState(error instanceof Error ? error.message : "Не удалось загрузить профиль");
  }
}

void init();
