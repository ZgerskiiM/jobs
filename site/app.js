const companies = [
  [1,"Ростелеком (цифровые сервисы)",null,"research"],
  [2,"ИТ-холдинг Т1","https://career.t1.ru/vacancies/","site_only"],
  [3,"ИКС Холдинг",null,"research"],
  [4,"OCS Distribution",null,"research"],
  [5,"Softline","https://softline.ru/about/vacancies","ready"],
  [6,"3Logic Group",null,"research"],
  [7,"Лаборатория Касперского","https://careers.kaspersky.ru/vacancies","ready"],
  [8,"Cloud.ru","https://cloud.ru/career/vacancies","ready"],
  [9,"МТС Web Services","https://mws.ru/vacancies/","site_only"],
  [10,"Группа Rubytech","https://rubytech.ru/career/","candidate"],
  [11,"Монт","https://www.mont.ru/career/","candidate"],
  [12,"Yandex B2B Tech","https://yandex.ru/jobs/vacancies","candidate"],
  [13,"Контур","https://kontur.ru/career/vacancies","ready"],
  [14,"Айтеко","https://www.i-teco.ru/career/","candidate"],
  [15,"Газинформсервис","https://career.gaz-is.ru/","candidate"],
  [16,"Инфосистемы Джет","https://jet.su/career/vacancies/","ready"],
  [17,"Элемент","https://elementgroup.ru/career/","candidate"],
  [18,"Гринатом","https://career.greenatom.ru/","site_only"],
  [19,"Лига Цифровой Экономики","https://career.digitalleague.ru/","candidate"],
  [20,"Positive Technologies","https://ptsecurity.com/ru-ru/about/vacancy/","ready"],
  [21,"Инвента",null,"research"],
  [22,"ICL-КПО ВС","https://icl.ru/career/jobs/","ready"],
  [23,"Сбертех","https://sbertech.ru/career/","candidate"],
  [24,"Бифорком Тек","https://beforecom.ru/career/","candidate"],
  [25,"Атомдата","https://atomdata.ru/career/","candidate"],
  [26,"BI.ZONE","https://bi.zone/about/career/","site_only"],
  [27,"Хайтэк-Интеграция","https://htiholding.ru/career/","candidate"],
  [28,"Тензор","https://tensor.ru/about/career","candidate"],
  [29,"Сател","https://satel.org/career/","candidate"],
  [30,"IBS","https://ibs.ru/career/jobs/","ready"],
  [31,"Axenix","https://axenix.tech/","site_only"],
  [32,"ГК Астра","https://astra.ru/about/career/vacancies/","ready"],
  [33,"X-Com","https://www.xcom.ru/career/","candidate"],
  [34,"К2Тех","https://career.k2.tech/","candidate"],
  [35,"VK Tech","https://team.vk.company/vacancy/","ready"],
  [36,"Selectel","https://selectel.ru/careers/all/","ready"],
  [37,"Сиссофт","https://career.syssoft.ru/","candidate"],
  [38,"Эвотор","https://career.evotor.ru/","candidate"],
  [39,"Первый Бит","https://career.1cbit.ru/","candidate"],
  [40,"Вымпелком-Информационные технологии","https://job.beeline.ru/","candidate"],
  [41,"Fortis",null,"research"],
  [42,"Edna","https://edna.ru/career/","candidate"],
  [43,"Сигма",null,"research"],
  [44,"1С-Рарус","https://rarus.ru/career/vacancies/","candidate"],
  [45,"РТ-Инвест Транспортные Системы","https://rtits.ru/career/","candidate"],
  [46,"Базовые решения",null,"research"],
  [47,"Ситроникс","https://sitronics.com/career/","candidate"],
  [48,"Depo Computers","https://depo.ru/company/vacancies/","candidate"],
  [49,"ОТР","https://career.otr.ru/","candidate"],
  [50,"IT_ONE","https://www.it-one.ru/vacancies/","ready"],
  [null,"Ozon","https://ozon.tech/vacancies/","site_only"],
  [null,"Райффайзен Банк","https://career.raiffeisen.ru/","site_only"],
  [null,"Авиасейлс","https://www.aviasales.ru/about/vacancies","ready"],
  [null,"Авито","https://career.avito.com/vacancies/","ready"],
  [null,"2ГИС","https://job.2gis.ru/","ready"],
  [null,"Dodo Engineering","https://dodoteam.ru/","ready"],
  [null,"Точка Банк","https://hr.tochka.com/vacancies/","ready"],
  [null,"Alfa Digital","https://digital.alfabank.ru/vacancies","ready"],
  [null,"Т-Банк","https://www.tbank.ru/career/vacancies/it/","ready"],
  [null,"Lamoda","https://job.lamoda.ru/","ready"],
  [null,"HeadHunter","https://hh.ru/employer/1455","site_only"],
  [null,"Бюро 1440","https://1440.space/","site_only"],
  [null,"Альфа-Банк","https://job.alfabank.ru/vacancies","ready"],
  [null,"ВкусВилл","https://vkusvill.ru/job/office/","ready"],
  [null,"Циан","https://www.cian.ru/vacancies/","site_only"],
  [null,"X5 Tech","https://x5.tech/vacancy","ready"],
  [null,"YADRO","https://careers.yadro.com/vacancies","site_only"],
  [null,"S7 Airlines","https://www.s7.ru/vacancies/","site_only"],
  [null,"Okko","https://about.okko.tv/hr","site_only"],
  [null,"Nexign","https://job.nexign.com/jobs","ready"],
  [null,"Северсталь","https://career.severstal.com/","site_only"],
  [null,"Яндекс","https://yandex.ru/jobs/vacancies","ready"],
  [null,"Росатом","https://rosatom-career.ru/","site_only"],
  [null,"Мир Plat.Form","https://mir-platform.ru/","site_only"],
  [null,"СИБУР","https://career.sibur.ru/vacancies/","ready"],
  [null,"ЦФТ","https://job.cft.ru/","ready"],
  [null,"SberDevices","https://sberdevices.ru/career/","ready"],
  [null,"ecom.tech","https://ecom.tech/","site_only"],
  [null,"SM Lab","https://smlab.digital/","site_only"],
  [null,"ИнфоТеКС","https://career.infotecs.ru/","ready"],
  [null,"Норникель Спутник","https://career.nornickel.ru/vacancies/it/?OrganizationUnits=sputnik","ready"],
  [null,"Лемана Тех","https://rabota.lemanapro.ru/vacancies","ready"],
  [null,"Сбер","https://developers.sber.ru/kak-v-sbere/vacancies","ready"],
  [null,"АльфаСтрахование","https://www.alfastrah.ru/company/vacancies/","site_only"],
  [null,"Газпром нефть","https://career.gazprom-neft.ru/vacancies/","ready"],
  [null,"КРОК","https://careers.croc.ru/vacancies/","ready"],
  [null,"Т1 Иннотех","https://career.t1.ru/teams/innotech","site_only"],
  [null,"Газпром Автоматизация","https://gazprom-auto.ru/career/vacancies","ready"],
  [null,"МТС Финтех","https://job.mtsbank.ru/vacancies","ready"],
  [null,"Домклик","https://career.domclick.ru/vacancies","ready"],
  [null,"ФосАгро","https://www.phosagro.ru/career-education/career/","site_only"],
  [null,"НЛМК Информационные технологии","https://career.nlmk.com/vacancy/it-digital/","ready"],
  [null,"Neoflex","https://www.neoflex.ru/about/career","site_only"],
  [null,"Skyeng","https://vacancies.skyeng.ru/","ready"],
  [null,"ICL-КПО ВС","https://icl.ru/career/jobs/","ready"],
  [null,"Солар","https://team.rt-solar.ru/vacancies/","ready"],
  [null,"Haulmont","https://job.haulmont.ru/career","ready"],
  [null,"SimbirSoft","https://www.simbirsoft.com/vacancies/","ready"],
  [null,"Газпром Информ","https://inform.gazprom.ru/career/","site_only"]
].map(([rank, name, url, status]) => ({ rank, name, url, status }));

