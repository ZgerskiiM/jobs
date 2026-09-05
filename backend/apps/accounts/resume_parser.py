"""Text extraction and deterministic skill detection for uploaded resumes."""

from __future__ import annotations

from io import BytesIO
from pathlib import Path
import re
import zipfile


SUPPORTED_RESUME_SUFFIXES = {".pdf", ".docx"}
RESUME_ANALYSIS_VERSION = 2

# Keep the output stable even when candidates use an alias or a different case.
# The list is intentionally explicit: extracting arbitrary capitalised words
# from a CV creates too many false positives for vacancy matching.
SKILL_CATALOG = (
    ("Python", "Языки", ("python", "питон")),
    ("JavaScript", "Языки", ("javascript", "js")),
    ("TypeScript", "Языки", ("typescript", "ts")),
    ("Go", "Языки", ("go", "golang", "го")),
    ("Rust", "Языки", ("rust",)),
    ("Java", "Языки", ("java",)),
    ("Kotlin", "Языки", ("kotlin",)),
    ("Swift", "Языки", ("swift",)),
    ("C#", "Языки", ("c#", "c sharp")),
    ("C++", "Языки", ("c++", "cpp")),
    ("PHP", "Языки", ("php",)),
    ("Ruby", "Языки", ("ruby",)),
    ("SQL", "Языки", ("sql",)),
    ("Bash", "Языки", ("bash", "shell")),
    ("HTML", "Языки", ("html",)),
    ("CSS", "Языки", ("css",)),
    ("Sass", "Языки", ("sass", "scss")),
    ("React", "Фреймворки", ("react", "react.js", "reactjs")),
    ("Vue", "Фреймворки", ("vue", "vue.js", "vuejs")),
    ("Angular", "Фреймворки", ("angular",)),
    ("Next.js", "Фреймворки", ("next.js", "nextjs")),
    ("Node.js", "Фреймворки", ("node.js", "nodejs")),
    ("Django", "Фреймворки", ("django",)),
    ("FastAPI", "Фреймворки", ("fastapi",)),
    ("Spring", "Фреймворки", ("spring", "spring boot")),
    ("Spring Boot", "Фреймворки", ("spring boot",)),
    ("Spring Security", "Фреймворки", ("spring security",)),
    ("Spring Data JPA", "Фреймворки", ("spring data jpa",)),
    ("Hibernate", "Фреймворки", ("hibernate",)),
    ("WebSocket", "Протоколы и фреймворки", ("websocket", "web sockets")),
    (".NET", "Фреймворки", (".net", "dotnet")),
    ("1C", "Прикладные технологии", ("1c", "1с", "1 c", "1 с")),
    ("Excel", "Прикладные технологии", ("excel", "эксель")),
    ("Power BI", "Прикладные технологии", ("power bi",)),
    ("Figma", "Прикладные технологии", ("figma",)),
    ("Docker", "Инфраструктура", ("docker",)),
    ("Kubernetes", "Инфраструктура", ("kubernetes", "k8s")),
    ("Terraform", "Инфраструктура", ("terraform",)),
    ("Ansible", "Инфраструктура", ("ansible",)),
    ("Helm", "Инфраструктура", ("helm",)),
    ("AWS", "Инфраструктура", ("aws", "amazon web services")),
    ("Azure", "Инфраструктура", ("azure",)),
    ("GCP", "Инфраструктура", ("gcp", "google cloud")),
    ("Linux", "Инфраструктура", ("linux",)),
    ("Nginx", "Инфраструктура", ("nginx",)),
    ("GitHub Actions", "Инфраструктура", ("github actions",)),
    ("GitLab CI", "Инфраструктура", ("gitlab ci",)),
    ("Prometheus", "Инфраструктура", ("prometheus",)),
    ("Grafana", "Инфраструктура", ("grafana",)),
    ("PostgreSQL", "Базы данных", ("postgresql", "postgres", "постгрес")),
    ("MySQL", "Базы данных", ("mysql",)),
    ("MongoDB", "Базы данных", ("mongodb", "mongo")),
    ("Redis", "Базы данных", ("redis",)),
    ("ClickHouse", "Базы данных", ("clickhouse",)),
    ("Elasticsearch", "Базы данных", ("elasticsearch", "elastic search")),
    ("REST API", "Протоколы и фреймворки", ("rest api", "restful", "rest")),
    ("GraphQL", "Протоколы и фреймворки", ("graphql",)),
    ("gRPC", "Протоколы и фреймворки", ("grpc",)),
    ("Kafka", "Протоколы и фреймворки", ("kafka", "apache kafka")),
    ("RabbitMQ", "Протоколы и фреймворки", ("rabbitmq",)),
    ("OpenAPI", "Протоколы и фреймворки", ("openapi", "swagger")),
    ("OAuth", "Протоколы и фреймворки", ("oauth",)),
    ("CI/CD", "Практики", ("ci/cd", "cicd", "continuous integration")),
    ("Git", "Практики", ("git",)),
    ("System Design", "Практики", ("system design", "системный дизайн")),
    ("Microservices", "Практики", ("microservices", "микросервисы")),
    ("Code Review", "Практики", ("code review", "код-ревью")),
    ("Agile", "Практики", ("agile",)),
    ("Scrum", "Практики", ("scrum",)),
    ("Machine Learning", "Практики", ("machine learning", "машинное обучение")),
    ("PyTorch", "Практики", ("pytorch",)),
    ("TensorFlow", "Практики", ("tensorflow",)),
    ("JUnit", "Практики", ("junit",)),
    ("Mockito", "Практики", ("mockito",)),
    ("Testcontainers", "Практики", ("testcontainers",)),
    ("Maven", "Практики", ("maven",)),
    ("Gradle", "Практики", ("gradle",)),
    ("Jenkins", "Практики", ("jenkins",)),
    ("Liquibase", "Практики", ("liquibase",)),
    ("ELK", "Практики", ("elk",)),
    ("SOLID", "Практики", ("solid",)),
    ("Selenium", "Практики", ("selenium",)),
    ("Playwright", "Практики", ("playwright",)),
    ("Pytest", "Практики", ("pytest",)),
    ("Airflow", "Практики", ("airflow",)),
    ("Apache Spark", "Практики", ("apache spark", "spark")),
    ("Jira", "Практики", ("jira",)),
    ("Confluence", "Практики", ("confluence",)),
)

