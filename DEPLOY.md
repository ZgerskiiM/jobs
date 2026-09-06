# Публикация и ночное обновление

Production-вариант для обычного сервера — Docker Compose + PostgreSQL + Redis +
Django API + Caddy. SSR для этого запуска не требуется.

## GitHub Actions CI/CD (рекомендуется для стенда)

Для стенда добавлен workflow `.github/workflows/staging.yml`. Он запускает проверки
Python и frontend на pull request, а после push в `main` собирает API/web-образы,
публикует их в GitHub Container Registry и выкладывает стенд по SSH. GitLab pipeline
ниже можно оставить для старой инфраструктуры, но для новой выкладки он не нужен.

В GitHub создайте Environment `staging` и добавьте Variables:

- `DEPLOY_HOST` — DNS-имя или IP сервера;
- `DEPLOY_USER` — пользователь с доступом к Docker без sudo;
- `DEPLOY_PATH` — каталог проекта на сервере, например `/opt/jobs-dev-staging`;
- `DEPLOY_URL` — внешний HTTPS-адрес стенда.

В тот же Environment добавьте Secrets:

- `SSH_PRIVATE_KEY` — отдельный deploy key пользователя стенда;
- `SSH_KNOWN_HOSTS` — вывод `ssh-keyscan -H <host>` для этого сервера.

На сервере один раз установите Docker Engine и Compose plugin, создайте `deploy/.env`
и `backend/.env` по production-шаблонам, затем проверьте DNS, firewall и доступ
пользователя к Docker. Workflow сам передаст Compose-файлы, войдёт в GHCR и выполнит
migration/restart через `deploy/remote-deploy.sh`. После этого каждый push в `main`
будет выкладывать новый стенд, а `workflow_dispatch` позволит запустить выкладку
вручную.

## GitLab CI/CD

Pipeline находится в `.gitlab-ci.yml`. Он выполняет тесты на merge request, собирает
и публикует API/web-образы в GitLab Container Registry, автоматически выкладывает
`main` на `staging`, а production выкладывает вручную по Git-тегу. Ночной scheduled
pipeline обновляет вакансии, собирает новый web-образ и выкладывает его в production.

В GitLab добавьте CI/CD variables. Для staging и production переменные
`DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PATH`, `DEPLOY_URL` можно задать с разным
Environment scope:

- `SSH_PRIVATE_KEY` — private deploy key, masked/protected;
- `SSH_KNOWN_HOSTS` — результат `ssh-keyscan` сервера, protected;
- `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PATH`, `DEPLOY_URL` — параметры окружения;
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — masked/protected для scheduled pipeline;
- при необходимости `HH_API_TOKEN` — masked/protected для обновления источников.

На сервере заранее создайте `deploy/.env` и `backend/.env` по production-шаблонам.
CI намеренно не передаёт эти файлы по SSH. Пользователь, под которым выполняется
SSH deploy, должен иметь доступ к Docker без sudo. В Registry должны быть доступны
образы для этого проекта.

Защитите ветку `main` и production-теги. Production job по тегу запускается вручную;
scheduled pipeline использует production environment автоматически. В GitLab
создайте расписание в `Build → Pipeline schedules`, например на `03:15` по Москве.
Если включаете scheduled pipeline, отключите старый GitHub Actions schedule и
server-side `jobs-dev-vacancies.timer`, чтобы каталог не обновлялся дважды.

## Production через Docker

### 1. Подготовка сервера

На сервере нужны Docker Engine и Docker Compose plugin. Клонируйте проект, например
в `/opt/jobs-dev`, и создайте production-переменные:

```bash
cp deploy/.env.example deploy/.env
cp backend/.env.production.example backend/.env
```

В обоих файлах замените домен, пароли и токены. `APP_DOMAIN` должен указывать на DNS
имя сервера. В `backend/.env` должны совпадать домен из `FRONTEND_URL`,
`DJANGO_ALLOWED_HOSTS` и `CSRF_TRUSTED_ORIGINS`.

До запуска проверьте конфигурацию без старта контейнеров:

```bash
docker compose --env-file deploy/.env -f docker-compose.yml -f docker-compose.prod.yml config
```