const labels = {
  ready: "Подключено",
  candidate: "Сайт найден",
  site_only: "Только карьерный сайт",
  research: "Исследуем"
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[character]);
}

function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : "#";
  } catch {
    return "#";
  }
}

const grid = document.getElementById("company-grid");
const search = document.getElementById("company-search");
const buttons = [...document.querySelectorAll(".filter")];
const resultsCount = document.getElementById("results-count");
const showMore = document.getElementById("show-more");
const emptyState = document.getElementById("empty-state");
const restoreCompanies = document.getElementById("restore-companies");
const hiddenCount = document.getElementById("count-hidden");
let activeFilter = "all";
let visibleLimit = 12;
const HIDDEN_COMPANIES_KEY = "techrabota.hiddenCompanies.v1";
let hiddenCompanies;
try {
  hiddenCompanies = new Set(JSON.parse(localStorage.getItem(HIDDEN_COMPANIES_KEY) || "[]"));
} catch {
  hiddenCompanies = new Set();
}

function saveHiddenCompanies() {
  localStorage.setItem(HIDDEN_COMPANIES_KEY, JSON.stringify([...hiddenCompanies]));
}

function initials(name) {
  const cleaned = name.replace(/\([^)]*\)/g, "").trim();
  const words = cleaned.split(/[\s-]+/).filter(Boolean);
  return words.length === 1 ? words[0].slice(0, 2).toUpperCase() : (words[0][0] + words[1][0]).toUpperCase();
}

