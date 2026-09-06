import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { COMPANY_PROFILES, type Company, type CompactVacancyFeatures, type Job } from "../data";

type SourceVacancy = {
  id: string | number;
  company: string;
  title: string;
  location?: string;
  workplace_type?: string;
  description?: string;
  url: string;
  posted_at?: string;
  first_seen_at?: string;
  source_key?: string;
  technologies?: string[];
  scoring_features?: Partial<Record<"JAVA_BACKEND" | "DEVOPS" | "ONE_C_DEVELOPER", CompactVacancyFeatures>>;
};

type RegistryCompany = {
  rank: number;
  name: string;
  career_url: string | null;
};

type VacancyData = {
  jobs: Job[];
  companies: Company[];
  loading: boolean;
  error: string | null;
  hhError: string | null;
  updatedAt: string | null;
};

const VacancyDataContext = createContext<VacancyData | null>(null);

const COLORS = ["#33ff77", "#00d4ff", "#a78bfa", "#fbbf24", "#ff3e78", "#34d399"];

function hash(value: string) {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) result = (result * 31 + value.charCodeAt(index)) | 0;
  return Math.abs(result);
}

function slug(value: string) {
  return `${value.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, "-").replace(/^-|-$/g, "")}-${hash(value).toString(36)}`;
}

function categoryFor(job: SourceVacancy) {
  const title = job.title.toLowerCase();
  // Категория определяется только названием: описание может содержать случайные технологии.
  if (/стажер|стажёр|стажировк|практикант|практика|\bintern(?:ship)?\b|\btrainee\b/.test(title)) return "Стажировка";
  if (/\b(?:a?qa)\b|тестир|тестиров|testing|tester|quality\s+assurance|quality\s+engineer/.test(title)) return "QA";
  // \b защищает от ложного совпадения с Linux: в слове «linux» нет отдельного UX.
  if (/\b(?:ux|ui)\b|дизайн|дизайнер|design/.test(title)) return "Дизайн";
  if (/менеджер|manager|management|руководител|начальник|директор|координатор|супервайзер/.test(title)) return "Менеджмент";
  if (/embedded|встраиваем|firmware|прошивк|микроконтрол|rtos|arm(?:64|\s+cortex)|stm32|esp32|\biot\b|internet\s+of\s+things|протокол\w*\s+.*сет|linux.*(?:c\+\+|с\+\+|c\/c\+\+|с\/с\+\+)|(?:c\+\+|с\+\+|c\/c\+\+|с\/с\+\+).*linux/.test(title)) return "Embedded";
  if (/поддержк|support|саппорт|help\s*desk|service\s*desk|l[123]\b|(?:первая|первой|1-й|1)\s+линии|техподдерж|сервисн(?:ый|ая)|it[- ]?support/.test(title)) return "Поддержка";
  if (/(?:\b1c\b|1с|1-с)/.test(title)) return "1С";
  if (/аналитик|аналитич|\banalyst\b|analytics/.test(title)) return "Аналитика";
  if (/\bjava\b/.test(title)) return "Backend";
  if (/devops|sre|инфраструктур|kubernetes|terraform|cloud|администратор|системн|сетев|linux\s*(?:engineer|инженер)|(?:engineer|инженер)\s+linux/.test(title)) return "DevOps";
  if (/security|безопасност|кибер|pentest/.test(title)) return "Security";
  if (/ai|ml|машинн|нейросет|llm/.test(title)) return "AI/ML";
  if (/data|аналитик|bi\b|etl|dwh|spark|clickhouse/.test(title)) return "Data";
  if (/ios|android|mobile|мобильн/.test(title)) return "Mobile";
  if (/frontend|front-end|react|vue|angular|веб-разработ/.test(title)) return "Frontend";
  if (/backend|back-end|разработ|developer|программист|software\s+engineer/.test(title)) return "Backend";
  return "Другое";
}

function relativeDate(value?: string) {
  if (!value) return "недавно";
  const date = new Date(value);
  const hours = Math.max(0, Math.floor((Date.now() - date.getTime()) / 3_600_000));
  if (hours < 1) return "только что";
  if (hours < 24) return `${hours}ч назад`;
  return `${Math.floor(hours / 24)}д назад`;
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "IT";
}

