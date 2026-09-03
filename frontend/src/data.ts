export interface Job {
  id: number;
  title: string;
  company: string;
  companyId: string;
  logo: string;
  logoUrl?: string;
  logoColor: string;
  location: string;
  salary: string;
  tags: string[];
  type: string;
  posted: string;
  featured: boolean;
  category: string;
  level: string;
  matchedSkills?: string[];
  description: string;
  parsedSkills: string[];
}

export interface Company {
  id: string;
  name: string;
  jobs: number;
  domain: string;
  site: string;
  logo: string;
  logoUrl?: string;
  color: string;
  industry: string;
  size: string;
  about: string;
  founded?: string;
  hq?: string;
  tech_stack: string[];
  culture: string[];
  perks: string[];
  rating: { overall: number; wlb: number; growth: number; management: number };
  reviews: CompanyReview[];
  hiringInsights: HiringInsight[];
  vacancyStatus?: "imported" | "external";
}

export interface CompanyReview {
  id: number;
  author: string;
  role: string;
  date: string;
  rating: number;
  pros: string;
  cons: string;
  verdict: "рекомендую" | "нейтрально" | "не рекомендую";
}

export interface HiringInsight {
  id: number;
  role: string;
  date: string;
  outcome: "оффер" | "отказ" | "ghosted";
  difficulty: 1 | 2 | 3 | 4 | 5;
  duration: string;
  stages: string[];
  comment: string;
}

export type AppStatus = "sent" | "viewed" | "interview" | "offer" | "rejected";

export interface TimelineEvent {
  date: string;
  label: string;
  note?: string;
}

export interface Application {
  id: number;
  title: string;
  company: string;
  logo: string;
  color: string;
  salary: string;
  level: string;
  location: string;
  url: string;
  appliedAt: string;
  status: AppStatus;
  updatedDaysAgo: number; // days since last status change
  deadline: string;
  note: string;
  contact: string;
  tags: string[];
  timeline: TimelineEvent[];
  notificationsOn: boolean;
}

// Seed applications for the tracker (демо-данные)
export const INITIAL_APPLICATIONS: Application[] = [
  {
    id: 1, title: "Senior Rust Engineer", company: "Yandex Cloud", logo: "YC", color: "#ff3e78",
    salary: "350–500 000 ₽", level: "Senior", location: "Москва / Remote", url: "https://yandex.ru/jobs",
    appliedAt: "29 авг", status: "interview", updatedDaysAgo: 1, deadline: "10 сент",
    note: "Техническое интервью в четверг в 15:00. Подготовить примеры ownership и lifetimes.",
    contact: "Анна Петрова, @anna_tg", tags: ["Rust", "C++", "Systems"], notificationsOn: true,
    timeline: [
      { date: "29 авг", label: "Отклик отправлен" },
      { date: "30 авг", label: "Резюме просмотрено" },
      { date: "1 сент", label: "Приглашение на интервью", note: "Техническое, 60 мин" },
    ],
  },
  {
    id: 2, title: "ML Infrastructure Engineer", company: "Sber AI", logo: "SA", color: "#33ff77",
    salary: "400–600 000 ₽", level: "Middle / Senior", location: "Remote", url: "https://sber.ru/career",
    appliedAt: "27 авг", status: "viewed", updatedDaysAgo: 9, deadline: "",
    note: "", contact: "", tags: ["Python", "CUDA", "Kubernetes"], notificationsOn: true,
    timeline: [
      { date: "27 авг", label: "Отклик отправлен" },
      { date: "30 авг", label: "Резюме просмотрено" },
    ],
  },
  {
    id: 3, title: "AI Research Engineer", company: "Yandex Research", logo: "YR", color: "#33ff77",
    salary: "500–900 000 ₽", level: "Senior / Staff", location: "Москва", url: "https://yandex.ru/jobs",
    appliedAt: "25 авг", status: "offer", updatedDaysAgo: 0, deadline: "5 сент",
    note: "Оффер на 650к + RSU. Дедлайн принятия — 5 сентября.",
    contact: "Дмитрий, +7 999 000-11-22", tags: ["PyTorch", "LLM", "RLHF"], notificationsOn: true,
    timeline: [
      { date: "25 авг", label: "Отклик отправлен" },
      { date: "26 авг", label: "Резюме просмотрено" },
      { date: "28 авг", label: "Первое интервью", note: "HR-скрининг, 30 мин" },
      { date: "30 авг", label: "Техническое интервью", note: "Алгоритмы + системный дизайн" },
      { date: "1 сент", label: "Оффер получен 🎉", note: "650 000 ₽ + RSU" },
    ],
  },
  {
    id: 4, title: "Platform Engineer (Staff)", company: "Avito", logo: "AV", color: "#00d4ff",
    salary: "450–700 000 ₽", level: "Staff", location: "Москва", url: "https://avito.ru/company/jobs",
    appliedAt: "22 авг", status: "rejected", updatedDaysAgo: 4, deadline: "",
    note: "Отказали после технического интервью. Сказали «не хватает опыта с Go».",
    contact: "", tags: ["Go", "K8s", "Terraform"], notificationsOn: false,
    timeline: [
      { date: "22 авг", label: "Отклик отправлен" },
      { date: "24 авг", label: "Резюме просмотрено" },
      { date: "26 авг", label: "Техническое интервью" },
      { date: "28 авг", label: "Отказ", note: "Причина: недостаточно опыта с Go" },
    ],
  },
  {
    id: 5, title: "Backend Engineer (Golang)", company: "Тинькофф", logo: "TK", color: "#fbbf24",
    salary: "300–450 000 ₽", level: "Middle", location: "Москва", url: "https://career.tinkoff.ru",
    appliedAt: "20 авг", status: "sent", updatedDaysAgo: 12, deadline: "",
    note: "", contact: "", tags: ["Go", "PostgreSQL", "gRPC"], notificationsOn: true,
    timeline: [
      { date: "20 авг", label: "Отклик отправлен" },
    ],
  },
  {
    id: 6, title: "Security Engineer", company: "Positive Technologies", logo: "PT", color: "#a78bfa",
    salary: "300–500 000 ₽", level: "Middle / Senior", location: "Hybrid", url: "https://ptsecurity.com/ru-ru/about/jobs",
    appliedAt: "18 авг", status: "rejected", updatedDaysAgo: 7, deadline: "",
    note: "", contact: "", tags: ["Python", "RE", "AppSec"], notificationsOn: false,
    timeline: [
      { date: "18 авг", label: "Отклик отправлен" },
      { date: "20 авг", label: "Резюме просмотрено" },
      { date: "25 авг", label: "Отказ без объяснений" },
    ],
  },
];