function noun(count) {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return "компаний";
  if (mod10 === 1) return "компания";
  if (mod10 >= 2 && mod10 <= 4) return "компании";
  return "компаний";
}

function filteredCompanies() {
  const query = search.value.trim().toLocaleLowerCase("ru");
  return companies.filter(company => {
    const isHidden = hiddenCompanies.has(company.name);
    const matchesStatus = activeFilter === "hidden"
      ? isHidden
      : !isHidden && (activeFilter === "all" || company.status === activeFilter);
    const matchesQuery = !query || company.name.toLocaleLowerCase("ru").includes(query);
    return matchesStatus && matchesQuery;
  });
}

function render() {
  const filtered = filteredCompanies();
  const visible = filtered.slice(0, visibleLimit);
  grid.innerHTML = visible.map(company => `
    <article class="company-card${hiddenCompanies.has(company.name) ? " is-hidden-company" : ""}">
      <div class="card-top">
        <span class="rank">${company.rank ? `№ ${String(company.rank).padStart(2, "0")}` : "В пуле"}</span>
        <div class="card-actions">
          <span class="status status-${company.status}">${labels[company.status]}</span>
          <button class="company-visibility" type="button" data-company="${escapeHtml(company.name)}" aria-label="${hiddenCompanies.has(company.name) ? "Вернуть" : "Скрыть"} ${escapeHtml(company.name)}">${hiddenCompanies.has(company.name) ? "Вернуть" : "Скрыть"}</button>
        </div>
      </div>
      <div class="company-monogram" aria-hidden="true">${initials(company.name)}</div>
      <h3>${company.name}</h3>
      <div class="card-footer">
        <span>${company.rank ? "CNews500 · 2025" : "Дополнительная компания"}</span>
        ${company.url
          ? `<a class="card-link" href="${escapeHtml(safeExternalUrl(company.url))}" target="_blank" rel="noopener">Карьерный сайт ↗</a>`
          : `<span class="card-link-disabled">Источник уточняется</span>`}
      </div>
    </article>
  `).join("");

  resultsCount.textContent = `${filtered.length} ${noun(filtered.length)}`;
  emptyState.hidden = filtered.length !== 0;
  showMore.hidden = filtered.length <= visibleLimit;
  hiddenCount.textContent = hiddenCompanies.size;
  restoreCompanies.hidden = hiddenCompanies.size === 0;
  const visibleCompanies = companies.filter(company => !hiddenCompanies.has(company.name));
  const visibleCounts = visibleCompanies.reduce((acc, company) => {
    acc[company.status] = (acc[company.status] || 0) + 1;
    return acc;
  }, {});
  document.getElementById("count-all").textContent = visibleCompanies.length;
  document.getElementById("count-ready").textContent = visibleCounts.ready || 0;
  document.getElementById("count-candidate").textContent = visibleCounts.candidate || 0;
  document.getElementById("count-site-only").textContent = visibleCounts.site_only || 0;
  document.getElementById("count-research").textContent = visibleCounts.research || 0;
}

grid.addEventListener("click", event => {
  const button = event.target.closest(".company-visibility");
  if (!button) return;
  const name = button.dataset.company;
  if (hiddenCompanies.has(name)) hiddenCompanies.delete(name);
  else hiddenCompanies.add(name);
  saveHiddenCompanies();
  visibleLimit = 12;
  render();
});