const OFFICIAL_LOGO_DOMAINS: Record<string, string> = {
  "S7 Airlines": "s7.ru",
  "YADRO": "yadro.com",
  "Ozon Tech": "ozon.tech",
  "Ozon": "ozon.ru",
  "HeadHunter": "hh.ru",
  "Райффайзен Банк": "raiffeisen.ru",
  "Циан": "cian.ru",
  "BI.ZONE": "bi.zone",
  "Okko": "okko.tv",
  "Северсталь": "severstal.com",
  "Росатом": "rosatom.ru",
  "Мир Plat.Form": "mirplatform.ru",
  "ecom.tech (ex. Samokat)": "ecom.tech",
  "АльфаСтрахование": "alfastrah.ru",
  "Т1 Иннотех": "t1.ru",
  "ФосАгро": "phosagro.ru",
  "Neoflex": "neoflex.ru",
  "Транснефть": "transneft.ru",
  "t2": "t2.ru",
  "ВТБ": "vtb.ru",
  "МегаФон": "megafon.ru",
  "Росбанк": "rosbank.ru",
  "ДОМ.РФ": "domrf.ru",
  "Банк России": "cbr.ru",
  "Совкомбанк Технологии": "sovcombank.ru",
  "Диасофт": "diasoft.ru",
  "билайн": "beeline.ru",
  "СберЗдоровье": "sberhealth.ru",
  "МойОфис": "myoffice.ru",
  "Московский кредитный банк": "mkb.ru",
  "Ашан Тех": "auchan.ru",
  "QIWI": "qiwi.com",
  "Skillbox": "skillbox.ru",
  "ИНГОССТРАХ": "ingos.ru",
  "Ростелеком": "rostelecom.ru",
  "Ростелеком Информационные Технологии": "rostelecom.ru",
  "CDEK": "cdek.ru",
  "Rutube": "rutube.ru",
  "МегаМаркет": "megamarket.ru",
  "РОСГОССТРАХ": "rgs.ru",
  "Почта России": "pochta.ru",
  "Почта Банк": "pochtabank.ru",
  "Столото": "stoloto.ru",
  "Лента": "lenta.com",
  "Магнит": "magnit.ru",
  "Аскона": "askona.ru",
  "Московская биржа (MOEX)": "moex.com",
  "ЮMoney": "yoomoney.ru",
  "Orion soft": "orionsoft.ru",
  "Рексофт (Reksoft)": "reksoft.com",
  "Финам / FINAM IT": "finam.ru",
  "Криптонит": "kryptonite.ru",
  "Учи.ру": "uchi.ru",
  "Innostage": "innostage-group.ru",
  "KODE": "kode.ru",
  "Picodata": "picodata.io",
  "Mindbox": "mindbox.ru",
  "ГАРАНТ": "garant.ru",
  "МойСклад / Lognex": "moysklad.ru",
  "NtechLab": "ntechlab.com",
  "Цифра / Zyfra": "zyfra.com",
  "BellSoft": "bell-sw.com",
  "Сравни": "sravni.ru",
  "Банки.ру": "banki.ru",
  "R-Style Softlab": "softlab.ru",
  "Туту": "tutu.ru",
  "UserGate": "usergate.com",
  "DNS Технологии": "dns-tech.ru",
  "Информзащита": "infosec.ru",
  "InfoWatch": "infowatch.ru",
  "Код Безопасности": "securitycode.ru",
  "Dr.Web": "drweb.ru",
  "Directum": "directum.ru",
  "ELMA 365": "elma365.com",
  "SportMaster Lab": "sportmaster.ru",
  "Aquarius": "aq.ru",
  "IVA Technologies": "iva.ru",
  "Auriga": "auriga.ru",
  "Р-Софт": "r-soft.org",
  "Digital Clouds": "dclouds.ru",
  "ITFB Group": "itfbgroup.ru",
  "Яндекс": "yandex.ru",
  "Точка Банк": "tochka.com",
  "Лемана Тех": "lemanatech.ru",
  "Dodo Engineering": "dodoengineering.ru",
  "НЛМК Информационные технологии": "nlmk.com",
  "ЦФТ": "cft.ru",
  "Газпром нефть": "gazprom-neft.ru",
  "РСХБ.цифра": "rshb.ru",
  "ПСБ": "psbank.ru",
};

