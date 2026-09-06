FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

COPY . /app
RUN mkdir -p /shared \
    && cp frontend/public/vacancies.json /shared/vacancies.json \
    && cp frontend/public/vacancy-refresh.json /shared/vacancy-refresh.json

CMD ["python", "crawler/runner.py"]