restoreCompanies.addEventListener("click", () => {
  hiddenCompanies.clear();
  saveHiddenCompanies();
  if (activeFilter === "hidden") {
    activeFilter = "all";
    buttons.forEach(button => button.classList.toggle("is-active", button.dataset.filter === "all"));
  }
  render();
});

search.addEventListener("input", () => {
  visibleLimit = 12;
  render();
});

buttons.forEach(button => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    visibleLimit = 12;
    buttons.forEach(item => item.classList.toggle("is-active", item === button));
    render();
  });
});

showMore.addEventListener("click", () => {
  visibleLimit += 12;
  render();
});

const counts = companies.reduce((acc, company) => {
  acc[company.status] = (acc[company.status] || 0) + 1;
  return acc;
}, {});
document.getElementById("count-all").textContent = companies.length;
document.getElementById("count-ready").textContent = counts.ready || 0;
document.getElementById("count-candidate").textContent = counts.candidate || 0;
document.getElementById("count-site-only").textContent = counts.site_only || 0;
document.getElementById("count-research").textContent = counts.research || 0;
render();

const vacancies = Array.isArray(window.VACANCIES) ? window.VACANCIES : [];
const jobList = document.getElementById("job-list");
const jobSearch = document.getElementById("job-search");
const jobCompanyFilter = document.getElementById("job-company-filter");
const jobTechnologyFilter = document.getElementById("job-technology-filter");
const jobResultsCount = document.getElementById("job-results-count");
const jobShowMore = document.getElementById("job-show-more");
const jobEmptyState = document.getElementById("job-empty-state");
const jobDialog = document.getElementById("job-dialog");
const jobExclusions = document.getElementById("job-exclusions");
const jobHiddenCompanyCount = document.getElementById("job-hidden-company-count");
const jobHiddenCompanySelect = document.getElementById("job-hidden-company-select");
const jobRestoreCompany = document.getElementById("job-restore-company");
const jobRestoreAllCompanies = document.getElementById("job-restore-all-companies");
let jobVisibleLimit = 10;
const HIDDEN_JOB_COMPANIES_KEY = "techrabota.hiddenVacancyCompanies.v1";
let hiddenJobCompanies;
try {
  const storedCompanies = JSON.parse(localStorage.getItem(HIDDEN_JOB_COMPANIES_KEY) || "[]");
  hiddenJobCompanies = new Set(Array.isArray(storedCompanies) ? storedCompanies : []);
} catch {
  hiddenJobCompanies = new Set();
}

function saveHiddenJobCompanies() {
  try {
    localStorage.setItem(HIDDEN_JOB_COMPANIES_KEY, JSON.stringify([...hiddenJobCompanies]));
  } catch {
    // Фильтр продолжит работать до перезагрузки, даже если хранилище браузера отключено.
  }
}

function vacancyNoun(count) {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return "вакансий";
  if (mod10 === 1) return "вакансия";
  if (mod10 >= 2 && mod10 <= 4) return "вакансии";
  return "вакансий";
}

function cleanPreview(description) {
  const text = String(description || "Описание появится после следующего обновления.")
    .replace(/\s+/g, " ").trim();
  return text.length > 230 ? `${text.slice(0, 227)}…` : text;
}

function metaValues(job) {
  return [...new Set([job.location, job.team, job.workplace_type].filter(Boolean))];
}

function filteredVacancies() {
  const query = jobSearch.value.trim().toLocaleLowerCase("ru");
  const selectedCompany = jobCompanyFilter.value;
  const selectedTechnology = jobTechnologyFilter.value;
  return vacancies.filter(job => {
    const haystack = [job.title, job.company, job.location, job.team, job.description, ...(job.technologies || [])]
      .filter(Boolean).join(" ").toLocaleLowerCase("ru");
    return !hiddenJobCompanies.has(job.company)
      && (!selectedCompany || job.company === selectedCompany)
      && (!selectedTechnology || (job.technologies || []).includes(selectedTechnology))
      && (!query || haystack.includes(query));
  });
}