_POSITION_TERMS = re.compile(
    r"(?:developer|engineer|разработчик|инженер|аналитик|analyst|designer|дизайнер|"
    r"manager|менеджер|devops|sre|qa|тестировщик|data scientist|machine learning)",
    re.IGNORECASE,
)
_EXPERIENCE_RE = re.compile(r"(?<!\d)(\d{1,2}(?:[.,]\d+)?)\s*(лет|года|год|years?|yrs?)\b", re.IGNORECASE)


def extract_resume_text(data: bytes, suffix: str) -> str:
    """Extract text from a supported resume or raise a useful ValueError."""
    suffix = suffix.casefold()
    if suffix not in SUPPORTED_RESUME_SUFFIXES:
        raise ValueError("Поддерживаются только файлы PDF и DOCX")

    if suffix == ".pdf":
        if not data.startswith(b"%PDF"):
            raise ValueError("Файл не похож на PDF")
        try:
            from pypdf import PdfReader

            text = "\n".join(page.extract_text() or "" for page in PdfReader(BytesIO(data)).pages)
        except Exception as exc:
            raise ValueError("Не удалось прочитать PDF. Проверьте, что файл не повреждён") from exc

        # Some PDFs have valid text objects but incomplete font maps. pypdf
        # then returns an empty string while pdfplumber can still recover it.
        if not text.strip() or "�" in text:
            try:
                import pdfplumber

                with pdfplumber.open(BytesIO(data)) as document:
                    text = "\n".join(page.extract_text() or "" for page in document.pages)
            except Exception:
                text = ""
    else:
        if not zipfile.is_zipfile(BytesIO(data)):
            raise ValueError("Файл не похож на DOCX")
        try:
            from docx import Document

            document = Document(BytesIO(data))
            paragraphs = [paragraph.text for paragraph in document.paragraphs]
            table_cells = [cell.text for table in document.tables for row in table.rows for cell in row.cells]
            text = "\n".join(paragraphs + table_cells)
        except Exception as exc:
            raise ValueError("Не удалось прочитать DOCX. Проверьте, что файл не повреждён") from exc

    if not text.strip():
        raise ValueError("Не удалось извлечь текст. Если это скан, сохраните резюме с текстовым слоем")
    return text


def _contains_keyword(text: str, keyword: str) -> bool:
    escaped = re.escape(keyword.casefold()).replace(r"\ ", r"\s+")
    # \w is Unicode-aware in Python, so Go does not match inside Google and
    # C# / C++ do not match a longer identifier containing those tokens.
    return re.search(rf"(?<![\w+#.]){escaped}(?![\w+#.])", text.casefold()) is not None


def _normalize_text(text: str) -> str:
    # PDF extractors often split a word at a line ending ("Postgre-\nsql").
    text = re.sub(r"(?<=\w)-\s*\n\s*(?=\w)", "", text)
    return re.sub(r"\s+", " ", text)


def detect_skills(text: str) -> list[dict[str, str | bool]]:
    """Return canonical skills found in the resume text, grouped by catalog order."""
    text = _normalize_text(text)
    return [
        {"name": name, "category": category, "confirmed": True}
        for name, category, aliases in SKILL_CATALOG
        if any(_contains_keyword(text, alias) for alias in aliases)
    ]


def extract_experience(text: str) -> str:
    experience_lines = [
        line
        for line in text.splitlines()
        if re.search(r"(?:опыт|experience)", line, re.IGNORECASE)
    ]
    matches = list(_EXPERIENCE_RE.finditer("\n".join(experience_lines)))
    if not matches:
        matches = [
            match
            for line in text.splitlines()
            if not re.search(r"(?:мужчин|женщин|родил|born|возраст)", line, re.IGNORECASE)
            for match in _EXPERIENCE_RE.finditer(line)
        ]
    if not matches:
        return ""
    value, unit = matches[0].groups()
    if unit.casefold() in {"years", "year", "yrs"}:
        return f"{value.replace(',', '.')} лет"
    return f"{value} {unit}"


def extract_position(text: str) -> str:
    for raw_line in text.splitlines()[:30]:
        line = re.sub(r"\s+", " ", raw_line).strip(" -•\t")
        if not line or len(line) > 120 or "@" in line or "http" in line.casefold():
            continue
        if _POSITION_TERMS.search(line):
            return line
    return ""


def analyze_resume(data: bytes, filename: str) -> dict[str, object]:
    suffix = Path(filename).suffix.casefold()
    text = extract_resume_text(data, suffix)
    return {
        "analysisVersion": RESUME_ANALYSIS_VERSION,
        "experience": extract_experience(text),
        "position": extract_position(text),
        "skills": detect_skills(text),
    }
