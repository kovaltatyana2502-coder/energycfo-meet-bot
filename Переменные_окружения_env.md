# Переменные окружения для Telegram-бота EnergyCFO

Документ описывает переменные окружения для backend-приложения Telegram-бота **EnergyCFO | Встречи**. Здесь не должно быть реальных секретов, токенов, паролей или refresh token.

Реальные значения хранятся только в `.env` на локальной машине разработчика и на production-сервере. Файл `.env` нельзя коммитить в Git и нельзя публиковать в документации.

## 1. Общие правила

| Правило | Требование |
|---|---|
| `.env` | хранит реальные значения, не попадает в Git |
| `.env.example` | хранит только шаблон без секретов |
| Markdown-документы | не содержат реальные токены |
| Production-секреты | хранятся только на сервере |
| Google пароль | не используется и не передается |
| Telegram token | хранится как секрет |
| Refresh token Google | хранится как секрет |

## 2. Минимальный `.env.example`

```env
# Application
NODE_ENV=development
APP_NAME=EnergyCFO Meetings Bot
APP_BASE_URL=https://meet.energycfo.pro
PORT=3000
TIMEZONE=Europe/Moscow
LOG_LEVEL=info

# Telegram
TELEGRAM_BOT_TOKEN=replace_me
TELEGRAM_ADMIN_ID=replace_me
TELEGRAM_RUN_MODE=polling
TELEGRAM_DROP_PENDING_UPDATES=false
TELEGRAM_WEBHOOK_PATH=/webhook
TELEGRAM_WEBHOOK_SECRET=replace_me

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/energycfo_bot

# Google OAuth
GOOGLE_CLIENT_ID=replace_me
GOOGLE_CLIENT_SECRET=replace_me
GOOGLE_REDIRECT_URI=https://meet.energycfo.pro/google/oauth/callback
GOOGLE_REFRESH_TOKEN=replace_me

# Google Calendar
GOOGLE_ADMIN_ACCOUNT=koval.tatyana.2502@gmail.com
GOOGLE_CALENDAR_ID=replace_me
GOOGLE_CALENDAR_NAME=Встречи с сайта CFO Energy Advisory

# Scheduling rules
WORKING_DAYS=1,2,3,4,5
WORKING_HOURS_START=10:00
WORKING_HOURS_END=18:00
MEETING_DURATION_MINUTES=60
MEETING_BUFFER_MINUTES=30
MEETING_MIN_LEAD_HOURS=12
MEETING_DAILY_LIMIT=5
USER_BOOKING_HORIZON_MONTHS=2
ADMIN_AVAILABILITY_HORIZON_MONTHS=3

# Notifications
ADMIN_REMINDER_AFTER_HOURS=2,12,24
USER_REMINDER_BEFORE_HOURS=24,1
BACKGROUND_JOBS_INTERVAL_MINUTES=10

# Backups
BACKUP_RETENTION_DAYS=14
LOG_RETENTION_DAYS=90
MIN_FREE_DISK_PERCENT=20
```

## 3. Application

| Переменная | Пример | Обязательна | Назначение |
|---|---|---:|---|
| `NODE_ENV` | `production` | да | режим работы приложения |
| `APP_NAME` | `EnergyCFO Meetings Bot` | да | название приложения в логах |
| `APP_BASE_URL` | `https://meet.energycfo.pro` | да | публичный адрес backend |
| `PORT` | `3000` | да | внутренний порт приложения |
| `TIMEZONE` | `Europe/Moscow` | да | часовой пояс отображения |
| `LOG_LEVEL` | `info` | да | уровень логирования |

### Значения по окружениям

| Переменная | Локально | Production |
|---|---|---|
| `NODE_ENV` | `development` | `production` |
| `APP_BASE_URL` | локальный URL или тестовый домен | `https://meet.energycfo.pro` |
| `PORT` | `3000` | `3000` или другой внутренний порт |
| `LOG_LEVEL` | `debug` или `info` | `info` |

## 4. Telegram

| Переменная | Пример | Обязательна | Откуда взять |
|---|---|---:|---|
| `TELEGRAM_BOT_TOKEN` | `replace_me` | да | BotFather |
| `TELEGRAM_ADMIN_ID` | `123456789` | да | через специального бота или debug-команду |
| `TELEGRAM_RUN_MODE` | `polling` | да | режим получения обновлений: `polling`, `webhook` или `off` |
| `TELEGRAM_DROP_PENDING_UPDATES` | `false` | да | сбрасывать ли накопленные обновления при старте polling/webhook |
| `TELEGRAM_WEBHOOK_PATH` | `/webhook` | да | задается в проекте |
| `TELEGRAM_WEBHOOK_SECRET` | `replace_me` | желательно | генерируется случайно |