Откройте на firewall только TCP 80 и 443. Порты PostgreSQL, Redis, Django и
внутренний Nginx наружу не публикуются production override-файлом.

### 2. Первый запуск

```bash
docker compose --env-file deploy/.env -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose --env-file deploy/.env -f docker-compose.yml -f docker-compose.prod.yml exec api python manage.py createsuperuser
docker compose --env-file deploy/.env -f docker-compose.yml -f docker-compose.prod.yml ps
curl -fsS https://jobs.example.com/healthz/
```

Caddy сам запросит сертификат Let’s Encrypt, если DNS уже указывает на сервер и порты
80/443 доступны из интернета.

### 3. Backup

Скрипт сохраняет PostgreSQL и загруженные резюме в `backups/`, оставляя последние
14 дней:

```bash
bash deploy/backup.sh
```

Запускайте его отдельным ежедневным cron/systemd timer и периодически проверяйте
восстановление backup. Docker volumes не заменяют backup.

### 4. Ночное обновление вакансий

На сервере должны быть установлены Python-зависимости из `requirements.txt`, после
чего установите systemd unit-файлы:

```bash
sudo cp deploy/systemd/jobs-dev-vacancies.* deploy/systemd/jobs-dev-backup.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now jobs-dev-vacancies.timer
sudo systemctl enable --now jobs-dev-backup.timer
sudo systemctl start jobs-dev-vacancies.service
```

Путь `/opt/jobs-dev` в unit-файле замените на фактический путь проекта. Обновление
выполняет `sync`, экспортирует каталог, пересобирает web-контейнер и запускает его
заново. GitHub Actions ниже по-прежнему публикует отдельную GitHub Pages-версию и
не обновляет Docker-сервер.

## Backend

Авторизация и личные кабинеты работают через Django API, а не через GitHub Pages.
Для production поднимайте `docker-compose.yml`: сервис `web` отдаёт React и
проксирует `/api` и `/admin` в API-сервис. Перед запуском скопируйте
`backend/.env.example` в `backend/.env`, задайте `DJANGO_SECRET_KEY`, Telegram
настройки и параметры PostgreSQL/Redis. Не публикуйте `.env` в репозитории.

Для локальной разработки `start-site.ps1` поднимает Django API на `:8000` и Vite
на `:8443`; Vite проксирует API-запросы автоматически.

Проект подготовлен для GitHub Pages. Каждую ночь в 03:15 по Москве GitHub Actions:

1. восстанавливает SQLite с состоянием предыдущего запуска;
2. обходит подключённые карьерные сайты;
3. отправляет только новые вакансии, прошедшие Telegram-фильтр;
4. пересобирает витрину и публикует её на GitHub Pages.

## Первый запуск

1. Создайте пустой репозиторий GitHub и загрузите в него содержимое этой папки.
2. В `Settings → Pages → Build and deployment → Source` выберите `GitHub Actions`.
3. В `Settings → Secrets and variables → Actions` добавьте секреты:
   - `TELEGRAM_BOT_TOKEN` — токен от `@BotFather`;
   - `TELEGRAM_CHAT_ID` — ID личного чата или группы.
4. Откройте `Actions → Nightly vacancies → Run workflow`.

После успешного запуска ссылка появится в шаге `Deploy to GitHub Pages` и в
`Settings → Pages`. Исторические вакансии при первом облачном запуске не отправляются.

## Telegram-фильтр

Фильтр хранится в `config/telegram-filter.json`. По умолчанию включена только Java:

```json
{
  "technologies": ["Java"],
  "keywords": [],
  "companies": [],
  "locations": []
}
```

Непустые группы объединяются через «И», значения внутри группы — через «ИЛИ».
Например, Java + `backend`/`spring` + Москва/удалённо означает, что вакансия должна
быть Java-вакансией, содержать одно из ключевых слов и подходить по одной из локаций.

## Локальный ночной запуск

Если обновление должно выполняться на этом компьютере, запустите
`setup-nightly-task.ps1`. Он подключит Telegram и зарегистрирует задачу Windows
`JobTrackerNightly` на 03:00 каждый день. Компьютер должен быть включён; пропущенная
задача запустится после следующего включения.