function remoteLogoUrl(value: string, company: string) {
  try {
    const hostname = OFFICIAL_LOGO_DOMAINS[company] || new URL(value).hostname;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=128`;
  } catch {
    return undefined;
  }
}

function inferredCompanyProfile(name: string) {
  const value = name.toLowerCase();
  const rules: Array<{ test: RegExp; industry: string; domains: string[]; label: string }> = [
    { test: /банк|bank|финанс|бирж|страх|qiwi|yoomoney|юmoney|банки/, industry: "Fintech", domains: ["Fintech", "Банкинг", "Платежи"], label: "финансовые и цифровые сервисы" },
    { test: /безопас|security|kaspersky|dr\.web|usergate|infotecs|infowatch|bi\.zone|solar|информзащит|код безопасност/, industry: "Security", domains: ["Кибербезопасность", "Защита данных", "Enterprise IT"], label: "кибербезопасность и защита данных" },
    { test: /облак|cloud|selectel|хост|data.?center|цод|rtlabs/, industry: "Cloud", domains: ["Cloud", "Data platform", "Инфраструктура"], label: "облачная инфраструктура и данные" },
    { test: /маркет|ритейл|магаз|ламод|ozon|wildber|мегамаркет|магнит|лента|ашан|детский мир|вкусвилл|купер|самолет|leman|sportmaster|x5|cdek|dodo|достав|ecom/, industry: "Retail tech", domains: ["E-commerce", "Retail tech", "Логистика"], label: "цифровые продукты для торговли и логистики" },
    { test: /авиа|авиас|s7|туту|travel|туризм/, industry: "Travel tech", domains: ["Travel tech", "Мобильные сервисы", "Логистика"], label: "технологии для путешествий и транспорта" },
    { test: /нефть|газпром|росатом|северстал|сибур|нлмк|фосагро|транснеф|россети|норник|полюс|тмк|металл|энерг/, industry: "Industry", domains: ["Industrial tech", "Data & AI", "Автоматизация"], label: "промышленная цифровизация и автоматизация" },
    { test: /карты|2гис|циан|домклик|недвиж|яндекс|авито|head.?hunter|hh|rabota|уч\.ру|skyeng|skillbox/, industry: "Digital platforms", domains: ["Digital platform", "Marketplace", "Data & AI"], label: "цифровые платформы и сервисы для пользователей" },
    { test: /телеком|мегафон|мтс|ростелеком|билайн|t2|транстелеком|nexign|rutube|vk|okko/, industry: "Telecom & media", domains: ["Telecom", "Media", "Digital products"], label: "телеком, медиа и цифровые продукты" },
    { test: /интегратор|консалт|soft|it_|it one|крок|ланит|ибс|корус|ай-теко|рексофт|axenix|neoflex|haиlmont|simbir|glowbyte|bell integrator|jet|т1|t1/, industry: "IT services", domains: ["IT consulting", "Enterprise software", "Data & AI"], label: "корпоративные IT-решения и консалтинг" },
  ];
  const match = rules.find((rule) => rule.test.test(value));
  return match || { industry: "Technology", domains: ["IT и цифровые продукты"], label: "технологические продукты и сервисы" };
}

function toJobs(vacancies: SourceVacancy[]): Job[] {
  return vacancies.map((vacancy, index) => {
    const companyId = slug(vacancy.company);
    const category = categoryFor(vacancy);
    const technologies = (vacancy.technologies || []).filter(Boolean).slice(0, 8);
    // На карточке показываем только область вакансии; технологии используются отдельно для фильтрации навыков.
    const isOneCAnalyst = category === "1С" && /аналитик|аналитич|\banalyst\b|analytics/.test(vacancy.title.toLowerCase());
    const tags = isOneCAnalyst ? ["1С", "Аналитика"] : [category];
    const key = `${vacancy.source_key || vacancy.company}:${vacancy.id}`;
    return {
      id: hash(key),
      title: vacancy.title,
      company: vacancy.company,
      url: vacancy.url,
      companyId,
      logo: initials(vacancy.company),
      logoUrl: remoteLogoUrl(vacancy.url, vacancy.company),
      logoColor: COLORS[hash(vacancy.company) % COLORS.length],
      location: vacancy.location || "Не указано",
      salary: "По договорённости",
      tags,
      type: vacancy.workplace_type || "Полная занятость",
      posted: relativeDate(vacancy.posted_at || vacancy.first_seen_at),
      featured: index < 8,
      category,
      level: "Специалист",
      description: vacancy.description || "Описание вакансии доступно на сайте работодателя.",
      parsedSkills: technologies,
      scoringFeatures: vacancy.scoring_features,
    };
  });
}

function toCompanies(jobs: Job[], source: SourceVacancy[], registry: RegistryCompany[]): Company[] {
  const sourceByCompany = new Map(source.map((item) => [slug(item.company), item]));
  const grouped = new Map<string, Job[]>();
  jobs.forEach((job) => grouped.set(job.companyId, [...(grouped.get(job.companyId) || []), job]));

  const registered: Company[] = registry.map((item) => {
    const id = slug(item.name);
    const companyJobs = grouped.get(id) || [];
    const sourceJob = sourceByCompany.get(id);
    let site = item.career_url || sourceJob?.url || "#";
    const name = item.name;
    const profile = COMPANY_PROFILES[name] || inferredCompanyProfile(name);
    const color = COLORS[hash(name) % COLORS.length];
    try { site = new URL(site).origin; } catch { /* keep the career URL when it is not a valid URL */ }
    return {
      id,
      name,
      jobs: companyJobs.length,
      domain: site.replace(/^https?:\/\//, ""),
      site,
      logo: initials(name),
      logoUrl: site === "#" ? undefined : remoteLogoUrl(site, name),
      color,
      industry: profile?.industry || "Работодатель",
      size: "",
      about: "about" in profile ? profile.about : `${name} развивает ${profile.label}.`,
      businessDomains: profile.businessDomains,
      tech_stack: [...new Set(companyJobs.flatMap((job) => job.tags))].slice(0, 12),
      culture: [],
      perks: [],
      rating: { overall: 0, wlb: 0, growth: 0, management: 0 },
      reviews: [],
      hiringInsights: [],
      vacancyStatus: companyJobs.length > 0 ? "imported" : "external",
    };
  });

  const registeredIds = new Set(registered.map((company) => company.id));
  const unregistered: Company[] = [...grouped.entries()]
    .filter(([id]) => !registeredIds.has(id))
    .map(([id, companyJobs]) => {
      const first = companyJobs[0];
      const sourceJob = sourceByCompany.get(id);
      const profile = COMPANY_PROFILES[first.company] || inferredCompanyProfile(first.company);
      let site = sourceJob?.url || "#";
      try { site = new URL(site).origin; } catch { /* source URL is already the best available value */ }
      return {
        id,
        name: first.company,
        jobs: companyJobs.length,
        domain: site.replace(/^https?:\/\//, ""),
        site,
        logo: first.logo,
        logoUrl: first.logoUrl,
        color: first.logoColor,
        industry: profile?.industry || "Работодатель",
        size: "",
        about: "about" in profile ? profile.about : `${first.company} развивает ${profile.label}.`,
        businessDomains: profile.businessDomains,
        tech_stack: [...new Set(companyJobs.flatMap((job) => job.tags))].slice(0, 12),
        culture: [], perks: [], rating: { overall: 0, wlb: 0, growth: 0, management: 0 }, reviews: [], hiringInsights: [],
        vacancyStatus: "imported" as const,
      };
    });

  return [...registered, ...unregistered].sort((a, b) => b.jobs - a.jobs || a.name.localeCompare(b.name, "ru"));
}

export function VacancyDataProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<VacancyData>({ jobs: [], companies: [], loading: true, error: null, hhError: null, updatedAt: null });

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch(`${import.meta.env.BASE_URL}vacancies.json`, { signal: controller.signal }).then((response) => response.ok ? response.json() : Promise.reject(new Error("Не удалось загрузить каталог вакансий"))),
      fetch(`/api/vacancies/hh/?text=разработчик&area=1&per_page=100`, { signal: controller.signal }).then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        return response.ok ? payload : { vacancies: [], error: payload.message || `HH.ru вернул ошибку ${response.status}` };
      }).catch(() => ({ vacancies: [], error: "Не удалось связаться с HH.ru" })),
    ])
      .then(([catalog, hh]: [{ vacancies?: SourceVacancy[]; companies?: RegistryCompany[]; meta?: { updated_at?: string } }, { vacancies?: SourceVacancy[]; error?: string; meta?: { updated_at?: string } }]) => {
        const vacancies = [...(catalog.vacancies || []), ...(hh.vacancies || [])];
        const jobs = toJobs(vacancies);
        setState({ jobs, companies: toCompanies(jobs, vacancies, catalog.companies || []), loading: false, error: null, hhError: hh.error || null, updatedAt: hh.meta?.updated_at || catalog.meta?.updated_at || null });
      })
      .catch((error: Error) => {
        if (error.name !== "AbortError") setState({ jobs: [], companies: [], loading: false, error: error.message, hhError: null, updatedAt: null });
      });
    return () => controller.abort();
  }, []);

  const value = useMemo(() => state, [state]);
  return <VacancyDataContext.Provider value={value}>{children}</VacancyDataContext.Provider>;
}

export function useVacancyData() {
  const context = useContext(VacancyDataContext);
  if (!context) throw new Error("useVacancyData must be used inside VacancyDataProvider");
  return context;
}