### Что важно

| Правило | Пояснение |
|---|---|
| Token не публиковать | с ним можно управлять ботом |
| Admin ID не равен username | нужен числовой Telegram ID |
| Локально удобен polling | бот получает события напрямую с компьютера разработчика |
| Production должен работать через webhook | Telegram отправляет события на `https://meet.energycfo.pro/webhook` |
| Webhook secret | дополнительная защита webhook endpoint |
| Username бота | можно хранить в документации, это публичное значение |

### Как получить `TELEGRAM_BOT_TOKEN`

1. Открыть `@BotFather`.
2. Создать бота через `/newbot`.
3. Скопировать token.
4. Сохранить token только в `.env`.

### Как получить `TELEGRAM_ADMIN_ID`

Варианты:

| Вариант | Как работает |
|---|---|
| Через специального Telegram-бота | бот показывает ваш числовой ID |
| Через временный debug-режим | наш бот выводит ID владельцу при `/start` |

Для разработки удобнее временно сделать debug-команду, которая показывает Telegram ID только в тестовом режиме.

## 5. Database

| Переменная | Пример | Обязательна | Назначение |
|---|---|---:|---|
| `DATABASE_URL` | `postgresql://user:password@localhost:5432/energycfo_bot` | да | строка подключения к PostgreSQL |

### Рекомендуемые базы

| Окружение | Название базы |
|---|---|
| Локально | `energycfo_bot_dev` |
| Тест | `energycfo_bot_test` |
| Production | `energycfo_bot` |

### Правила

| Правило | Требование |
|---|---|
| Пароль БД | не публиковать |
| Production-БД | не использовать для тестов |
| Бэкапы | делать ежедневно |
| Миграции | применять контролируемо |

## 6. Google OAuth

| Переменная | Пример | Обязательна | Откуда взять |
|---|---|---:|---|
| `GOOGLE_CLIENT_ID` | `replace_me` | да | Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | `replace_me` | да | Google Cloud Console |
| `GOOGLE_REDIRECT_URI` | `https://meet.energycfo.pro/google/oauth/callback` | да | задается в Google Cloud и backend |
| `GOOGLE_REFRESH_TOKEN` | `replace_me` | да | получается после OAuth-подключения |

### Что важно

| Правило | Пояснение |
|---|---|
| Пароль Google не нужен | используется OAuth |
| Redirect URI должен совпадать | значение в Google Cloud и `.env` должно быть одинаковым |
| Refresh token хранить как секрет | он дает доступ к календарю |
| OAuth подключает владелец | без передачи пароля разработчику |

## 7. Google Calendar

| Переменная | Пример | Обязательна | Назначение |
|---|---|---:|---|
| `GOOGLE_ADMIN_ACCOUNT` | `koval.tatyana.2502@gmail.com` | да | аккаунт администратора |
| `GOOGLE_CALENDAR_ID` | `replace_me` | да | идентификатор календаря встреч |
| `GOOGLE_CALENDAR_NAME` | `Встречи с сайта CFO Energy Advisory` | да | человекочитаемое название календаря |

### Правила календаря

| Правило | Значение |
|---|---|
| Создавать события | только в календаре встреч |
| Проверять занятость | основной календарь + календарь встреч |
| Добавлять пользователя | по email |
| Создавать Google Meet | при согласовании |

## 8. Scheduling rules

Эти параметры можно сначала хранить в `.env`, но в полноценном MVP лучше хранить их в базе данных, чтобы администратор мог менять настройки через Telegram.

| Переменная | Значение MVP | Назначение |
|---|---|---|
| `WORKING_DAYS` | `1,2,3,4,5` | рабочие дни, где 1 - понедельник |
| `WORKING_HOURS_START` | `10:00` | начало рабочего окна |
| `WORKING_HOURS_END` | `18:00` | конец рабочего окна |
| `MEETING_DURATION_MINUTES` | `60` | длительность встречи |
| `MEETING_BUFFER_MINUTES` | `30` | буфер между встречами |
| `MEETING_MIN_LEAD_HOURS` | `12` | минимальный лаг |
| `MEETING_DAILY_LIMIT` | `5` | лимит встреч в день |
| `USER_BOOKING_HORIZON_MONTHS` | `2` | горизонт выбора пользователя |
| `ADMIN_AVAILABILITY_HORIZON_MONTHS` | `3` | горизонт админ-настроек |