// Seed saved jobs — ids reference JOBS above
export const INITIAL_SAVED_JOB_IDS: number[] = [4, 6, 7];

export const JOBS: Job[] = [
  {
    id: 1,
    title: "Senior Rust Engineer",
    company: "Yandex Cloud",
    companyId: "yandex",
    logo: "YC",
    logoColor: "#ff3e78",
    location: "Москва / Remote",
    salary: "350 000 — 500 000 ₽",
    tags: ["Rust", "C++", "Systems"],
    type: "Fulltime",
    posted: "2ч назад",
    featured: true,
    category: "Backend",
    level: "Senior",
    matchedSkills: ["Rust", "C++"],
    description: `Ищем Senior Rust Engineer в команду Yandex Cloud Infrastructure. Ты будешь работать над низкоуровневыми системами хранения данных и сетевым стеком, обеспечивая надёжность и производительность облачной платформы для миллионов пользователей.

Чем предстоит заниматься: разработка и оптимизация компонентов облачной инфраструктуры на Rust, проектирование высоконагруженных распределённых систем, code review и менторинг junior и middle инженеров, участие в архитектурных решениях и техническом планировании.

Что мы ждём: 5+ лет коммерческой разработки, из них 2+ на Rust или C++. Глубокое понимание системного программирования: memory model, concurrency, async/await. Опыт работы с Linux internals и сетевым стеком. Понимание принципов распределённых систем: consensus, replication, fault tolerance.

Будет плюсом: опыт с eBPF или io_uring, контрибуции в open source Rust-проекты, опыт с DPDK или RDMA.

Команда из 12 человек: 8 инженеров, 2 SRE, 1 PM, 1 tech lead. Работаем по гибкому графику, встречаемся в офисе раз в неделю.`,
    parsedSkills: ["Rust", "C++", "Linux", "async/await", "eBPF", "io_uring", "DPDK", "distributed systems"],
  },
  {
    id: 2,
    title: "ML Infrastructure Engineer",
    company: "Sber AI",
    companyId: "sber",
    logo: "SA",
    logoColor: "#33ff77",
    location: "Remote",
    salary: "400 000 — 600 000 ₽",
    tags: ["Python", "CUDA", "Kubernetes"],
    type: "Fulltime",
    posted: "5ч назад",
    featured: true,
    category: "AI/ML",
    level: "Senior",
    matchedSkills: ["Python", "Kubernetes"],
    description: `Sber AI развивает GigaChat и ряд внутренних LLM-продуктов. Тебе предстоит строить инфраструктуру для обучения и деплоя моделей — от оркестрации GPU-кластеров до inference pipeline на тысячах запросов в секунду.

Чем предстоит заниматься: разработка и поддержка ML training pipeline для LLM-моделей, оптимизация GPU-кластеров и распределённого обучения (FSDP, DeepSpeed), построение inference-инфраструктуры с фокусом на latency и throughput, разработка инструментов мониторинга и observability для ML-систем.

Что мы ждём: 3+ лет опыта в ML Engineering или MLOps, уверенное знание Python и PyTorch, опыт с Kubernetes и контейнеризацией, базовое понимание CUDA и принципов GPU-программирования, опыт с distributed training (NCCL, model parallelism).

Будет плюсом: опыт с vLLM, TGI или аналогичными inference серверами, знание Triton или CUDA kernels, опыт с Ray или Spark.

Команда ML Platform: 20 человек, полностью remote, async-first культура.`,
    parsedSkills: ["Python", "PyTorch", "CUDA", "Kubernetes", "FSDP", "DeepSpeed", "vLLM", "Ray", "Spark", "NCCL"],
  },
  {
    id: 3,
    title: "Platform Engineer (Staff)",
    company: "Avito",
    companyId: "avito",
    logo: "AV",
    logoColor: "#00d4ff",
    location: "Москва",
    salary: "450 000 — 700 000 ₽",
    tags: ["Go", "K8s", "Terraform"],
    type: "Fulltime",
    posted: "1д назад",
    featured: false,
    category: "DevOps",
    level: "Staff",
    matchedSkills: ["Go", "Kubernetes"],
    description: `Staff Platform Engineer в команду Developer Experience. Ты будешь определять техническую стратегию внутренней платформы Avito, которой пользуются 400+ инженеров ежедневно. Роль с высоким уровнем автономии и влиянием на всю инженерную организацию.

Чем предстоит заниматься: техническое лидерство платформенных инициатив, проектирование и внедрение Internal Developer Platform (IDP) на базе Kubernetes, разработка Terraform-модулей и инфраструктурных абстракций для product-команд, определение SLO для платформы, менторинг senior инженеров.

Что мы ждём: 8+ лет в SRE/Platform/DevOps, из них 3+ в роли senior или выше. Глубокие знания Kubernetes: операторы, CRD, scheduling, networking. Уверенное владение Go для написания контроллеров и tooling. Практический опыт с Terraform на масштабе 100+ сервисов.

Будет плюсом: опыт с Backstage, знание eBPF для network observability.`,
    parsedSkills: ["Go", "Kubernetes", "Terraform", "eBPF", "Backstage", "SLO", "CRD", "Helm", "CI/CD"],
  },
  {
    id: 4,
    title: "Senior Frontend Engineer",
    company: "Ozon Tech",
    companyId: "ozon",
    logo: "OZ",
    logoColor: "#a78bfa",
    location: "Remote",
    salary: "280 000 — 420 000 ₽",
    tags: ["TypeScript", "React", "WebGL"],
    type: "Fulltime",
    posted: "1д назад",
    featured: false,
    category: "Frontend",
    level: "Senior",
    matchedSkills: ["TypeScript", "React"],
    description: `Команда Core Frontend в Ozon разрабатывает продуктовые страницы, через которые проходят десятки миллионов пользователей в день. Ищем инженера, который будет строить производительные UI-компоненты с упором на Core Web Vitals и WebGL-визуализации.

Чем предстоит заниматься: разработка высоконагруженного frontend для маркетплейса, оптимизация производительности (LCP, FID, CLS, code splitting, lazy loading), создание WebGL-компонентов для интерактивных витрин, участие в архитектуре Ozon Design System.

Что мы ждём: 5+ лет коммерческой frontend-разработки, экспертное знание TypeScript и React, опыт оптимизации Web Vitals, базовые знания WebGL / Three.js, понимание микрофронтенд-архитектур.

Будет плюсом: опыт с WebAssembly, знание React Server Components, опыт с Canvas и shader-программированием.`,
    parsedSkills: ["TypeScript", "React", "WebGL", "Three.js", "WebAssembly", "CSS", "Webpack", "Vite", "Core Web Vitals"],
  },
  {
    id: 5,
    title: "Security Researcher",
    company: "Positive Technologies",
    companyId: "positive",
    logo: "PT",
    logoColor: "#ff3e78",
    location: "Москва / Hybrid",
    salary: "300 000 — 500 000 ₽",
    tags: ["Reverse Engineering", "C", "Python"],
    type: "Fulltime",
    posted: "2д назад",
    featured: false,
    category: "Security",
    level: "Middle",
    matchedSkills: ["Python", "C"],
    description: `Команда PT Expert Security Center ищет Security Researcher для исследования уязвимостей в промышленных системах и APT-атрибуции. Ты будешь анализировать реальное вредоносное ПО, участвовать в threat intelligence и публиковать результаты.

Чем предстоит заниматься: реверс-инжиниринг вредоносного ПО и исследование эксплоитов, анализ APT-кампаний и построение IOC-профилей, исследование уязвимостей в промышленных протоколах (Modbus, DNP3, IEC 61850), написание технических отчётов.

Что мы ждём: 3+ лет опыта в security research или malware analysis, уверенный реверс в IDA Pro / Ghidra, знание C на уровне low-level кода, Python для автоматизации, понимание сетевых протоколов и Windows/Linux.

Будет плюсом: опыт с ICS/OT-системами, CVE в публичных базах, опыт в CTF (pwn/RE).`,
    parsedSkills: ["C", "Python", "IDA Pro", "Ghidra", "Reverse Engineering", "Assembly", "Windows", "Linux", "Malware Analysis"],
  },
  {
    id: 6,
    title: "Data Engineer (Senior)",
    company: "VK Tech",
    companyId: "vk",
    logo: "VK",
    logoColor: "#00d4ff",
    location: "Москва / Remote",
    salary: "320 000 — 480 000 ₽",
    tags: ["Spark", "ClickHouse", "Airflow"],
    type: "Fulltime",
    posted: "3д назад",
    featured: false,
    category: "Data",
    level: "Senior",
    matchedSkills: ["Spark", "ClickHouse"],
    description: `VK Tech Data Platform обрабатывает петабайты данных с соцсетей, мессенджеров и игровых платформ. Ищем Senior Data Engineer для развития аналитического слоя и помощи product-командам в получении инсайтов.

Чем предстоит заниматься: разработка и поддержка ETL/ELT-пайплайнов на Apache Spark, проектирование DWH-слоёв в ClickHouse для аналитических нагрузок, разработка DAG-оркестрации в Airflow, работа с product-командами над дата-моделями.

Что мы ждём: 4+ лет в Data Engineering, экспертное знание Apache Spark (PySpark или Scala), опыт с ClickHouse (шардирование, репликация, оптимизация запросов), Airflow на уровне создания и сопровождения DAG-ов, понимание Data Vault или Kimball-методологии.

Будет плюсом: опыт с Apache Iceberg или Delta Lake, знание dbt, опыт с Kafka Streams или Flink.`,
    parsedSkills: ["Spark", "PySpark", "ClickHouse", "Airflow", "SQL", "Kafka", "dbt", "Delta Lake", "Python", "Scala"],
  },
  {
    id: 7,
    title: "iOS Engineer (Lead)",
    company: "Тинькофф",
    companyId: "tinkoff",
    logo: "TK",
    logoColor: "#fbbf24",
    location: "Remote",
    salary: "380 000 — 560 000 ₽",
    tags: ["Swift", "SwiftUI", "Combine"],
    type: "Fulltime",
    posted: "3д назад",
    featured: false,
    category: "Mobile",
    level: "Lead",
    matchedSkills: ["Swift", "SwiftUI"],
    description: `Тинькофф — одно из крупнейших мобильных приложений России с 30+ млн активных пользователей. Ищем iOS Lead для команды платёжного флоу — критически важного и технически интересного продукта.

Чем предстоит заниматься: техническое лидерство команды из 5 iOS-инженеров, проектирование архитектуры модулей платёжного флоу, code review, планирование технического долга, менторинг, участие в roadmap-планировании с PM и дизайном.

Что мы ждём: 5+ лет iOS-разработки, из них 1+ в роли lead или senior+. Экспертное знание Swift, SwiftUI, Combine. Глубокое понимание UIKit и жизненного цикла iOS. Опыт проектирования модульных iOS-архитектур. Понимание требований безопасности для финтех-приложений.

Будет плюсом: опыт с Metal или Core Animation, знание StoreKit, опыт с Instruments для профилирования.`,
    parsedSkills: ["Swift", "SwiftUI", "Combine", "UIKit", "Core Animation", "Metal", "StoreKit", "XCTest", "Xcode"],
  },
  {
    id: 8,
    title: "AI Research Engineer",
    company: "Yandex Research",
    companyId: "yandex",
    logo: "YR",
    logoColor: "#33ff77",
    location: "Москва",
    salary: "500 000 — 900 000 ₽",
    tags: ["PyTorch", "LLM", "RLHF"],
    type: "Fulltime",
    posted: "4д назад",
    featured: false,
    category: "AI/ML",
    level: "Senior",
    matchedSkills: ["PyTorch", "LLM"],
    description: `Yandex Research — академическая исследовательская лаборатория внутри Яндекса. Мы публикуемся в NeurIPS, ICLR, ICML. Ищем AI Research Engineer для работы над LLM-моделями следующего поколения и методами RLHF/RLAIF.

Чем предстоит заниматься: исследование и реализация методов RLHF/DPO/RLAIF для alignment LLM, разработка efficient fine-tuning подходов (LoRA, QLoRA, prefix-tuning), написание и публикация research papers, имплементация экспериментальных архитектур трансформеров.

Что мы ждём: сильный ML-бэкграунд (нейросети, оптимизация, теормат), экспертное владение PyTorch, опыт с distributed training (FSDP, Megatron-LM, DeepSpeed), публикации или значимые контрибуции в ML open source, степень магистра или PhD.

Будет плюсом: первый автор на NeurIPS/ICLR/ICML, опыт с Triton kernels, знание speculative decoding или MoE.`,
    parsedSkills: ["PyTorch", "LLM", "RLHF", "LoRA", "FSDP", "DeepSpeed", "Megatron-LM", "Python", "CUDA", "Triton"],
  },
  {
    id: 9,
    title: "Site Reliability Engineer",
    company: "Авито",
    companyId: "avito",
    logo: "AV",
    logoColor: "#00d4ff",
    location: "Remote",
    salary: "380 000 — 580 000 ₽",
    tags: ["Go", "Prometheus", "Linux"],
    type: "Fulltime",
    posted: "5д назад",
    featured: false,
    category: "DevOps",
    level: "Senior",
    matchedSkills: ["Go", "Prometheus"],
    description: `Команда SRE в Авито отвечает за надёжность платформы с 60+ млн пользователей. Ищем инженера с сильным программистским бэкграундом, который умеет строить надёжные системы и не боится разбираться в чужом коде.

Чем предстоит заниматься: обеспечение надёжности и доступности ключевых сервисов Авито (SLO/SLA), разработка инструментов мониторинга и алертинга на Go, capacity planning и performance optimization, участие в on-call ротации и разборах инцидентов.

Что мы ждём: 4+ лет в SRE/DevOps с акцентом на программирование, уверенное знание Go, опыт с Prometheus, Grafana, ClickHouse для observability, глубокое знание Linux (networking, filesystem, process management), опыт с Kubernetes в production.

Будет плюсом: опыт с chaos engineering, знание eBPF, опыт с Jaeger или Tempo.`,
    parsedSkills: ["Go", "Prometheus", "Grafana", "Linux", "Kubernetes", "ClickHouse", "eBPF", "Jaeger", "SLO/SLA"],
  },
  {
    id: 10,
    title: "Backend Engineer (Golang)",
    company: "Тинькофф",
    companyId: "tinkoff",
    logo: "TK",
    logoColor: "#fbbf24",
    location: "Москва",
    salary: "300 000 — 450 000 ₽",
    tags: ["Go", "PostgreSQL", "gRPC"],
    type: "Fulltime",
    posted: "5д назад",
    featured: false,
    category: "Backend",
    level: "Middle",
    matchedSkills: ["Go", "PostgreSQL"],
    description: `Команда Payments Backend в Тинькофф обрабатывает миллиарды транзакций в год. Ищем Backend Engineer (Golang) для разработки надёжных и масштабируемых сервисов платёжной инфраструктуры.

Чем предстоит заниматься: разработка микросервисов на Go в платёжной инфраструктуре, проектирование API и межсервисного взаимодействия через gRPC, работа с PostgreSQL (схемы, индексы, запросы, репликация), участие в code review, написание unit и integration тестов.

Что мы ждём: 3+ лет коммерческой разработки на Go, уверенное знание PostgreSQL, опыт с gRPC и Protocol Buffers, понимание CAP-теоремы и eventual consistency, опыт с очередями сообщений (Kafka или RabbitMQ).

Будет плюсом: опыт с финансовыми системами, знание Redis и паттернов кэширования, опыт с Kubernetes.`,
    parsedSkills: ["Go", "PostgreSQL", "gRPC", "Kafka", "Redis", "Kubernetes", "Protocol Buffers", "RabbitMQ", "Docker"],
  },
];

