# jobs.dev backend

Production API for accounts and the personal cabinet. Run it from the project root:

```powershell
pip install -r requirements.txt
Copy-Item backend/.env.example backend/.env
.\start-backend.ps1
```

`start-backend.ps1` uses SQLite and enables the development-only auth bypass.
Every browser session is automatically signed in as `local@jobs.dev`, so email
and Telegram are not required for local testing. The bypass refuses to start
when `DJANGO_DEBUG=0`.

Or use the full local stack:

```powershell
Copy-Item backend/.env.example backend/.env
docker compose up --build
```

For Telegram Login Widget, create/configure a bot with BotFather and set
`TELEGRAM_AUTH_BOT_TOKEN` and `TELEGRAM_AUTH_BOT_USERNAME`. The Telegram bot
domain must match `FRONTEND_URL` in production. Set `SESSION_COOKIE_SECURE=1`
only when the production site is served over HTTPS.

The browser extension resolves submitted applications against the generated
vacancy catalog. The API reads ../frontend/public/vacancies.json locally;
set VACANCY_CATALOG_PATH to the deployed catalog path, or JOB_TRACKER_DB_PATH
to a mounted data/jobs.sqlite3 as a fallback.

Create an admin account with:

```powershell
python backend/manage.py createsuperuser
```
