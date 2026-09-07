# Telegram-уведомления jobs.dev

Персональные уведомления отправляют пользователю новые вакансии после каждого
прохода каталога. Фильтры берутся из профиля jobs.dev, а ссылка в сообщении ведёт
на страницу вакансии внутри jobs.dev.

## Почему нужен домен

Современный Telegram Login работает через OAuth 2.0 / OpenID Connect и требует
публичный HTTPS-адрес. Для стенда jobs.dev это:

```text
https://devver.ru
```

В `@BotFather` откройте **Bot Settings → Web Login (Login)** и добавьте origin
`https://devver.ru` и callback
`https://devver.ru/api/auth/telegram/callback/`. Сохраните выданные Client ID и
Client Secret — они понадобятся только backend. В запросе входа также
запрашивается `telegram:bot_access`, чтобы после согласия пользователя бот мог
отправлять персональные уведомления о новых вакансиях.

## 1. Настройка backend

В `backend/.env` на сервере добавьте один общий секрет. Он должен быть одинаковым
на сервере и в GitHub Actions:

```env
TELEGRAM_SYNC_TOKEN=сгенерируйте-длинную-случайную-строку
```

Не добавляйте этот токен в Git, frontend или сообщения Telegram.

Для входа через OIDC добавьте на сервер:

```env
TELEGRAM_OIDC_CLIENT_ID=Client_ID_из_BotFather
TELEGRAM_OIDC_CLIENT_SECRET=Client_Secret_из_BotFather
TELEGRAM_OIDC_REDIRECT_URI=https://devver.ru/api/auth/telegram/callback/
```

Старые `TELEGRAM_AUTH_BOT_TOKEN` и `TELEGRAM_AUTH_BOT_USERNAME` можно оставить
для совместимости с расширением, но сайт больше не использует legacy iframe-
виджет.

После изменения `.env` перезапустите API-контейнер:

```bash
docker compose up -d --no-build api worker web
```

## 2. Настройка GitHub Actions

В репозитории откройте `Settings → Secrets and variables → Actions`.

Добавьте Secrets:

| Имя | Значение |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | токен бота от `@BotFather` |
| `TELEGRAM_SYNC_TOKEN` | то же значение, что в backend `.env` |

Добавьте Variables:

| Имя | Пример |
| --- | --- |
| `TELEGRAM_SUBSCRIBERS_URL` | `https://jobs.example.ru/api/integrations/telegram/subscribers/` |
| `TELEGRAM_SITE_URL` | `https://jobs.example.ru` |

После этого workflow `Nightly vacancies` будет:

1. обновлять каталог;
2. получать список пользователей, включивших Telegram-уведомления;
3. применять индивидуальные фильтры;
4. отправлять только новые вакансии;
5. сохранять отметку доставки, чтобы не было дублей.

## 3. Настройка пользователя

Пользователь должен:

1. войти через Telegram на jobs.dev;
2. открыть `Профиль → Настройки`;
3. включить `Новые вакансии после каждого обновления`;
4. при необходимости заполнить ключевые слова, технологии, компании и города;
5. сохранить настройки.

Выбранные в разделе `Предпочтения` роли, уровни и формат работы тоже учитываются.
Пустой фильтр не ограничивает выдачу. Значения внутри одного поля разделяются
запятыми, например `Java, Spring, Kafka`.

## 4. Проверка после появления домена

Проверить endpoint списка подписчиков можно так:

```bash
curl -H "Authorization: Bearer $TELEGRAM_SYNC_TOKEN" \
  https://jobs.example.ru/api/integrations/telegram/subscribers/
```

Ожидаемый ответ:

```json
{
  "subscribers": [],
  "count": 0,
  "generatedAt": "..."
}
```

Для теста:

1. войдите одним тестовым пользователем через Telegram;
2. включите уведомления и задайте фильтр `Java`;
3. запустите workflow вручную через `Actions → Nightly vacancies → Run workflow`;
4. проверьте сообщение со ссылкой вида `https://jobs.example.ru/jobs/...`.

Если тестовое сообщение не пришло, сначала проверьте, что пользователь вошёл через
Telegram, переключатель уведомлений включён, а `TELEGRAM_SYNC_TOKEN` совпадает на
сервере и в GitHub Actions.

## Безопасность

- токен бота и `TELEGRAM_SYNC_TOKEN` хранятся только в Secrets/.env;
- endpoint подписчиков принимает только Bearer-токен;
- в Telegram отправляются только пользователи с активным аккаунтом и включённым
  переключателем;
- ошибки доставки не раскрывают секреты и сохраняются только в локальной базе
  уведомителя.
