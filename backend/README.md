# jobs.dev backend

Production API for accounts and the personal cabinet. Run it from the project root:

```powershell
pip install -r requirements.txt
Copy-Item backend/.env.example backend/.env
.\start-backend.ps1
```

Or use the full local stack:

```powershell
Copy-Item backend/.env.example backend/.env
docker compose up --build
```

For Telegram Login Widget, create/configure a bot with BotFather and set
`TELEGRAM_AUTH_BOT_TOKEN` and `TELEGRAM_AUTH_BOT_USERNAME`. The Telegram bot
domain must match `FRONTEND_URL` in production. Set `SESSION_COOKIE_SECURE=1`
only when the production site is served over HTTPS.

Create an admin account with:

```powershell
python backend/manage.py createsuperuser
```