export const COMPANIES: Company[] = [
  {
    id: "yandex",
    name: "Yandex",
    jobs: 184,
    domain: "yandex.ru",
    site: "https://yandex.ru/jobs",
    logo: "Y",
    color: "#ff3e78",
    industry: "Tech",
    size: "10 000+",
    founded: "1997",
    hq: "Москва",
    about: "Крупнейшая российская IT-компания. Поисковик, облако, беспилотники, AI-исследования.",
    tech_stack: ["Go", "C++", "Python", "Rust", "Java", "Kubernetes", "ClickHouse", "MapReduce"],
    culture: ["Research-driven", "High ownership", "Open source", "Publication culture"],
    perks: ["ДМС и стоматология", "Релокация", "Корпоративное обучение", "Опционы", "Гибкий график"],
    rating: { overall: 4.3, wlb: 3.8, growth: 4.6, management: 4.1 },
    reviews: [
      { id: 1, author: "Senior Backend Engineer", role: "Backend", date: "авг 2024", rating: 5, pros: "Огромный масштаб задач, умные коллеги, хорошие деньги. Реально интересные технические вызовы на каждом уровне.", cons: "Большая компания — много согласований. Иногда сложно понять на что влияешь глобально.", verdict: "рекомендую" },
      { id: 2, author: "ML Engineer", role: "AI/ML", date: "июл 2024", rating: 4, pros: "Лучший стек для ML в России. Доступ к данным и вычислительным ресурсам на уровне мировых компаний.", cons: "Внутренняя политика иногда мешает. Карьерный трек непрозрачный.", verdict: "рекомендую" },
      { id: 3, author: "DevOps Engineer", role: "DevOps", date: "июн 2024", rating: 3, pros: "Зарплата выше рынка, хорошие инструменты.", cons: "Work-life balance страдает в период релизов. Овертаймы не редкость.", verdict: "нейтрально" },
    ],
    hiringInsights: [
      { id: 1, role: "Senior Rust Engineer", date: "авг 2024", outcome: "оффер", difficulty: 4, duration: "3 недели", stages: ["Скрининг HR 30 мин", "Алго-интервью 90 мин", "Системный дизайн 90 мин", "Встреча с командой"], comment: "Алго было сложным — готовьте LeetCode hard. Системный дизайн на распределённые системы. Команда приятная, без стресса." },
      { id: 2, role: "Platform Engineer", date: "июл 2024", outcome: "отказ", difficulty: 5, duration: "5 недель", stages: ["HR скрининг", "Тех. интервью", "Системный дизайн", "Bar raiser", "Финальное"], comment: "Очень много этапов. Зарезали на bar raiser — сказали «не хватает масштаба мышления». Процесс изматывает." },
      { id: 3, role: "ML Research Engineer", date: "июн 2024", outcome: "оффер", difficulty: 5, duration: "4 недели", stages: ["Research screening", "Обсуждение работ", "ML theory + coding", "Встреча с директором"], comment: "Спрашивали математику и теорию глубже, чем ожидал. Без публикаций или strong open source трудно пройти." },
    ],
  },
  {
    id: "avito",
    name: "Avito",
    jobs: 97,
    domain: "avito.ru",
    site: "https://avito.ru/company/jobs",
    logo: "A",
    color: "#00d4ff",
    industry: "Marketplace",
    size: "5 000+",
    founded: "2007",
    hq: "Москва",
    about: "Крупнейший классифайд-маркетплейс России. Высоконагруженные системы, Go, Kubernetes.",
    tech_stack: ["Go", "PHP", "Kubernetes", "Kafka", "PostgreSQL", "Elasticsearch", "Redis"],
    culture: ["Engineering excellence", "Blameless culture", "High autonomy", "Remote-friendly"],
    perks: ["ДМС", "Remote-first", "Гибкий отпуск", "Обучение и конференции", "Спортивная компенсация"],
    rating: { overall: 4.5, wlb: 4.4, growth: 4.3, management: 4.5 },
    reviews: [
      { id: 1, author: "Staff Platform Engineer", role: "DevOps", date: "авг 2024", rating: 5, pros: "Лучший engineering culture в России по моему опыту. Blameless post-mortems реально работают. Высокая автономия.", cons: "Иногда слишком много свободы — надо уметь самоорганизоваться.", verdict: "рекомендую" },
      { id: 2, author: "Senior Go Developer", role: "Backend", date: "июл 2024", rating: 5, pros: "Remote-first без исключений. Задачи крутые — реальная нагрузка, интересные технические решения.", cons: "Компенсация чуть ниже Яндекса и Сбера. Онбординг мог бы быть структурированнее.", verdict: "рекомендую" },
      { id: 3, author: "SRE", role: "SRE", date: "май 2024", rating: 4, pros: "On-call культура здоровая, инциденты разбирают грамотно. Коллеги сильные.", cons: "Карьерный рост медленнее чем в стартапах.", verdict: "рекомендую" },
    ],
    hiringInsights: [
      { id: 1, role: "Senior SRE", date: "авг 2024", outcome: "оффер", difficulty: 3, duration: "2 недели", stages: ["Скрининг 20 мин", "Тех. интервью Go + Linux", "Live incident exercise", "Встреча с командой"], comment: "Приятный процесс. Live incident — разбирали реальный случай из их практики. Без лишнего стресса." },
      { id: 2, role: "Platform Engineer Staff", date: "июл 2024", outcome: "оффер", difficulty: 4, duration: "4 недели", stages: ["Первичный звонок", "Системный дизайн платформы", "Leadership интервью", "Bar raiser"], comment: "Фокус на реальном опыте, не на leetcode. Системный дизайн на конкретную проблему их платформы — интересно." },
    ],
  },
  {
    id: "ozon",
    name: "Ozon",
    jobs: 143,
    domain: "ozon.ru",
    site: "https://job.ozon.ru",
    logo: "O",
    color: "#a78bfa",
    industry: "E-commerce",
    size: "8 000+",
    founded: "1998",
    hq: "Москва",
    about: "Один из крупнейших e-commerce игроков. Масштабирование, ML-рекомендации, фулфилмент.",
    tech_stack: ["Go", "Python", "React", "TypeScript", "Kubernetes", "Kafka", "ClickHouse"],
    culture: ["Data-driven", "Move fast", "Customer obsessed", "Growth mindset"],
    perks: ["ДМС", "Корпоративная доставка Ozon", "Обучение", "Гибкий формат", "Акции компании"],
    rating: { overall: 3.9, wlb: 3.4, growth: 4.2, management: 3.7 },
    reviews: [
      { id: 1, author: "Senior Frontend", role: "Frontend", date: "авг 2024", rating: 4, pros: "Масштаб впечатляет. Технически интересно — высокие нагрузки, сложные продуктовые задачи.", cons: "Темп очень высокий, иногда нет времени сделать качественно. WLB страдает.", verdict: "нейтрально" },
      { id: 2, author: "ML Engineer", role: "AI/ML", date: "июн 2024", rating: 4, pros: "Хорошие данные для работы, умные коллеги, реальное влияние рекомендаций.", cons: "Частые реорги. Приоритеты меняются слишком быстро.", verdict: "нейтрально" },
    ],
    hiringInsights: [
      { id: 1, role: "Senior Frontend", date: "июл 2024", outcome: "оффер", difficulty: 3, duration: "2 недели", stages: ["Скрининг", "JS internals + React", "Код-ревью задания", "Встреча с PM"], comment: "Домашнее задание было интересным — написать компонент с WebGL. Интервью приятное, без надуманных задач." },
    ],
  },
  {
    id: "tinkoff",
    name: "Тинькофф",
    jobs: 121,
    domain: "tinkoff.ru",
    site: "https://career.tinkoff.ru",
    logo: "T",
    color: "#fbbf24",
    industry: "Fintech",
    size: "5 000+",
    founded: "2006",
    hq: "Москва",
    about: "Крупнейший необанк. Remote-first культура, Go-бэкенд, быстрый карьерный рост.",
    tech_stack: ["Go", "Java", "Kotlin", "Swift", "React", "Kafka", "PostgreSQL", "Kubernetes"],
    culture: ["Remote-first", "Fast growth", "Ownership", "Performance culture"],
    perks: ["ДМС и стоматология", "Remote по всему миру", "Опционы", "Обучение за счёт компании", "Фитнес"],
    rating: { overall: 4.4, wlb: 4.2, growth: 4.7, management: 4.3 },
    reviews: [
      { id: 1, author: "iOS Lead", role: "Mobile", date: "авг 2024", rating: 5, pros: "Remote-first по всему миру — реально работает. Быстрый карьерный рост, если показываешь результат. Продукт живой и большой.", cons: "Performance culture — иногда давит. Нужно постоянно доказывать ценность.", verdict: "рекомендую" },
      { id: 2, author: "Go Backend", role: "Backend", date: "июл 2024", rating: 4, pros: "Финтех-задачи технически интересные. Хорошая зарплата и рост.", cons: "Строгие процессы безопасности замедляют разработку.", verdict: "рекомендую" },
    ],
    hiringInsights: [
      { id: 1, role: "Backend Go Middle", date: "авг 2024", outcome: "оффер", difficulty: 3, duration: "10 дней", stages: ["HR 20 мин", "Go + PostgreSQL интервью", "Системный дизайн", "Встреча с командой"], comment: "Быстрый процесс. Go-интервью стандартное — горутины, каналы, паттерны. Системный дизайн на финтех-кейс." },
      { id: 2, role: "iOS Lead", date: "июн 2024", outcome: "оффер", difficulty: 4, duration: "3 недели", stages: ["Звонок с iOS Lead", "Swift + архитектура", "Leadership", "CTO"], comment: "Leadership интервью серьёзное — спрашивали про конфликты, провальные проекты. CTO доступный и интересный." },
    ],
  },
  {
    id: "sber",
    name: "Sber",
    jobs: 209,
    domain: "sber.ru",
    site: "https://www.sberbank.com/ru/career",
    logo: "S",
    color: "#33ff77",
    industry: "Fintech",
    size: "50 000+",
    founded: "1841",
    hq: "Москва",
    about: "Крупнейший финансовый экосистемный игрок. AI-лаборатория, GigaChat, облачная платформа.",
    tech_stack: ["Python", "Go", "Java", "Kubernetes", "Hadoop", "Spark", "ClickHouse", "PyTorch"],
    culture: ["Ecosystem scale", "AI-first", "Research culture", "Innovation"],
    perks: ["ДМС премиум", "Корпоративные скидки", "Обучение (Sber University)", "Ипотека от 7%", "Спорт"],
    rating: { overall: 3.8, wlb: 3.6, growth: 3.9, management: 3.5 },
    reviews: [
      { id: 1, author: "ML Infrastructure Engineer", role: "AI/ML", date: "авг 2024", rating: 4, pros: "GPU-ресурсы огромные — нигде больше в России не дадут столько железа для экспериментов. GigaChat — реальный продукт.", cons: "Корпоративные процессы тяжёлые. Много согласований, медленные решения.", verdict: "нейтрально" },
      { id: 2, author: "Data Engineer", role: "Data", date: "май 2024", rating: 3, pros: "Стабильность и соцпакет. Масштаб данных интересный.", cons: "Бюрократия на каждом шагу. Инициативы гасятся медленно.", verdict: "нейтрально" },
    ],
    hiringInsights: [
      { id: 1, role: "ML Infrastructure Engineer", date: "июл 2024", outcome: "оффер", difficulty: 3, duration: "3 недели", stages: ["Звонок tech lead", "Python + ML системный дизайн", "Take-home задание", "Финальный звонок"], comment: "Take-home заняло 4 часа — пришлось написать training pipeline. Оценивали код и подход к архитектуре." },
      { id: 2, role: "Senior Go Developer", date: "апр 2024", outcome: "ghosted", difficulty: 2, duration: "6 недель", stages: ["HR звонок", "Техническое интервью"], comment: "После технического — тишина 6 недель. На запросы не отвечали. Разочаровал процесс." },
    ],
  },
  {
    id: "vk",
    name: "VK",
    jobs: 88,
    domain: "vk.company",
    site: "https://vk.company/ru/jobs",
    logo: "V",
    color: "#00d4ff",
    industry: "Social",
    size: "6 000+",
    founded: "2006",
    hq: "Москва",
    about: "Технологическая экосистема: соцсети, мессенджеры, облако, игровые платформы.",
    tech_stack: ["PHP", "Go", "C++", "Python", "Kubernetes", "Kafka", "MySQL", "TarantoolDB"],
    culture: ["Product ownership", "User-first", "Tech depth", "Cross-functional teams"],
    perks: ["ДМС", "Гибридный формат", "Обучение", "Корпоративный транспорт", "Кафетерий"],
    rating: { overall: 3.7, wlb: 3.8, growth: 3.6, management: 3.5 },
    reviews: [
      { id: 1, author: "Senior Data Engineer", role: "Data", date: "июл 2024", rating: 4, pros: "Данные в масштабе соцсети — уникальный опыт. Коллеги технически сильные.", cons: "Технический стек местами устаревший (PHP). Скорость изменений низкая.", verdict: "нейтрально" },
    ],
    hiringInsights: [
      { id: 1, role: "Data Engineer Senior", date: "июн 2024", outcome: "оффер", difficulty: 3, duration: "2 недели", stages: ["HR скрининг", "SQL + Spark интервью", "Системный дизайн пайплайна", "Встреча с командой"], comment: "SQL часть была глубокой — оконные функции, оптимизация. Системный дизайн на реальную задачу обработки событий." },
    ],
  },
  {
    id: "positive",
    name: "Positive Technologies",
    jobs: 62,
    domain: "ptsecurity.com",
    site: "https://www.ptsecurity.com/ru-ru/about/jobs",
    logo: "P",
    color: "#ff3e78",
    industry: "Security",
    size: "2 000+",
    founded: "2002",
    hq: "Москва",
    about: "Лидер в области кибербезопасности. Исследование уязвимостей, реверс-инжиниринг, PT NAD.",
    tech_stack: ["C", "C++", "Python", "Rust", "Go", "Assembly", "IDA Pro", "Ghidra"],
    culture: ["Research excellence", "Publication culture", "Conference speakers", "CTF culture"],
    perks: ["ДМС", "Участие в конференциях (Black Hat, PHDays)", "Гибкий график", "Bug bounty программа"],
    rating: { overall: 4.6, wlb: 4.5, growth: 4.4, management: 4.5 },
    reviews: [
      { id: 1, author: "Security Researcher", role: "Security", date: "авг 2024", rating: 5, pros: "Лучшее место для RE и malware research в России. Публикуешься, выступаешь на конференциях — реально ценят экспертизу.", cons: "Небольшая компания — меньше ресурсов чем в корпорациях. Зарплата чуть ниже топов.", verdict: "рекомендую" },
    ],
    hiringInsights: [
      { id: 1, role: "Security Researcher", date: "июл 2024", outcome: "оффер", difficulty: 5, duration: "4 недели", stages: ["Тех. скрининг с lead", "Практическое задание: анализ семпла 48ч", "Разбор + интервью", "Встреча с командой"], comment: "Практическое задание — реальный семпл малвари. 48 часов на анализ и отчёт. Сложно, но честно — проверяют реальные навыки." },
    ],
  },
  {
    id: "2gis",
    name: "2ГИС",
    jobs: 41,
    domain: "2gis.ru",
    site: "https://2gis.ru/jobs",
    logo: "2",
    color: "#34d399",
    industry: "Maps",
    size: "2 000+",
    founded: "1999",
    hq: "Новосибирск / Москва",
    about: "Карты и навигация с офлайн-поддержкой. Геопространственные данные, мобильная разработка.",
    tech_stack: ["C++", "Swift", "Kotlin", "Go", "Python", "PostgreSQL", "PostGIS", "Kubernetes"],
    culture: ["Product focus", "Long-term thinking", "Regional presence", "Craft quality"],
    perks: ["ДМС", "Офис в Новосибирске и Москве", "Гибкий график", "Обучение", "Спортзал"],
    rating: { overall: 4.2, wlb: 4.6, growth: 3.8, management: 4.1 },
    reviews: [
      { id: 1, author: "C++ Engineer", role: "Backend", date: "июн 2024", rating: 4, pros: "Отличный WLB — никаких овертаймов. Продукт интересный, геозадачи технически нетривиальные.", cons: "Меньше денег чем в Москве. Карьерный рост медленнее.", verdict: "рекомендую" },
    ],
    hiringInsights: [
      { id: 1, role: "C++ Engineer", date: "май 2024", outcome: "оффер", difficulty: 3, duration: "10 дней", stages: ["HR звонок", "C++ + алгоритмы", "Встреча с командой"], comment: "Приятный и быстрый процесс. C++ интервью по делу — STL, memory management, многопоточность. Без лишнего leetcode." },
    ],
  },
];