function renderVacancies() {
  const filtered = filteredVacancies();
  const visible = filtered.slice(0, jobVisibleLimit);
  jobList.innerHTML = visible.map(job => {
    const index = vacancies.indexOf(job);
    const metaTags = metaValues(job).map(value => `<span>${escapeHtml(value)}</span>`).join("");
    const techTags = (job.technologies || []).map(value => `<span class="tech-tag">${escapeHtml(value)}</span>`).join("");
    const tags = metaTags + techTags;
    return `
      <article class="job-card">
        <div class="job-company-row">
          <p class="job-company">${escapeHtml(job.company)}</p>
          <button class="job-hide-company" type="button" data-job-company="${escapeHtml(job.company)}">Не показывать компанию</button>
        </div>
        <h3>${escapeHtml(job.title)}</h3>
        ${tags ? `<div class="job-meta">${tags}</div>` : ""}
        <p class="job-preview">${escapeHtml(cleanPreview(job.description))}</p>
        <button class="job-open" type="button" data-job-index="${index}">Читать описание</button>
      </article>`;
  }).join("");
  jobResultsCount.textContent = `${filtered.length} ${vacancyNoun(filtered.length)}`;
  jobEmptyState.hidden = filtered.length !== 0;
  jobShowMore.hidden = filtered.length <= jobVisibleLimit;
}

function renderJobExclusions() {
  const names = [...hiddenJobCompanies].sort((a, b) => a.localeCompare(b, "ru"));
  jobExclusions.hidden = names.length === 0;
  jobHiddenCompanyCount.textContent = names.length;
  jobHiddenCompanySelect.replaceChildren(...names.map(name => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    return option;
  }));
}

function renderJobCompanyOptions() {
  const selected = jobCompanyFilter.value;
  const names = [...new Set(vacancies.map(job => job.company).filter(Boolean))]
    .filter(company => !hiddenJobCompanies.has(company))
    .sort((a, b) => a.localeCompare(b, "ru"));
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "Все компании";
  jobCompanyFilter.replaceChildren(all, ...names.map(company => {
    const option = document.createElement("option");
    option.value = company;
    option.textContent = company;
    return option;
  }));
  jobCompanyFilter.value = names.includes(selected) ? selected : "";
}

function openVacancy(job) {
  document.getElementById("dialog-company").textContent = job.company || "";
  document.getElementById("dialog-job-title").textContent = job.title || "Вакансия";
  document.getElementById("dialog-description").textContent = job.description || "Описание пока не получено.";
  const dialogTags = metaValues(job).map(value => {
    const tag = document.createElement("span");
    tag.textContent = value;
    return tag;
  });
  (job.technologies || []).forEach(value => {
    const tag = document.createElement("span");
    tag.className = "tech-tag";
    tag.textContent = value;
    dialogTags.push(tag);
  });
  document.getElementById("dialog-meta").replaceChildren(...dialogTags);
  const apply = document.getElementById("dialog-apply");
  apply.href = safeExternalUrl(job.url);
  apply.hidden = apply.href.endsWith("#");
  jobDialog.showModal();
}

renderJobCompanyOptions();
renderJobExclusions();

const technologyCounts = vacancies.reduce((counts, job) => {
  (job.technologies || []).forEach(technology => {
    counts.set(technology, (counts.get(technology) || 0) + 1);
  });
  return counts;
}, new Map());
[...technologyCounts.entries()]
  .sort(([firstName, firstCount], [secondName, secondCount]) => {
    if (firstName === "Java") return -1;
    if (secondName === "Java") return 1;
    return secondCount - firstCount || firstName.localeCompare(secondName, "ru");
  })
  .forEach(([technology, count]) => {
    const option = document.createElement("option");
    option.value = technology;
    option.textContent = `${technology} · ${count}`;
    jobTechnologyFilter.append(option);
  });