### Правило приоритета

Если настройка есть и в `.env`, и в базе данных, приоритет должен быть у базы данных. `.env` используется как начальное значение и fallback.

## 9. Notifications

| Переменная | Значение MVP | Назначение |
|---|---|---|
| `ADMIN_REMINDER_AFTER_HOURS` | `2,12,24` | напоминания администратору |
| `USER_REMINDER_BEFORE_HOURS` | `24,1` | напоминания пользователю |
| `BACKGROUND_JOBS_INTERVAL_MINUTES` | `10` | частота фоновой проверки |

### Важные правила

| Правило | Требование |
|---|---|
| Не отправлять дубли | хранить журнал уведомлений |
| Логировать ошибки | если сообщение не отправлено |
| Не раскрывать лишние данные | техошибка не должна уходить пользователю |

## 10. Backups and logs

| Переменная | Значение MVP | Назначение |
|---|---|---|
| `BACKUP_RETENTION_DAYS` | `14` | срок хранения бэкапов |
| `LOG_RETENTION_DAYS` | `90` | срок хранения логов |
| `MIN_FREE_DISK_PERCENT` | `20` | минимальный свободный диск |

### Контроль диска

| Проверка | Требование |
|---|---|
| Свободное место | не менее 20% |
| Логи | ротация включена |
| Бэкапы | старые удаляются |
| БД | размер контролируется |

## 11. Production `.env`

Production `.env` должен храниться только на сервере.

Пример структуры без значений:

```env
NODE_ENV=production
APP_NAME=EnergyCFO Meetings Bot
APP_BASE_URL=https://meet.energycfo.pro
PORT=3000
TIMEZONE=Europe/Moscow
LOG_LEVEL=info

TELEGRAM_BOT_TOKEN=...
TELEGRAM_ADMIN_ID=...
TELEGRAM_RUN_MODE=webhook
TELEGRAM_DROP_PENDING_UPDATES=false
TELEGRAM_WEBHOOK_PATH=/webhook
TELEGRAM_WEBHOOK_SECRET=...

DATABASE_URL=...

GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://meet.energycfo.pro/google/oauth/callback
GOOGLE_REFRESH_TOKEN=...

GOOGLE_ADMIN_ACCOUNT=koval.tatyana.2502@gmail.com
GOOGLE_CALENDAR_ID=...
GOOGLE_CALENDAR_NAME=Встречи с сайта CFO Energy Advisory
```

## 12. Локальный `.env`

Локальный `.env` используется только для разработки.

| Что можно использовать локально | Комментарий |
|---|---|
| тестовый Telegram-бот | желательно, чтобы не мешать production |
| тестовая база | обязательно |
| тестовый Google-календарь | желательно |
| polling вместо webhook | допустимо временно |

## 13. Секреты, которые нельзя отправлять в чат

| Секрет | Почему нельзя |
|---|---|
| `TELEGRAM_BOT_TOKEN` | управление ботом |
| `GOOGLE_CLIENT_SECRET` | доступ к OAuth-приложению |
| `GOOGLE_REFRESH_TOKEN` | доступ к календарю |
| `DATABASE_URL` с паролем | доступ к базе данных |
| SSH private key | доступ к серверу |
| Пароли аккаунтов | полный риск компрометации |

## 14. Проверка перед запуском

| Проверка | Критерий |
|---|---|
| Все обязательные переменные заполнены | приложение стартует |
| `.env` не в Git | секреты не опубликованы |
| Webhook URL совпадает | Telegram отправляет события |
| Google redirect URI совпадает | OAuth проходит |
| База доступна | миграции выполняются |
| Логи не содержат секреты | безопасно для диагностики |

## 15. Что нужно создать позже автоматически

Когда появится кодовый проект, нужно создать файл `.env.example` на основе этого документа. В нем должны быть только имена переменных и безопасные заглушки.

Файл `.gitignore` должен обязательно содержать:

```gitignore
.env
.env.*
!.env.example
backups/
logs/
*.log
```
