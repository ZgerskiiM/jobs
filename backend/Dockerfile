FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt
COPY backend /app
COPY jobs-dev-zen-extension.zip jobs-dev-zen-extension-chrome.zip /app/
RUN mkdir -p /app/catalog /app/frontend/scripts /app/config
COPY frontend/public/vacancies.json /app/catalog/vacancies.json
COPY frontend/scripts/scoring-api.mjs frontend/scripts/vacancy-scoring.js /app/frontend/scripts/
COPY config/java_backend_vacancy_relevance_ru_v1.json config/devops_vacancy_relevance_ru_v1.json config/1c_developer_vacancy_relevance_ru_v1.json /app/config/
RUN python manage.py collectstatic --noinput

EXPOSE 8000
CMD ["sh", "-c", "python manage.py migrate && gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers 3"]