jobSearch.addEventListener("input", () => { jobVisibleLimit = 10; renderVacancies(); });
jobCompanyFilter.addEventListener("change", () => { jobVisibleLimit = 10; renderVacancies(); });
jobTechnologyFilter.addEventListener("change", () => { jobVisibleLimit = 10; renderVacancies(); });
jobShowMore.addEventListener("click", () => { jobVisibleLimit += 10; renderVacancies(); });
jobList.addEventListener("click", event => {
  const hideButton = event.target.closest("[data-job-company]");
  if (hideButton) {
    hiddenJobCompanies.add(hideButton.dataset.jobCompany);
    saveHiddenJobCompanies();
    jobVisibleLimit = 10;
    renderJobCompanyOptions();
    renderJobExclusions();
    renderVacancies();
    return;
  }
  const button = event.target.closest("[data-job-index]");
  if (button) openVacancy(vacancies[Number(button.dataset.jobIndex)]);
});
jobRestoreCompany.addEventListener("click", () => {
  if (!jobHiddenCompanySelect.value) return;
  hiddenJobCompanies.delete(jobHiddenCompanySelect.value);
  saveHiddenJobCompanies();
  renderJobCompanyOptions();
  renderJobExclusions();
  renderVacancies();
});
jobRestoreAllCompanies.addEventListener("click", () => {
  hiddenJobCompanies.clear();
  saveHiddenJobCompanies();
  renderJobCompanyOptions();
  renderJobExclusions();
  renderVacancies();
});
document.getElementById("dialog-close").addEventListener("click", () => jobDialog.close());
jobDialog.addEventListener("click", event => {
  if (event.target === jobDialog) jobDialog.close();
});
document.getElementById("hero-job-count").textContent = vacancies.length;
document.getElementById("hero-source-count").textContent = new Set(
  vacancies.map(job => job.company).filter(Boolean)
).size;
document.getElementById("hero-company-count").textContent = companies.length;
renderVacancies();

const updateButton = document.getElementById("update-vacancies");
const updateLabel = document.getElementById("update-label");
const updateStatus = document.getElementById("update-status");
const vacanciesMeta = window.VACANCIES_META || {};
const isLocalUpdateServer = /^https?:$/.test(window.location.protocol)
  && ["127.0.0.1", "localhost"].includes(window.location.hostname);
let updatePollTimer = null;

function lastUpdateText() {
  if (!vacanciesMeta.updated_at) return "Время последнего обновления пока неизвестно";
  const updatedAt = new Date(vacanciesMeta.updated_at);
  if (Number.isNaN(updatedAt.getTime())) return "Время последнего обновления пока неизвестно";
  return `Последнее обновление: ${new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "long", timeStyle: "short", timeZone: "Europe/Moscow"
  }).format(updatedAt)} (МСК)`;
}

updateStatus.textContent = lastUpdateText();
if (!isLocalUpdateServer) {
  updateButton.disabled = true;
  updateButton.title = "Онлайн-версия обновляется автоматически каждую ночь";
  updateLabel.textContent = "Обновляется ночью";
}

function updateStateView(state) {
  const running = Boolean(state.running);
  updateButton.disabled = running;
  updateButton.classList.toggle("is-running", running);
  updateButton.classList.toggle("is-success", state.success === true && !running);
  updateButton.classList.toggle("is-error", state.success === false && !running);
  updateLabel.textContent = running ? "Обновляем…" : "Обновить вакансии";
  updateStatus.textContent = state.message || "Готово к обновлению";

  if (!running && updatePollTimer) {
    clearInterval(updatePollTimer);
    updatePollTimer = null;
    if (state.success) {
      window.setTimeout(() => window.location.reload(), 900);
    }
  }
}

async function loadUpdateState() {
  try {
    const response = await fetch("/api/update/status", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const state = await response.json();
    updateStateView(state);
    return state;
  } catch {
    updateButton.disabled = false;
    updateButton.classList.remove("is-running");
    updateLabel.textContent = "Обновить вакансии";
    updateStatus.textContent = "Сервер обновления недоступен. Запустите start-site.ps1.";
    return null;
  }
}

function startUpdatePolling() {
  if (updatePollTimer) return;
  updatePollTimer = window.setInterval(loadUpdateState, 1800);
}

updateButton.addEventListener("click", async () => {
  if (!/^https?:$/.test(window.location.protocol)) {
    updateStatus.textContent = "Чтобы кнопка работала, откройте лендинг через start-site.ps1.";
    return;
  }
  updateButton.disabled = true;
  updateButton.classList.add("is-running");
  updateLabel.textContent = "Запускаем…";
  updateStatus.textContent = "Подготавливаем обход карьерных сайтов…";
  try {
    const response = await fetch("/api/update", {
      method: "POST",
      headers: { "X-Requested-With": "vacancy-update" },
    });
    const state = await response.json();
    if (!response.ok) throw new Error(state.message || `HTTP ${response.status}`);
    updateStateView(state);
    startUpdatePolling();
  } catch (error) {
    updateStateView({ running: false, success: false, message: `Ошибка запуска: ${error.message}` });
  }
});

if (isLocalUpdateServer) {
  loadUpdateState().then(state => {
    if (state?.running) startUpdatePolling();
  });
}

