# Инвентаризация рантайм-логики ботов FrogFlow (спецификация для переписывания)

Репозиторий: `/home/user/frogflow`. Один git, один бандл, много деплоев Vercel: N клиентских (`BOT_ID` задан) + один деплой панели оператора (`CONTROL_PLANE=1`). Ветвление поведения — только через переменные окружения + флаги модулей в БД (`bots.modules`) + нишу (`VERTICAL`). Стек: TanStack Start (React 19, Vite, Nitro) + Supabase/Postgres с RLS.

Ключевые файлы-«ядра»:
- `src/lib/bot.server.ts` (321 KB, ~6900 строк) — Telegram-бот магазина.
- `src/lib/zernio-bot.server.ts` (~4900 строк) — Instagram Direct + WhatsApp через Zernio.
- `src/lib/direct-flow.ts` (38 KB) — чистый парсинг реплик Direct (без сайд-эффектов, тестируемый).
- `src/lib/direct-purchase.server.ts` (94 KB) — состояние и действия сценария покупки в Direct.
- `src/lib/vip-bot.server.ts` — второй Telegram-бот (VIP-подписки).
- `src/lib/orders.server.ts` (84 KB) — выдача заказов, письма, ретраи.
- `src/lib/consultant/*`, `src/lib/consultant-universal/*` — ИИ-консультант.
- `src/lib/operator/*`, `src/routes/operator.*` — панель оператора (control plane).

---

## 1. Переменные окружения

Источник: `grep -rn "process.env" src/ scripts/` + `DEPLOYMENT.md`.
«Per-tenant» = своё значение на каждом клиентском деплое Vercel. «Global» = одинаково у всех / платформенное. «Panel» = только на деплое панели.

### 1.1. Идентичность арендатора и ниша

| Переменная | Где читается | Что делает | Скоуп |
|---|---|---|---|
| `BOT_ID` | 53 места: `tenant-router.server.ts:29`, `internal-api.server.ts:19`, `modules.server.ts:16`, `manager-chat.server.ts:11`, `whatsapp.server.ts:27`, `bot.server.ts:2524/5382/5630/5806`, `tenant-storage-key.server.ts`, `direct-purchase.server.ts:40`, `consultant/*`, `products.functions.ts`, `broadcast.*`, `zernio-retry.server.ts:66`, `payment-proof.server.ts`, `receipt-audit.server.ts`, `routes/api/admin/upload.ts` и т.д. | UUID строки клиента в `bots`. Всё в системе фильтруется по нему; префикс ключей в Storage (`<BOT_ID>/…`); аргумент RPC `claim_order_placement`. | **per-tenant (обязателен)** |
| `SUPABASE_TENANT_KEY` | `integrations-supabase/client.server.ts:63` | JWT с `role: tenant_bot` + `bot_id` — именно он включает RLS-изоляцию. **Fail-fast**: если `BOT_ID` задан, а этого нет — приложение падает на старте (иначе шло бы под `service_role` мимо RLS). Выпускается `scripts/mint-tenant-key.mjs` (нужен `SUPABASE_JWT_SECRET`). | **per-tenant (обязателен)** |
| `VERTICAL` | `verticals/vertical.server.ts:11`, `tenant-router.server.ts:30/53`, `diagnostics.server.ts:154` | Ниша деплоя: `digital` (умолчание), `confectionery`, `consultant`, `flowers`, `consultant_universal`. Неизвестное значение молча даёт `digital`. | **per-tenant (опц.)** |
| `CONTROL_PLANE` | 21 место: `control-plane.server.ts:19`, `operator/guard.server.ts:69/90`, `operator-auth.functions.ts:22`, все `routes/api/cron/*`, `routes/api/operator-cron/*`, `routes/api/operator/zernio-webhook.ts`, `modules.functions.ts:29` | `"1"` → это панель оператора: магазин, `/admin`, `/login`, `/mini-app`, `/shop`, клиентские кроны и Robokassa отдают 404. Не задано → клиентский деплой, `/operator` и operator-кроны отдают 404. | **panel-only** |
| `APP_TIMEZONE` | `datetime.ts:3` | Часовой пояс дат (умолчание `Asia/Almaty`). Влияет на даты получения физических заказов. | per-tenant (опц.) |

### 1.2. Supabase

| Переменная | Где | Что делает | Скоуп |
|---|---|---|---|
| `SUPABASE_URL` | `client.server.ts:51`, `client.ts:35`, `auth-middleware.ts:36`, `operator/env-block.server.ts:250` | URL проекта. | global (одна общая БД на всех) |
| `SUPABASE_SERVICE_ROLE_KEY` | `client.server.ts:52` | Отдаётся шлюзу Supabase в заголовке ключа проекта; **роль** берётся из `SUPABASE_TENANT_KEY`. На панели — реальная роль (обход RLS). | global (значение), но на панели работает иначе |
| `SUPABASE_PUBLISHABLE_KEY` | `client.server.ts`, `auth-middleware.ts:37` | anon key в заголовок `apikey`. | global |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | `client.ts:35/37` (`import.meta.env`) | То же для браузера, подставляются **на сборке** — добавили после деплоя → нужен пересбор. | global |
| `SUPABASE_JWT_SECRET` | `operator/env-block.server.ts:40/113`, `scripts/mint-tenant-key.mjs:25` | Подпись tenant-ключей в мастере подключения. | **panel-only** |
| `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN` | `scripts/apply-migration.mjs` | Только скрипты миграций, в рантайме не читаются. | dev-only |

### 1.3. Telegram

| Переменная | Где | Что делает | Скоуп |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | `telegram.server.ts:7`, `mini-app.server.ts:28` (валидация initData), `internal-api.server.ts:268/290/400`, `webhook-ensure.server.ts:343`, `diagnostics.server.ts:129` | Токен основного магазинного бота. | **per-tenant (обязателен)** |
| `TELEGRAM_WEBHOOK_SECRET` | `routes/api/public/telegram/webhook.ts:20`, `webhook-ensure.server.ts:123/335`, `internal-api.server.ts:279` | `secret_token` вебхука. **Fail-closed**: без него вебхук отдаёт 503 и не принимает вообще ничего. | per-tenant |
| `VIP_BOT_TOKEN` | `vip-bot.server.ts:31`, `webhook-ensure.server.ts:344`, `internal-api.server.ts:295` | Токен второго, VIP-бота (модуль `vip`). | per-tenant (опц.) |
| `VIP_BOT_USERNAME` | `vip-bot.server.ts:27` | Юзернейм VIP-бота для ссылок `t.me/...?start=renew`; ведущая `@` отрезается. | per-tenant (опц.) |
| `VIP_TELEGRAM_WEBHOOK_SECRET` | `webhook-ensure.server.ts:337`, `internal-api.server.ts:282`, `routes/api/public/telegram/webhook-vip.ts` | Секрет VIP-вебхука; фолбэк на `TELEGRAM_WEBHOOK_SECRET`. | per-tenant (опц.) |
| `TELEGRAM_API_BASE` | `telegram.server.ts:3`, `orders.server.ts:977` | Свой Bot API server — снимает лимит 50 МБ; при его отсутствии файлы >20 МБ обрабатываются иначе. | per-tenant (опц.) |

### 1.4. Zernio (Instagram/WhatsApp)

| Переменная | Где | Что делает | Скоуп |
|---|---|---|---|
| `ZERNIO_API_KEY` | `zernio.server.ts:30/917/1120`, `direct-purchase.server.ts:788`, `operator/leads-outreach.server.ts:37` | Ключ API Zernio (`sk_…`). | per-tenant (опц.) + panel (свой ключ FrogFlow для лидов) |
| `ZERNIO_BASE_URL` | `zernio.server.ts:60` | База API, умолчание `https://zernio.com/api/v1`. | global (опц.) |
| `ZERNIO_PROFILE_ID` | `zernio.server.ts:413/477/672/1609` | Профиль по умолчанию; используется и для проверки «аккаунт принадлежит этому деплою». | per-tenant |
| `ZERNIO_WEBHOOK_SECRET` | `routes/api/public/zernio/webhook.ts:30`, `routes/api/operator/zernio-webhook.ts:22`, `zernio.server.ts:984/1045` | HMAC-SHA256 подпись вебхука. Без него — 503. | per-tenant + panel |
| `ZERNIO_LOG_RETENTION_DAYS` | `zernio-logs.server.ts:32` | Хранение `zernio_logs` (умолч. 30). | per-tenant (опц.) |
| `ZERNIO_LOG_STALE_RETENTION_DAYS` | `zernio-logs.server.ts:38` | Хранение «зависших» (`error`/`pending`), умолч. 180. | per-tenant (опц.) |

### 1.5. Аутентификация и секреты

| Переменная | Где | Что делает | Скоуп |
|---|---|---|---|
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | `admin.functions.ts:17/18`, `admin-session.server.ts:10` | Вход в клиентскую админку. Без них вход отключён (умолчаний нет намеренно). Хеш пароля пишется в cookie (`passFp`) — смена пароля отзывает сессии. | **per-tenant** |
| `SESSION_SECRET` | `admin-session.server.ts:27/31` | Подпись cookie `admin-session`. Короче 32 символов → вход отключён явной ошибкой. | **per-tenant** |
| `OPERATOR_USERNAME`, `OPERATOR_PASSWORD` | `operator-auth.functions.ts:25/26`, `operator/guard.server.ts:7` | Вход в панель. | **panel-only** |
| `OPERATOR_SESSION_SECRET` | `operator/guard.server.ts:27/31` | Подпись cookie `operator-session` (отдельной от admin). <32 символов → вход отключён, подпись идёт случайным per-process секретом. | **panel-only** |
| `OPERATOR_TELEGRAM_USERNAME` | `modules/module-requests.functions.ts:56` | Куда ведёт кнопка «Заказать подключение» из `/admin/modules`. | per-tenant (опц.) |
| `CRON_SECRET` | `cron-auth.server.ts:17` | Общая проверка для всех `/api/cron/*`, `/api/operator-cron/*` и VIP-крона. Принимается и как `Authorization: Bearer`, и как `?secret=` (для внешнего cron-job.org). `timingSafeEqual`. | per-tenant + panel |
| `PUBLIC_APP_URL` | `app-origin.server.ts:20`, `legal/$slug.ts:166` | Публичный адрес деплоя: webhook, ссылки покупателю, колбэки Robokassa, ссылки на оферту. **Фолбэка на чужой домен нет намеренно.** | **per-tenant (обязателен)** |
| `VERCEL_PROJECT_PRODUCTION_URL`, `VERCEL_URL` | `app-origin.server.ts:21/24` | Автофолбэк адреса от платформы. | авто |
| `VERCEL_GIT_COMMIT_SHA`, `VERCEL_GIT_COMMIT_REF`, `VERCEL_ENV` | `internal-api.server.ts:387-389` | Показываются в `/api/internal/health` (что за версия крутится). | авто |

### 1.6. ИИ и внешние сервисы

| Переменная | Где | Что делает | Скоуп |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | `consultant/config.ts:12`, `consultant-universal/claude.ts:15`, `smart-search.server.ts:80/209`, `settings.functions.ts:29`, `operator/leads-ai.server.ts:14`, `operator/leads-hunt.server.ts:27` | Claude API: консультант, «Умный поиск» (`smart_search`), оценка/черновики лидов в панели. | per-tenant + panel |
| `CONSULTANT_MODEL` | `consultant/config.ts:8`, `consultant-universal/claude.ts:11` | Модель; умолчание обоих — `claude-haiku-4-5-20251001`. | per-tenant (опц.) |
| `GOOGLE_VISION_API_KEY` | `receipt-verify.server.ts:567/585`, `receipt-audit.server.ts:50`, `diagnostics.server.ts:258/435` | OCR чеков (модуль `receipt_ocr`). Тариф клиенту — $2/1000 чеков, расход копится в `ai-usage`. | per-tenant (опц.) |
| `CONSULTANT_RATE_SOURCE` | `consultant/vtb.ts:114` | `finkaz` (умолч.) или `vtb`. | per-tenant (ниша consultant) |
| `CONSULTANT_RATE_URL` | `consultant/vtb.ts:118` | Страница банка на finkaz.kz (умолч. Kaspi). Смена банка = смена URL, не кода. | per-tenant |
| `CONSULTANT_VTB_RATE_URL` | `consultant/vtb.ts:205` | Прямой URL ВТБ при `RATE_SOURCE=vtb`. | per-tenant |
| `CONSULTANT_VTB_RELAY_URL` | `consultant/vtb.ts:223` | Ретранслятор внутри Казахстана (ВТБ обрывает соединения извне КЗ). | per-tenant |
| `TAVILY_API_KEY` / `BRAVE_SEARCH_API_KEY` / `SERPER_API_KEY` | `operator/leads-hunt.server.ts:20-22, 31/58/80` | Поиск лидов; выбирается первый заданный, иначе фолбэк DuckDuckGo. | **panel-only** |
| `SALES_WHATSAPP_TEMPLATE`, `SALES_WHATSAPP_TEMPLATE_LANG` | `operator/leads.server.ts:797/807` | Имя/язык одобренного Meta-шаблона для холодного WhatsApp-аутрича. | **panel-only** |

### 1.7. Почта (nodemailer)

`SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` (все три обязательны, иначе `isMailConfigured()` = false), `SMTP_PORT` (умолч. 465 = TLS сразу; 587 = STARTTLS), `SMTP_FROM` (умолч. = `SMTP_USER`). Файл `src/lib/mail.server.ts`. **Критично для Instagram Direct**: Direct не принимает документы вложением и имеет окно 24 часа, поэтому материалы по заказам из Direct отдаются письмом с подписанными ссылками. Скоуп: **per-tenant**.

### 1.8. Тюнинг выдачи и ретеншна

`DELIVERY_BATCH_SIZE` (`orders.server.ts:24`, умолч. 8, клампится 1–20) — файлов в порции выдачи. `DELIVERY_MAX_FILE_MB` (`orders.server.ts:29`, умолч. 100, клампится 1–200). `MANAGER_CHAT_RETENTION_DAYS` (`manager-chat-prune.server.ts:19`, умолч. 90). Через `misc-retention.server.ts:20`: `ADMIN_LOGIN_ATTEMPTS_RETENTION_DAYS` (90), `BROADCAST_RECIPIENTS_RETENTION_DAYS` (90), `BOT_EVENTS_RETENTION_DAYS` (180), `OPERATOR_LOGIN_ATTEMPTS_RETENTION_DAYS` (90). Все per-tenant/опц., клампятся 1–365.

### 1.9. Что НЕ в env

Осознанно в БД, а не в переменных: токены ботов на панели (панель их не хранит — см. §9), `bots.internal_secret`, настройки Robokassa (`app_settings.robokassa_*`), `admin_chat_id` (список Telegram ID получателей уведомлений), `admin_contact_link`, флаги модулей (`bots.modules` jsonb), пороги напоминаний (`cart_reminder_hours`), `delivery_lang_timing`, `loyalty_earn_percent`, `referral_discount_percent`.

---

## 2. Telegram-бот (`bot.server.ts`)

Вход: `handleUpdate(update)` (строка 4540) → `handleCallbackQuery` (4556) или `handleIncomingMessage` (5317).

### 2.1. Сквозные гварды (выполняются до всего)

1. `replyIfBlocked(chat_id, from_id)` — модуль `blocked`, таблица `blocked_users`.
2. `handleManagerChatCallback` / логирование реплики в `manager_chat_messages` + `manager_chat_state` (модуль `manager_chat`); при «перехвате оператором» бот молчит на текст, но **не** на callback-кнопки (иначе оформление заказа молча ломалось).
3. `replyIfPaused(chat_id)` — `bots.status <> 'active'` (приостановка за неоплату) → вежливый текст, вебхук не трогается.
4. `upsertUser(from)` → `bot_users`.
5. Для ниши `consultant`: любой текст кроме `/id` уходит в консультанта (`bot.server.ts:5408`).
6. Перед навигационными callback'ами (кроме `setcountry:/confirm:/reject:/pay:/clear/rem:/add:/lang_/locale:/searchmore:/prod:`) требуется `state.country_code`, иначе показывается выбор страны.

### 2.2. Главное меню (reply-клавиатура, `mainMenu()` стр. 1436)

Тексты локализованы на 4 языка (ru/kk/en/uz), нормализуются в канонические через `canonicalMenuAction()` (1473). Раскладка:
```
[🛍 Магазин (web_app, только если модули telegram_mini_app + shop)]
[📚 Каталог]      [🔍 Поиск]
[🛒 Корзина]      [📋 Мои заказы]
[📖 Инструкция]   [ℹ️ Информация]
[💬 Связаться с автором]   ← текст из VerticalDef.locales[locale].contactBtn
```

### 2.3. Пронумерованный список пользовательских флоу

1. **`/start` и deep-links** (5437). Payload-ветки:
   - `ref_<telegram_id>` → `registerReferral()` (модуль `referral`) — приглашённый получает одноразовый промокод сразу.
   - `wc_<token>` (`WEB_CART_HANDOFF_START_PREFIX`) → `claimWebCartHandoff()` — перенос корзины с веб-витрины в `cart_items`; ставит `state.web_handoff_pending_checkout`.
   - `p_<productId>` → `state.pending_start_product_id`, карточка товара показывается после выбора языка.
   - Голый `/start`: если `app_settings.admin_chat_id` пуст — предложение привязать админа. Далее: модуль `multi_language` → `askLanguage()` (inline `locale:<code>`), иначе сразу `applyLocaleSelection(..., "ru")`.
   - Таблицы: `bot_users`, `app_settings`, `promo_codes` (реферальный код), `cart_items`, `web_cart_handoff` (MIGRATION-56), `bots`.
2. **`/id`** (5502) — сообщает свой Telegram ID (нужно для настройки `admin_chat_id`).
3. **Выбор языка** — callback `locale:<ru|kk|en|uz>`; приветствие `welcomeStartHtml()` (276) собирается из `VerticalDef.locales[...]` + оферта/политика (`legalConsentHtml`). Пишет `bot_users.state.locale`.
4. **Выбор страны** — `askCountry()` (2439). Читает `payment_methods` (активные, по `sort_order`). Callback `setcountry:<CC>` (навигационный) / `country:<CC>` (внутри чекаута). Определяет валюту, платёжные реквизиты и доступность Robokassa. Таблицы: `payment_methods`, `bot_users`.
5. **Каталог** — `showCategories()` (1694), callback `cat:root`, `cat:<categoryId>:<offset>`. Дерево категорий (`category-tree.ts`), пагинация. Таблицы: `categories`, `products`, `product_images`.
6. **Карточка товара** — `showProduct()`/`sendProductCard()` (1805/1899), callback `prod:<id>`. Показывает цену (с учётом `product_variants` — «от …», конвертация по стране через `pricing.server.ts`), фото, рейтинг (`formatRatingSummary`), языковые бейджи материалов, остаток (модуль `stock`). Кнопка `add:<productId>` или `add:<productId>:<variantId>`.
7. **Поиск** — `showSearch()` (4343), режим `state.mode = "search"`, пагинация `searchmore:<offset>`. Если обычный поиск пуст и включён модуль `smart_search` — LLM-фолбэк (`smart-search.server.ts`, Anthropic, дневной лимит + cooldown, расход пишется в `ai_usage`).
8. **Корзина** — `showCart()` (2282) / callback `cart:show`. Кнопки: `rem:<cartItemId>` (удалить строку; уменьшать количество бот не умеет), `clear` (очистить), `promo:enter` / `promo:clear`, `giftcert:enter` / `giftcert:clear`, `points:use` / `points:clear`, `checkout`. Таблицы: `cart_items`, `products`, `product_variants`.
   - `addToCart()` (2102) возвращает: `ok` | `mixed_cart` (запрет смешивать цифровые и физические) | `digital_limit` | `out_of_stock`.
9. **Промокоды** (модуль `coupons`) — `state.mode = "awaiting_promo_code"`; `findValidPromoCode()` (2771) проверяет без списания (`not_found`/`inactive`/`expired`/`exhausted`), `redeemPromoCode()` (2805) списывает `used_count` CAS'ом уже при оформлении. Типы: процент / фиксированная сумма. Таблица `promo_codes`.
10. **Подарочные сертификаты** (модуль `gift_certificates`) — `state.mode = "awaiting_gift_certificate_code"`; `findValidGiftCertificate()` (2834) / `redeemGiftCertificate()` (2853). Скидка на всю сумму номинала. Таблица `gift_certificates`.
11. **Баллы лояльности** (модуль `loyalty`) — переключатель `state.use_points`; начисление `loyalty_earn_percent` (умолч. 5%) после фактической выдачи, идемпотентно через `orders.points_earned` (CAS 0→N); списание — CAS по `bot_users.loyalty_points`. `loyalty.server.ts`.
12. **Рефералка** (модуль `referral`) — ссылка `t.me/<bot>?start=ref_<id>` из «ℹ️ Информация». Награда обеим сторонам одноразовыми промокодами: приглашённому при первом `/start`, пригласившему — после первой выданной покупки приглашённого. `referrals.server.ts`.
13. **Чекаут** — см. §2.4.
14. **Выбор способа оплаты** — callback `pay:rk:<orderId>` / `pay:manual:<orderId>`; `sendKzPaymentChoice()` (3863) показывает обе кнопки.
15. **Robokassa** — `sendRobokassaPayLink()` (3965) строит URL через `buildRobokassaPaymentUrl()` (`robokassa.server.ts`). Настройки из `app_settings`: `robokassa_enabled`, `robokassa_test_mode`, `robokassa_login`, `robokassa_pass1`/`robokassa_pass1_test` — плюс гард `hasModule("robokassa")` (`loadRobokassaSettings()` 3950).
16. **Ручная оплата с чеком** — `startManualProofPath()` (4012): текст реквизитов из `payment_methods.instructions` + QR-картинка из `payment_methods.qr_code_path` (одним сообщением, если текст ≤1024 символов, иначе фото отдельно). `state.mode = "awaiting_proof"`, `state.proof_auto` (автовыдача в RU/KZ при включённом OCR).
17. **Приём чека** — фото/документ в режиме `awaiting_proof` → загрузка в Storage `payment-proofs/<BOT_ID>/order-<id>/…`, хеш чека (MIGRATION-36, защита от повторной отправки того же чека), опционально OCR через Google Vision (`receipt-verify.server.ts`), затем `notifyAdminNewOrder()` и/или автовыдача.
18. **Подтверждение/отклонение продавцом** — callbacks `confirm:<orderId>` / `reject:<orderId>`. Защита `requireShopAdmin(from_id, chat_id)` (3921): нажать может только ID из `admin_chat_id`; при пустом списке — никто. Для физических — `acceptOrder()`, для цифровых — `deliverOrder()`/`deliverInstagramOrder()`.
19. **Выбор языка материалов после оплаты** — callbacks `checkoutlang:<locale>` / `checkoutlang:all` (до заказа, при `delivery_lang_timing = "before"`) и `lang_<locale>:<orderId>:<itemIndex>` (после выдачи). Проверяет принадлежность заказа нажавшему, отслеживает уже выданные языки через `order_items.delivered_language` (MIGRATION-37).
20. **Мои заказы** — `showMyOrders()` (4478), последние 20 из `orders`. Статусы переводятся: `awaiting_payment`, `awaiting_confirmation`, `delivering`, `delivered`, `rejected`, `accepted`, `in_production`, `ready`. Кнопки на выданных: `resend:<orderId>` (только для цифровых) и `rate:<orderId>` (модуль `review_request`).
21. **Повторная выдача файлов** — `resendOrderFiles(orderId, from_id)` в `orders.server.ts`.
22. **Отзывы** (модуль `review_request`) — `rate:<orderId>` → выбор товара `rateproduct:<productId>` → звёзды `stars:<productId>:<1..5>` → `state.mode = "awaiting_review_comment"` (или `reviewskip`). Проверка `hasDeliveredPurchase()`. Таблицы: `product_reviews` (MIGRATION-43), агрегаты `products.rating_avg/rating_count`.
23. **Инструкция** — `sendInstruction()` (1585): видео из Storage-бакета `instruction-videos` + подпись из `app_settings.instruction_caption`, фолбэк — тексты из `VerticalDef.locales[...].instructionComingSoon/instructionDefaultCaption`.
24. **Информация** (6298) — inline-кнопки на `/legal/offer`, `/legal/privacy`, `/legal/requisites`, `/legal/about` + «Пригласить друга» (`?start=ref_<id>`, если модуль `referral`).
25. **Связаться с автором** — ссылка из `app_settings.admin_contact_link`.
26. **Напоминание об оплате** — `remindOrderPayment(orderId)` (3746), вызывается из админки; только для `status = awaiting_payment`; повторно показывает выбор оплаты/реквизиты/ссылку RK.
27. **Напоминание о брошенной корзине** (модуль `cart_reminder`) — крон `/api/cron/cart-reminder`, `cart-reminder.server.ts`: порог `app_settings.cart_reminder_hours` (умолч. 6), «активность корзины» = MAX(`cart_items.created_at`), идемпотентность через `bot_users.cart_reminder_sent_at` (MIGRATION-44). Кнопка «🛒 Открыть корзину».
28. **Напоминание о дате получения** (физические ниши) — крон `/api/cron/fulfillment-reminder`, за сутки до `orders.fulfillment_at`, и покупателю (через канало-независимый `notifyOrderCustomer`), и продавцу (Telegram, `admin_chat_id`). CAS на `orders.fulfillment_reminder_sent_at` (MIGRATION-51).
29. **Рассылки** (модуль `broadcasts`) — создаются в админке, `broadcast.server.ts` + крон `/api/cron/broadcast` порциями по 25. Аудитории: все `bot_users` платформы telegram / покупатели (по `orders`) / по языку в `state`. Поддержка фото (`broadcast-images`), inline-кнопок на товары и «каталог». Классификация ошибок → `blocked` / `failed`. Таблицы: `broadcasts`, `broadcast_recipients`, `bot_users`, `orders`, `products`.
30. **Mini App** — см. §5.
31. **Чат с менеджером** (модуль `manager_chat`) — все реплики покупателя и ответы бота логируются в `manager_chat_messages`; `manager_chat_state` держит превью/время/`unread_count` (через RPC `manager_chat_touch`). Оператор из админки может «перехватить» диалог — тогда бот молчит на свободный текст.
32. **VIP-подписки** (модуль `vip`, второй бот) — см. §2.6.

### 2.4. Машина состояний чекаута

Состояние — `bot_users.state` (jsonb). Типизированный набор `mode` (`bot.server.ts:93-186`):
`idle | search | awaiting_contact | awaiting_payment | awaiting_proof | choose_pay | awaiting_promo_code | awaiting_review_comment | awaiting_gift_certificate_code | awaiting_fulfillment_type | awaiting_fulfillment_date | awaiting_delivery_zone | awaiting_address | awaiting_fulfillment_note | awaiting_delivery_lang`.

Сопутствующие одноразовые поля: `use_points`, `review_product_id`, `gift_certificate_code`, `pending_order_id`, `pending_display_no` (замороженный номер, MIGRATION-28), `country_code`/`country_name`, `last_search`, `locale`, `proof_auto`, `placing_order`, `checkout_lang_choice`, `promo_code`, `checkout_fulfillment_type`, `checkout_fulfillment_at`, `checkout_min_fulfillment_date`, `checkout_delivery_zone_id/name/fee`, `checkout_fulfillment_address`, `checkout_fulfillment_note`, `web_handoff_pending_checkout`, `pending_start_product_id`.

**Последовательность шагов** (`startCheckout` 2391):

```
[Корзина] → "Оформить" (callback "checkout")
   ↓
0. startCheckout: корзина пуста? → выход
   ↓
1. Нет contact_phone? → mode=awaiting_contact
      reply-клавиатура с request_contact; принимается и msg.contact, и текст
      (normalizePhone 1930). saveContactAndContinueCheckout (1947) →
      пишет bot_users.contact_phone, продолжает.
   ↓
2. Нет state.country_code? → askCountry(forCheckout=true)
      inline "country:<CC>" из payment_methods
   ↓
3. proceedToFulfillmentOrPlace (2580)
      Сбрасывает checkout_fulfillment_type / delivery_zone_* от прошлого прохода.
      cartFulfillmentKind(telegram_id) != "physical"  →  шаг 7
   ↓
4. mode=awaiting_fulfillment_type  (только если включены ОБА: самовывоз и доставка)
      inline "fulfilltype:pickup" / "fulfilltype:delivery"
      + текстовый фолбэк. Если продавец оставил один вариант — шаг пропускается.
   ↓
5. mode=awaiting_fulfillment_date  (askFulfillmentDate 2641)
      Минимальная дата = сегодня(APP_TIMEZONE) + maxLeadTimeDaysInCart
      (максимальный срок изготовления среди товаров корзины).
      Значение замораживается в state.checkout_min_fulfillment_date, чтобы
      правка срока продавцом между вопросом и ответом не отклонила дату.
      Ответ — текст (ISO/дата), не кнопка.
   ↓
6a. delivery → proceedToDeliveryZoneOrAddress (2668)
       Есть активные delivery_zones?
         да  → mode=awaiting_delivery_zone, inline "zone:<id>" с ценой зоны
               (resolveDeliveryZoneFee — конвертация в валюту страны покупателя)
         нет → шаг пропускается целиком
       → mode=awaiting_address (свободный текст)
6b. pickup → сразу к примечанию
   ↓
6c. mode=awaiting_fulfillment_note  (свободный текст либо inline "fulfillnote:skip")
   ↓
7. proceedToLanguageOrPlace (2546)
      shouldAskDeliveryLangBeforeOrder(): модуль multi_language И
      app_settings.delivery_lang_timing == "before"
      И deliveryLangChoicesForCart() > 1 языка
        → mode=awaiting_delivery_lang, inline "checkoutlang:<locale>" + "checkoutlang:all"
          (множитель цены ×N языков — deliveryPriceMultiplier)
      иначе → placeOrder
   ↓
8. placeOrder (2948)
      claimOrderPlacement(telegram_id) — АТОМАРНЫЙ захват через RPC
      claim_order_placement(p_bot_id, p_telegram_id) (MIGRATION-27).
      Двойной тап не создаёт второй заказ. try/catch + releaseOrderPlacement.
   ↓
9. placeOrderInner (3073)
      - снимает из state и применяет: checkout_lang_choice, promo_code,
        use_points (каждое — под соответствующим hasModule)
      - redeemPromoCode / redeemGiftCertificate / списание баллов
      - rollbackCheckoutRedemptions (2877) при сбое
      - вставка orders + order_items, номер через order_counters (MIGRATION-03),
        display_no заморожен (MIGRATION-28)
      - списание stock_quantity атомарно (модуль stock)
      - delivery_fee отдельной колонкой (в order_items строки "Доставка" нет —
        известная асимметрия, п. 4.3 в комментариях кода)
   ↓
10. Выбор пути оплаты (зависит от страны и настроек):
      Robokassa готова И страна её допускает И ручная оплата тоже настроена
        → sendKzPaymentChoice: mode=choose_pay, кнопки pay:rk / pay:manual
      только Robokassa
        → sendRobokassaPayLink: mode=awaiting_payment
      только реквизиты
        → startManualProofPath: mode=awaiting_proof (+ proof_auto)
      физический + payment_mode=on_receipt
        → заказ сразу accepted, оплата при получении
   ↓
11. mode=awaiting_proof → приём фото/документа → Storage payment-proofs,
    хеш чека, опц. OCR (Google Vision) → notifyAdminNewOrder
   ↓
12. Продавец: confirm:<id> → deliverOrder (цифровой) / acceptOrder (физический)
                reject:<id>  → status=rejected
   ↓
13. Выдача: sendMaterials порциями DELIVERY_BATCH_SIZE, при multi_language —
    inline lang_<locale>:<orderId>:<idx>; announceAndCloseDeliveredOrder →
    status=delivered, начисление баллов, предложение оценить.
```

**Статусы заказа.** Цифровой: `awaiting_payment` → `awaiting_confirmation` → `delivering` → `delivered` | `rejected`. Физический (`fulfillment.server.ts:87`): `PHYSICAL_STATUSES = ["accepted", "in_production", "ready"]`, `NEXT_STATUS`: `accepted→in_production→ready→delivered`; откат возможен на шаг назад кроме `delivered` (с ним связаны баллы). Плюс `cancelled`/`refunded` (`receipt-audit.ts:26`).

### 2.5. Таблицы, которых касается Telegram-бот

Из `bot.server.ts` напрямую: `orders` (29 обращений), `bot_users` (28), `cart_items` (20), `app_settings` (8), `payment_methods` (7), `products` (6), `promo_codes` (5), `gift_certificates` (5), `categories` (5), `subscription_invoices` (3), `product_variants` (2), `order_items` (2), `product_images`, `delivery_zones`, `bots`. Storage-бакеты: `payment-proofs`, `instruction-videos`, `product-images`, `product-files`, `broadcast-images`, `instagram-media`.

Косвенно через модули: `product_material_files`, `product_reviews`, `blocked_users`, `manager_chat_messages`, `manager_chat_state`, `broadcasts`, `broadcast_recipients`, `order_counters`, `bot_events`, `ai_usage`, `web_cart_handoff`, `module_requests`, `vip_subscriptions`, `vip_tariffs`, `vip_member_profiles`.

### 2.6. VIP-бот (`vip-bot.server.ts`, отдельный токен)

Вебхук `/api/public/telegram/webhook-vip`. Гварды: `hasModule("vip")` и `botStatus() === "active"` — иначе 200 и молчание (чтобы Telegram не копил очередь).

Команды/кнопки: `/start` (+ payload `t_<tariffId>` — deep-link на тариф, `renew`), `/language` (кнопка «Язык»), `/id`, `/renew`, `/status`, `/help`.
Callbacks: `vip_locale:<locale>`, `buy_tariff:<tariffId>`, `buy_renew`, `buy_renew_public`, `vip_confirm:<subId>` / `vip_reject:<subId>` (только для админа — `requireVipAdmin` 1299).
Флоу: показ тарифов → реквизиты → фото чека (`handlePhoto` 1163, Storage `payment-proofs/<BOT_ID>/vip-<subId>/…`) → подтверждение админом → инвайт в закрытую Telegram-группу.
Крон `/api/public/vip/cron` (`vip-cron.server.ts`): два окна предупреждений об истечении, по истечении — исключение из группы (`revokeVipInvite`, `isVipGroupMember`); запись статуса до отправки уведомления (иначе повторные уведомления вечно). Плюс `ensureDidWebhooks()` — восстановление вебхуков shop+VIP.
Таблицы: `vip_subscriptions`, `vip_tariffs`, `vip_member_profiles`, `app_settings`.

---

## 3. Zernio-бот: Instagram Direct + WhatsApp

Один эндпоинт и один обработчик обслуживают обе платформы: `handleZernioMessage(payload)` (`zernio-bot.server.ts:1330`). Платформа определяется через `zernioAccountPlatform(accountId)` (она же подтверждает, что аккаунт принадлежит профилю этого деплоя), подсказка `account.platform` из тела — не источник истины.

### 3.1. Что такое «direct flow»

**Direct flow** — это отдельная машина состояний сценария покупки в мессенджере без кнопочного меню. Два файла:
- `src/lib/direct-flow.ts` — **чистые функции разбора текста**, без побочных эффектов, чтобы покрываться тестами: `extractProductNumber` («018», «18», «№18», «18.» → `18`), `productNumberFromName`, `productNumberFromKeywords`, `parseRemoveCommand`, `pickCartLineToRemove`, `matchLocalePick`, `matchDeliveryLangChoice`, `isLocalePickEcho` (повтор «1»/«русский» в окне 2 мин — эхо выбора языка, а не код товара 001), `matchCountry`, `matchFulfillmentType`, `matchZone`, `pickReceiptAttachment`/`pickExpectedReceiptAttachment`, `extractEmail`, `isAffirmative`, `matchLoyaltyPointsChoice`, `isDismissal`, `isCancel`, `matchDirectCommand`, `isPaymentComplaint`, `classifyIncoming`.
- `src/lib/direct-purchase.server.ts` — **состояние и действия**: `DirectState` в `bot_users.state` строки, заведённой под Instagram/WhatsApp (`user_key`), `setDirectState` (патч, не перезапись — иначе каждый шаг стирал бы `greeted_at`/`notified_at`), `clearDirectFlow`/`restartDirectFlow` (чистят только `FLOW_KEYS`, страну и язык оставляют — страна не меняется от заказа к заказу), атомарные захваты `claimAwaitingProof` / `claimWhatsAppStartPrompt`, `sendDirectReply` (с дедупликацией по `fingerprint` последнего ответа), `handleStepMiss` (после `MAX_STEP_MISSES = 2` промахов подряд бот замолкает и зовёт продавца).

Ключевое отличие от Telegram: **заказ создаётся не по кнопке «Оформить», а в реакции на уже присланный чек** (`createOrderFromCart` вызывается из `handleAwaitingProof`). Поэтому все данные о получении (тип, дата, зона, адрес, примечание, язык материалов, баллы) собираются ДО показа реквизитов, а сумма замораживается в `state.frozen_cart` (иначе между показом суммы и чеком курс/цена могли поменяться, и OCR пометил бы честный платёж как расхождение).

### 3.2. Состояния (`DirectMode`, `direct-flow.ts:55`)

```
null (свободный разговор)
awaiting_locale            ← самый первый шаг: в Direct нет /start, точку выбора языка заводим сами
awaiting_country
awaiting_fulfillment_type  ┐
awaiting_fulfillment_date  │ чекаут физического заказа (Блок 8.3),
awaiting_delivery_zone     │ вставлен между страной и чеком
awaiting_address           │
awaiting_fulfillment_note  ┘
awaiting_variant_choice    ← товар с >3 вариантами: Zernio даёт максимум 3 кнопки на сообщение,
                             поэтому шлём нумерованный список текстом
awaiting_delivery_lang     ← язык файлов (RU/KZ/оба) при delivery_lang_timing="before"
awaiting_loyalty_points    ← «списать баллы? да/нет» отдельным вопросом (в корзине нет места под 4-ю кнопку)
awaiting_email_before_proof
awaiting_proof             ← ждём чек
processing_proof           ← техническое: чек взят в обработку (lock 45 с, самоочищается)
awaiting_email             ← почта для отправки материалов (Direct не принимает документы)
```

### 3.3. Порядок обработки входящего события (1330–2060)

1. `deliverPendingTwoStepDm` — отложенный DM по комментарию (Instagram two-step).
2. Определение платформы; префикс настроек `SETTINGS_PREFIX[platform]` в `app_settings` (`instagram_*` / `whatsapp_*`): `enabled`, `scope`, `triggers`, `ignore_excluded_contacts`.
3. `resolveTenant({ accountId, username })` — см. §4.4.
4. Ниша `consultant`/`consultant_universal` → уходит в консультанта (§8), минуя весь магазинный сценарий.
5. Гард модуля: `dm_shop` для Instagram, `wa_shop` для WhatsApp.
6. `upsertZernioUser` → `bot_users` (`user_key`, синтетический `telegram_id` из `zernioCustomerId(userKey)` — чтобы переиспользовать общие с Telegram таблицы `cart_items`/`orders`).
7. **WhatsApp-активация** (`whatsapp-activation.ts`): `isZernioStartIntent(text, postbackPayload, triggerWords)`; действия `start` / `prompt` (разовая подсказка про `/start`, под атомарным `claimWhatsAppStartPrompt`) / `wait`.
8. Postback-кнопки (у кого есть): `BUY:<productId>[:<variantId>]`, `CART`, `CHECKOUT`, `CATALOG`, `PROD:<id>`, уровни каталога (`parseCatalogPayload`), `COUNTRY:<CC>`, `fulfilltype:pickup|delivery`, `fulfillnote:skip`, `zone:<id>`, `deliverylang:<choice>`, шаги с префиксом `STEP_`, ответ по баллам.
9. `handlePurchaseFlow()` (3519) — если диалог в каком-то `mode`, событие обрабатывается им (с проверками `isCancel`, `isPaymentComplaint`, `isLocalePickEcho`).
10. Иначе — `matchDirectCommand(text)`: `catalog | cart | checkout | orders | language | country`. Словари на 4 языках (ru/kk/en/uz), десятки синонимов каждый (`direct-flow.ts:657-780`).
11. Слова-триггеры продавца (`app_settings.<platform>_triggers`) → показ каталога.
12. `scope != "all"` → бот молчит на всё, что не относится к покупке.
13. Поиск: `^(поиск|найти|найди)\s+(.{2,})$` (модуль поиска).
14. Иначе — обычный вопрос: один раз зовём продавца (`notifyAdminAboutQuestion`, троттлинг через `notified_at`), здороваемся не чаще раза (`greeted_at`).

### 3.4. Отличия от Telegram

| | Telegram | Zernio (IG/WA) |
|---|---|---|
| Интерфейс | reply-клавиатура + inline-кнопки без лимита | ≤3 кнопки на сообщение; в WhatsApp дополнительно списки (`whatsappList`, `rowSubtitle`) |
| Каталог списком | есть | только WhatsApp (`sendWhatsAppCatalogLevel`); в Instagram — по номерам товаров |
| Точка входа | `/start` | `/start`-эквивалента нет: `awaiting_locale` заводится искусственно; в WhatsApp — механика активации через trigger-words |
| Выбор товара | кнопка | **номер товара** из подписи к посту («018»), `extractProductNumber` |
| Создание заказа | по кнопке «Оформить» | по факту присланного чека (`createOrderFromCart` из `handleAwaitingProof`) |
| Телефон | спрашивается (`awaiting_contact`) | **не спрашивается**; `orders.contact` = хендл Instagram (известная недоработка 4.17) |
| Промокоды / сертификаты | есть | **не поддержаны** (`priceCart` их не знает — 4.16) |
| Баллы | кнопка в корзине | отдельный вопрос «да/нет» (`awaiting_loyalty_points`) |
| Складской учёт | `addToCart` проверяет `stock_quantity` | **не проверяется вообще** (4.12) |
| Выдача файлов | файлом в чат | **письмом** (`sendOrderMaterialsEmail`, SMTP) — Direct не принимает документы, WhatsApp принимает до 100 МБ |
| Окно ответа | нет | Instagram/WhatsApp — 24 часа; вне окна WhatsApp только одобренные Meta шаблоны (`whatsapp.server.ts`, `whatsapp_templates`, MIGRATION-29/30) |
| Уменьшение количества | нет | нет (4.15, общая недоработка) |
| «Отмена»/«назад» | только переход по кнопке меню | `isCancel()` понимает слово «отмена» |
| Дедупликация | Telegram сам | `zernio_logs` с уникальным индексом на `event_id` (at-least-once, 7 попыток у Zernio) |
| Идемпотентность отправки | — | `runWithZernioEvent(eventId)` → `Idempotency-Key` в исходящих |

Дополнительно в Zernio-ветке: `handleZernioAccountDisconnected` (3419) — уведомление о отвалившемся аккаунте; `handleWhatsAppTemplateStatus` — вердикт ревью Meta; `handleZernioCommentTwoStep` — comment→DM; `comment-dm-fallback.server.ts` — резервная отправка DM по комментариям с трёхуровневой эскалацией (inbox-сообщение → публичный ответ → Telegram продавцу; MIGRATION-62/64/65/66); `notifyAdminAboutNativeCart` — покупатель оформил заказ штатной корзиной Instagram, минуя бота; `notifyAdminAboutComplaint` — срочный вызов человека при жалобе на оплату.

Таблицы Zernio-ветки: `orders` (16), `bot_users` (15), `products` (11), `app_settings` (11), `cart_items` (9), `zernio_logs` (5), `product_variants` (3), `payment_methods` (2), `categories` (2), `order_items`. Плюс `instagram_*`/`whatsapp_templates`/`whatsapp_broadcasts`, `comment_dm_fallback_sends`.

---

## 4. Веб-эндпоинты (`src/routes/api/*` и корневые роуты)

### 4.1. Вебхуки

| Путь | Метод | Аутентификация | Что делает |
|---|---|---|---|
| `/api/public/telegram/webhook` | POST | Заголовок `x-telegram-bot-api-secret-token` vs `TELEGRAM_WEBHOOK_SECRET`, `timingSafeSecretEqual`. **Fail-closed**: секрет не задан → 503; не совпал → 403 | `handleUpdate()`. «Медленные» апдейты (`confirm:`/`reject:`, фото/документ) уходят в `waitUntil()`, Telegram получает 200 сразу — иначе повтор апдейта создавал второй заказ |
| `/api/public/telegram/webhook-vip` | POST | `verifyTelegramWebhookSecret(request, ["VIP_TELEGRAM_WEBHOOK_SECRET","TELEGRAM_WEBHOOK_SECRET"])` → 401 | Гварды `hasModule("vip")` и `botStatus()==="active"` (отвечают 200, не ошибкой) → `handleVipUpdate()` |
| `/api/public/zernio/webhook` | POST | HMAC-SHA256 сырого тела, заголовок `x-zernio-signature` или `x-late-signature`, секрет `ZERNIO_WEBHOOK_SECRET`, `timingSafeEqual`. Нет секрета → 503, не совпало → 401 | Проверка принадлежности аккаунта профилю, гарды модулей/паузы, **дедупликация вставкой в `zernio_logs`** (код 23505 → «already processed», 200), затем по типу события: `message.received` → `handleZernioMessage`; `comment.received` → `handleZernioCommentTwoStep`; `account.disconnected` → `handleZernioAccountDisconnected`; `whatsapp.template.status_updated` → `handleWhatsAppTemplateStatus`. Консультант обрабатывается **синхронно** (Vercel гасит изолят после 200 и «здравствуйте» ждало бы крона), магазин — в `waitUntil` |
| `/api/operator/zernio-webhook` | POST | `CONTROL_PLANE !== "1"` → 404; та же HMAC-проверка | Входящие WhatsApp/Instagram **лидов FrogFlow**: `ingestLeadInbound(payload)` → сопоставление с `sales_leads`, статус «Ответил». Арендатора тут нет |
| `/api/public/telegram/ensure-webhook` | GET | `isVipCronAuthorized` (тот же `CRON_SECRET`) | `ensureDidWebhooks()` — только восстановление вебхуков shop+VIP |

### 4.2. Платёжные колбэки Robokassa

| Путь | Аутентификация | Что делает |
|---|---|---|
| `/api/public/robokassa/result` (GET+POST) | Подпись `SignatureValue` + `pass2`/`pass2_test` — пароль выбирается **только** по `app_settings.robokassa_test_mode`, а не по полю `IsTest` из запроса (иначе подделка тестовым паролем на проде). 404 на панели | Проверки: `robokassa_enabled`, совпадение суммы с `amountDueNow()` (для физических с `payment_mode=deposit` это задаток, а не total; `Number.isFinite` — защита от NaN), статус ∈ {`awaiting_payment`,`awaiting_confirmation`}. **Факт оплаты пишется ДО выдачи** (`payment_proof_path="robokassa"`, дописывается `admin_note`, не затирается). Затем: физический → `acceptOrder` + `recordPayment` (с защитой `alreadyAccepted` от повторного колбэка); `platform="instagram"` → `deliverInstagramOrder`; иначе `deliverOrder`. Ответ `OK<InvId>` |
| `/api/public/robokassa/success` | нет | HTML-страница «оплата прошла» + редирект в бота (`getCachedBotUrl`) через 1.5–2 с |
| `/api/public/robokassa/fail` | нет | HTML-страница «оплата не прошла» + возврат в бота |

### 4.3. Кроны (расписание в `vercel.json`; `vercel.json` одинаков у всех деплоев, поэтому каждый роут сам отдаёт 404 «не своему» деплою)

Аутентификация у всех — `isCronAuthorized(request)` (`cron-auth.server.ts`): `Authorization: Bearer $CRON_SECRET` (Vercel подставляет сам) **или** `?secret=` (наследие внешнего cron-job.org), `timingSafeEqual`.

| Путь | Расписание | `CONTROL_PLANE` | Что делает |
|---|---|---|---|
| `/api/cron/broadcast` | `*/1 * * * *` | =1 → 404 | Самый нагруженный: `ensureTelegramWebhook()`, до 4 порций `processBroadcastBatch()` (по 25), `processPendingDeliveries(5)` (отложенные выдачи/ретраи), `flushDueAdminOrderNotifications()` (удаление устаревших уведомлений продавцу) |
| `/api/cron/zernio-retry` | `*/1 * * * *` | =1 → 404 | `retryStuckZernioEvents()` — добор `pending` из `zernio_logs`; для консультанта дополнительно `pollIncomingConsultantBurst()` |
| `/api/cron/zernio-logs-prune` | `0 3 * * *` | =1 → 404 | Ретеншн `zernio_logs` |
| `/api/cron/ensure-webhook` | `0 * * * *` | =1 → 404 | `ensureTelegramWebhook()` + `ensureZernioWebhook()` |
| `/api/cron/manager-chat-prune` | `15 3 * * *` | =1 → 404 | Ретеншн `manager_chat_messages` |
| `/api/cron/misc-retention` | `30 3 * * *` | =1 → 404 | `pruneAdminLoginAttempts()` + `pruneBroadcastRecipients()` |
| `/api/cron/cart-reminder` | `*/30 * * * *` | =1 → 404; ниша consultant → skip | Напоминания о брошенной корзине |
| `/api/cron/fulfillment-reminder` | `0 * * * *` | =1 → 404; consultant → skip | Напоминания за сутки до `fulfillment_at` |
| `/api/cron/comment-dm-fallback` | `*/15 * * * *` | =1 → 404; consultant → skip | `runCommentDmFallback()` — резервные DM по комментариям Instagram |
| `/api/cron/consultant-vtb` | `*/15 * * * *` | =1 → 404; **не** consultant → skip | Параллельно: `refreshVtbRate()`, `refreshCatalogFromSavedSheet()`, `pollOutgoingManagerMessages()` |
| `/api/public/vip/cron` | `30 * * * *` | =1 → 404 | `ensureDidWebhooks()` + `runVipCronJob()` (предупреждения об истечении, исключение из группы) |
| `/api/operator-cron/subscriptions` | `0 4 * * *` | **≠1 → 404** | `sweepSubscriptions()` — предупреждение владельцев, применение политики (`suspend`). Идемпотентность через `bot_events` с ключом периода+дня |
| `/api/operator-cron/retention` | `45 3 * * *` | ≠1 → 404 | `pruneOperatorAuditTables()` |
| `/api/operator-cron/health-snapshot` | `*/15 * * * *` | ≠1 → 404 | `recordHealthSnapshots()` — снимки состояния деплоев клиентов (`bot_health_snapshots`, MIGRATION-48/59) |
| `/api/operator-cron/leads` | `0 5 * * *` | ≠1 → 404 | `runDailyLeadsPipeline()` — поиск/оценка/черновики/отправка лидов |

### 4.4. Внутренний API клиентского деплоя (`/api/internal/*`)

Аутентификация: `authenticateInternalRequest(request)` — заголовок `x-internal-secret` сравнивается с `bots.internal_secret` **своей же строки** (RLS оставляет деплою только свою). Сравнение по SHA-256 + `timingSafeEqual` (выравнивание длины), кэш секрета 60 с (защита от долбёжки БД мусорными запросами). Коды: 401 нет заголовка, 500 сбой чтения, 503 секрет не настроен, 403 не совпал.

| Путь | Что делает |
|---|---|
| `/api/internal/notify-owner` (POST) | `notifyOwner(text)` — шлёт текст **от имени этого бота его же токеном** всем получателям: `bots.owner_telegram_id` + все ID из `app_settings.admin_chat_id`. Каждый отказ возвращается наружу поштучно |
| `/api/internal/set-webhook` (POST) | `setOwnWebhook()` (shop + VIP) + `ensureZernioWebhook({force:true})` |
| `/api/internal/health` (POST) | `botHealth()` — `getWebhookInfo`, `pending_update_count`, коммит/ветка/env |
| `/api/internal/diagnostics` (POST) | `selfDiagnostics()` — построчная самопроверка всех env (задан / не задан / отпечаток секрета), плюс `probe: "consultant-dialogue"` |
| `/api/internal/ai-usage` (POST) | Чтение/сброс накопленного расхода LLM и Vision (после оплаты) |
| `/api/internal/receipt-audit` (POST) | Инвентарь/скан чеков, поиск дублей по хешу (таймаут 45 с — Vision до 20 с на PDF) |
| `/api/internal/reload` (POST) | `resetModuleCache()` + `syncMiniAppMenuButton()` — применить смену модулей без передеплоя |

### 4.5. Публичные / админские вспомогательные

| Путь | Аутентификация | Что делает |
|---|---|---|
| `/api/admin/upload` (POST) | `isAdminAuthed()` (cookie `admin-session`), 404 на панели | Загрузка в бакеты `product-images`/`product-files`; ключ `<BOT_ID>/<random>.<ext>` |
| `/api/admin/file/$` (GET) | `isAdminAuthed()` + `isOwnTenantStorageKey(splat)` (ключ должен начинаться с своего `BOT_ID`) | Скачивание из `product-files`/`payment-proofs`/`product-images` |
| `/api/public/img/$` (GET) | нет; для не-`product-images` — `isOwnTenantStorageKey` | Публичные картинки (`product-images`, `broadcast-images`, `instagram-media`), кэш 1 час |
| `/api/public/shop/handoff` (POST) | нет; гард `hasModule("web_storefront")` | Приём корзины с веб-витрины → токен → deep-link `?start=wc_<token>` |
| `/api/public/mini-app/{cart,checkout,orders,library,proof,search}` | `authorizeMiniAppRequest` — см. §5 | См. §5 |
| `/files/$token` (GET) | Токен в URL | Страница со ссылками на материалы заказа (для писем из Direct) |
| `/legal/$slug` (GET) | нет | `offer`, `privacy`, `requisites`, `about` — юридические страницы, `?raw=1` |
| `/shop` (GET) | нет; гард `hasModule("web_storefront")`, 404 на панели | Публичная веб-витрина (§5.2) |
| `/mini-app`, `/mini-app/library`, `/mini-app/orders`, `/mini-app/product/$productId`, `/mini-app-runtime` | нет (HTML); гард `miniAppModuleEnabled()` | Страницы и JS-рантайм Mini App |

### 4.6. Как резолвится арендатор

Три разных механизма, по каналу:
1. **Telegram, Robokassa, кроны, админка, Mini App, витрина** — арендатора резолвить не нужно: у деплоя ровно один `BOT_ID` из env, а RLS через `SUPABASE_TENANT_KEY` физически не даёт увидеть чужие строки. Панель (`CONTROL_PLANE=1`) отдаёт на этих путях 404 именно потому, что у неё `BOT_ID` нет, а подключение идёт под `service_role` мимо RLS.
2. **Zernio** — `resolveTenant({ accountId, username, botId })` (`tenant-router.server.ts`), кэш 60 с (фолбэк — 10 с):
   - явный `botId` → используется как есть;
   - `bot_accounts.zernio_account_id = accountId AND is_active` → `{bot_id, niche, account_username}`;
   - `bots.zernio_account_id = accountId`;
   - `bot_accounts.account_username ILIKE username`;
   - иначе `defaultFallbackTenant()` = `{bot_id: BOT_ID || "default", niche: VERTICAL || currentVertical() || "digital", isFallback: true}`.
   Дополнительно вебхук проверяет `zernioAccountPlatform(accountId)` — аккаунт вне профиля деплоя отбрасывается с 202.
3. **Панель → клиент** — по `bots.app_url` + `bots.internal_secret` через `/api/internal/*`.

---

## 5. Mini App и веб-витрина

### 5.1. Telegram Mini App (модуль `telegram_mini_app`, требует `shop`)

Серверно-рендеримые HTML-страницы + один самописный JS-рантайм (`mini-app-runtime.ts`, 68 KB, отдаётся с `/mini-app-runtime`, `Cache-Control: no-cache`). React в Mini App **не используется**.

- **Аутентификация**: `authorizeMiniAppRequest` (`mini-app.server.ts`) — заголовок `x-telegram-init-data` (не query: query утекает в логи/Referer), проверка HMAC через `validateTelegramInitData(initData, TELEGRAM_BOT_TOKEN, 3600)`. Просроченный/отсутствующий → 401, неверная подпись → 403. Модуль выключен → 404, токена нет → 503.
- **Rate limit**: `consumeMiniAppRateLimit(bucket, telegramId)` с бакетами `checkout`, `cart`, `search`, `proof`, `orders`, `orders_poll`, `library`; 429 + `Retry-After`.
- **Страницы**: `/mini-app` (каталог: сортировка, категории, страна, валюта, поиск, карточки — `mini-app-catalog.server.ts`), `/mini-app/product/$productId` (карточка: варианты, файлы, языковые бейджи, отзывы, похожие), `/mini-app/orders`, `/mini-app/library` (выданные материалы).
- **API**: `cart` (действия `add`/`remove`/`quantity` + скидочные `promo_apply|promo_clear|gift_apply|gift_clear|points_use|points_clear`), `checkout` (`miniAppRunCheckout` — пошаговый чекаут, возвращает `step`), `proof` (загрузка чека multipart, лимит `PAYMENT_PROOF_MAX_BYTES`, коды 413/404/409/503), `orders` (список + постановка оценки), `library`, `search` (умный поиск).
- **Общее с ботом**: та же `cart_items`, тот же `bot_users.state`, тот же `placeOrderInner(..., {miniApp: true})`. Экспорты из `bot.server.ts` для Mini App: `miniAppUpdateCartQuantity`, `miniAppSetCountry`, `miniAppMergeState`, `miniAppCartDiscountSummary`, `miniAppUpdateDiscount`, `placeOrderForMiniApp`, `miniAppPendingPayment`, `cancelMiniAppPendingPayment`, `completeMiniAppPayment`, `miniAppAddToCart`, `miniAppOpenCartInChat`, `ensureTelegramBotUser`. Результат оформления: `MiniAppPlaceOrderResult` = `robokassa | choose_payment | manual_proof | completed`.
- **Вход**: кнопка `🛍 Магазин` в главном меню (`web_app`) и Menu Button бота (`syncMiniAppMenuButton`, пере-синхронизируется через `/api/internal/reload`).
- **i18n**: `mini-app-i18n.ts` (36 KB), 4 языка; для ниши `confectionery` часть строк подменяется (`mini-app-i18n.ts:737`).
- Физическая ниша меняет набор шагов чекаута (`mini-app-page.server.ts:15`, `mini-app-catalog.server.ts:460` через `isPhysicalShopVertical`).

### 5.2. Веб-витрина `/shop` (модуль `web_storefront`)

Публичная страница каталога без авторизации. Серверный HTML, корзина в браузере. Показывает цену с учётом вариантов («от …»), рейтинг, значок «Нет в наличии» (`stock_quantity`, модуль `stock`), OG-мета. **Купить на самой витрине нельзя** — кнопка «Открыть в Telegram» отправляет корзину в `POST /api/public/shop/handoff`, получает токен и ведёт в бота по `?start=wc_<token>`, где `claimWebCartHandoff()` переносит позиции в `cart_items` и (если `state.web_handoff_pending_checkout`) сразу запускает оформление. Работает даже если покупатель никогда не открывал бота. 404 на панели (иначе показала бы первый попавшийся каталог из общей базы).

---

## 6. Ниши (verticals) и модули

### 6.1. Реестр ниш (`src/lib/verticals/registry.ts`, единственный источник)

Ниша задаётся `VERTICAL` на проекте Vercel. `VerticalDef` = `{ title, mode: "shop"|"consultant", defaultFulfillment: "digital"|"physical", botDescriptionIntro, shortDescription, suggestedModules, locales{ru,kk,en,uz}{welcomeGreeting, welcomeCatalog, welcomePayment, contactBtn, instructionComingSoon, instructionDefaultCaption} }`.

| Ключ | Title | mode | defaultFulfillment | suggestedModules |
|---|---|---|---|---|
| `digital` | Цифровые материалы | shop | digital | `multi_currency` |
| `confectionery` | Кондитерская | shop | physical | `multi_currency`, `stock` |
| `consultant` | Консультант (ун. BOVI) | consultant | physical | `instagram`, `manager_chat` |
| `flowers` | Цветы и букеты | shop | physical | `whatsapp`, `stock`, `multi_currency`, `manager_chat`, `smart_search` |
| `consultant_universal` | Универсальный консультант | consultant | physical | `instagram`, `manager_chat`, `smart_search`, `multi_currency` |

Предикаты: `isPhysicalShopVertical(k)` = `mode==="shop" && defaultFulfillment==="physical"` (confectionery, flowers); `isConsultantVertical(k)` = `mode==="consultant"`; `isBoviConsultantVertical(k)` = `k==="consultant"`; `isUniversalConsultantVertical(k)` = `k==="consultant_universal"`; `isFlowersVertical(k)`.

### 6.2. Все точки ветвления по нише

- `bot.server.ts:255/269` — `setMyDescription`/`setMyShortDescription` из `botDescriptionIntro`/`shortDescription`.
- `bot.server.ts:317` — приветствие после выбора языка.
- `bot.server.ts:1442/1483` — кнопка «Связаться с …» и её канонизация.
- `bot.server.ts:1596/1624` — тексты инструкции.
- `bot.server.ts:5408` — ниша `consultant`: весь текст в Telegram уходит в консультанта.
- `zernio-bot.server.ts:1432-1435, 1531` — выбор между магазинным сценарием, BOVI-консультантом и универсальным; ниша берётся из `tenant.niche || currentVertical()`.
- `routes/api/public/zernio/webhook.ts:76-78` — `consultantMode` меняет гарды и режим обработки (синхронно vs waitUntil).
- Кроны `cart-reminder`, `fulfillment-reminder`, `comment-dm-fallback` — пропускаются для `consultant*`; `consultant-vtb` — только для них.
- `zernio-retry.server.ts:49-51`, `comment-dm-fallback.server.ts:69-71`, `instagram.functions.ts:279-295` — гарды по консультанту.
- `products.functions.ts:150` — `fulfillment_kind` нового товара = `currentVerticalDef().defaultFulfillment`.
- `mini-app-page.server.ts:15`, `mini-app-catalog.server.ts:460`, `verticals/use-vertical.ts` — блок «Оплата физических заказов», пункт «Зоны доставки», шаги чекаута — только для `isPhysicalShopVertical`.
- `mini-app-i18n.ts:737` — подмена строк для `confectionery`.
- `verticals/consultant-admin-guard.ts` — `rejectConsultantShopPage` (витринные страницы в нише consultant редиректят на `/admin/consultant`), `rejectNonConsultantPage`.
- `smart-search.server.ts:237` — ниша подмешивается в промпт.
- `tenant-router.server.ts:30/53` — `niche` фолбэка.
- `diagnostics.server.ts:147-165` — явная строка в самодиагностике (неизвестное значение подсвечивается).
- `operator/env-block.server.ts:261-273` — печать `VERTICAL=` в блоке переменных; для `digital` печатается комментарий-инструкция «удалите вручную».
- `operator._authed.onboard.tsx:260`, `operator._authed.$botId.tsx:513` — селектор ниши; кнопка «Как у ниши» применяет `suggestedModules` (сознательно не автоматически).
- `verticals/flowers.ts` — отдельный файл специфики WhatsApp-First цветов: `FlowerDeliveryType` (`urgent`/`scheduled`), 5 тайм-слотов (`urgent_60_90`, 09-12, 12-15, 15-18, 18-21), `FlowerRecipientInfo` (третье лицо, звонок перед доставкой, сюрприз), `FlowerPostcard`, `FlowerPhotoApproval` (фото букета на согласование), 8 поводов (`matchFlowerOccasion`: birthday/romance/anniversary/maternity/wedding/apology/sympathy/just_because), 9 видов цветов (`matchFlowerSpecies`), `matchFlowerBudget` («до 25к», «бюджет 30 тыс»).

### 6.3. Реестр модулей (`src/lib/modules/registry.ts`) — 35 ключей

Поля: `title, group, price (₸ или null = входит в базовый пакет), status ("available"|"planned"), requires?, note?`. Гард — `hasModule(key)` (`modules/modules.server.ts`, читает `bots.modules` jsonb) и `requireModule()`. `MIGRATION-16-backfill-modules.sql` перечисляет канонические 35 ключей и бэкфиллит их в `bots.modules` (18 `planned` → false; `order_status`, `excel_export` → true всем; `multi_language` — по факту наличия kz-материалов у каждого клиента). `MIGRATION-25-module-requests.sql` заводит `module_requests` (`bot_id`, `module_key`, `requested_at`, `status pending|resolved`, `resolved_at`, частичный уникальный индекс на pending) — витрина `/admin/modules` (`admin.modules.tsx`) показывает доступные модули, которых у клиента нет, кнопка одновременно пишет строку и открывает Telegram оператора (`OPERATOR_TELEGRAM_USERNAME`).

**База (price: null)**: `shop`, `broadcasts`, `multi_files`, `order_status`, `excel_export`, `legal_docs`, `dashboard`.
**Оплата**: `robokassa` (25000, available), `crypto` (25000, planned — NOWPayments), `receipt_ocr` (20000, available), `telegram_stars` (17000, planned), `coupons` (20000, available), `gift_certificates` (14000, available), `upsell` (12000, planned), `quiz` (12000, planned).
**Каталог**: `multi_currency` (18000), `multi_language` (16000), `vip` (22000), `blocked` (14000), `courses` (18000, planned), `smart_search` (16000), `web_storefront` (22000), `telegram_mini_app` (28000, requires `shop`).
**Instagram**: `instagram` (22000), `dm_shop` (16000, requires `instagram`).
**WhatsApp**: `whatsapp` (22000), `wa_shop` (16000, requires `whatsapp`), `wa_broadcasts` (18000, requires `whatsapp`).
**Удержание**: `cart_reminder` (9000), `winback` (24000, planned), `funnel` (21000, planned), `loyalty` (14000), `referral` (14000).
**Сервис**: `manager_chat` (14000), `helpdesk` (22000, planned), `review_request` (7000), `notify_in_bot` (9000, planned).
**Аналитика**: `crm_pipeline` (14000, planned), `admin_roles` (14000, planned), `crm_integration` (12000, planned), `multi_bot` (23000, planned).
**Физические товары**: `stock` (12000, available), `limited_offers` (7000, planned), `waitlist` (9000, planned).

---

## 7. Уведомления

### 7.1. Кому

- **Продавец/владелец в Telegram.** Два списка, которые сходятся в `notifyRecipients()` (`internal-api.server.ts:105`): `bots.owner_telegram_id` (из карточки в панели) + все ID из `app_settings.admin_chat_id` (строка через запятую/точку с запятой/пробел). В магазинной ветке (`notifyAdminNewOrder`, `notifyAdmins`, `notifyAdminsAboutDeliveryIssue`, `notifyAdminsAboutUpcomingFulfillment`) исторически читается только `admin_chat_id`.
- **Telegram-группы.** `admin_chat_id` может содержать ID группы — тогда уведомления и кнопки `confirm:`/`reject:` приходят в группу. Именно поэтому `requireShopAdmin()` / `requireVipAdmin()` проверяют нажавшего: иначе кнопки нажал бы любой участник.
- **Покупатель.** `notifyOrderCustomer(orderId, text)` (`orders.server.ts:1632`) — канало-независимо (Telegram / Instagram / WhatsApp по `orders.platform`).
- **Оператор FrogFlow.** Панель шлёт не сама, а `POST {bots.app_url}/api/internal/notify-owner` — токены ботов у панели отсутствуют намеренно. Недоставка видна, а не проглатывается.
- **Почта покупателю.** `sendOrderMaterialsEmail` (`mail.server.ts`) через nodemailer/SMTP: письмо с подписанными ссылками на материалы (не вложениями — файлы до 100 МБ). Текст + HTML. `sendPlainTextMail` используется воронкой лидов в панели.

### 7.2. О чём

| Событие | Кому | Как |
|---|---|---|
| Новый заказ / пришёл чек | продавец (`admin_chat_id`) | `notifyAdminNewOrder()` (`bot.server.ts:4091`): сводка + состав заказа (`sendLongHtmlMessage` с разбивкой), фото/документ чека (переслать по `file_id`, иначе скачать из `payment-proofs`, иначе явное «чек не удалось получить»), превью обложек товаров, кнопки `confirm:` / `reject:` |
| Отзыв уведомления | — | `admin-order-notify.server.ts` + крон `broadcast`: запоминает `message_id` отправленных уведомлений (`app_settings`, ключ на заказ) и удаляет их по истечении `ADMIN_NOTIFY_DISMISS_DELAY_MS` |
| Сбой выдачи | продавец | `notifyAdminsAboutDeliveryIssue()` (`orders.server.ts:71`) — «⚠️ Заказ #N: …» |
| Вопрос в Direct вне сценария | продавец | `notifyAdminAboutQuestion()` (`direct-purchase.server.ts:1115`), троттлинг через `state.notified_at` |
| Жалоба на оплату / требование возврата | продавец | `notifyAdminAboutComplaint()` (1180) — срочное, бот замолкает (`isPaymentComplaint`) |
| Заказ штатной корзиной Instagram (мимо бота) | продавец | `notifyAdminAboutNativeCart()` (1141) |
| Direct-заказ с чеком | продавец | `notifyAdminAboutDirectOrder()` (903) |
| Напоминание об оплате | покупатель | `remindOrderPayment()` из админки |
| Брошенная корзина | покупатель | крон `cart-reminder` |
| Дата получения завтра | покупатель + продавец | крон `fulfillment-reminder` |
| Смена статуса физического заказа | покупатель | `fulfillment.server.ts:258/305` (включая откат «ready поставили по ошибке») |
| Материалы заказа | покупатель | Telegram-файлами или письмом (Direct/WhatsApp) |
| VIP: подписка истекает / истекла | подписчик | `vip-cron.server.ts`, 2 окна предупреждений; затем исключение из группы |
| VIP: чек на оплату подписки | админ | `vip_confirm:` / `vip_reject:` |
| Подписка на SaaS истекает / клиент приостановлен | владелец клиента | панель → `/api/internal/notify-owner` из `sweepSubscriptions()` |
| Рассылка владельцам от FrogFlow | владельцы всех клиентов | `operator._authed.broadcast.tsx` → `/api/internal/notify-owner` по каждому |
| Не доставился DM по комментарию | продавец в Telegram | 3-й уровень эскалации `comment-dm-fallback.server.ts` |
| Аккаунт Zernio отвалился | продавец | `handleZernioAccountDisconnected` |
| Консультант: покупка / нет в наличии / техсбой | менеджер (задача) | `consultant/notify.ts` → `notifyOwner()` с кнопками |

---

## 8. ИИ-консультант

Две реализации за одним переключателем ниши.

### 8.1. BOVI-консультант (`VERTICAL=consultant`, `src/lib/consultant/*`, спека `docs/bovi-consultant-spec.md`)

**Назначение.** Консультация по ассортименту в Instagram Direct: наличие, размер, цвет, бренд, цена в ₸ и ₽. Без кассы, без оплаты, без баллов, без расчёта СДЭК, без распознавания картинок. Касса — передача менеджеру.

**LLM.** Claude, модель `claude-haiku-4-5-20251001` (`consultant/config.ts:5`), переопределяется `CONSULTANT_MODEL`. Таймаут `CONSULTANT_AI_TIMEOUT_MS = 15000`, максимум `CONSULTANT_MAX_TOOL_ROUNDS = 3` раунда инструментов. Ключ — `ANTHROPIC_API_KEY`.

**Разделение ответственности** (из спеки): Claude отвечает за понимание свободного языка, извлечение сущностей, выбор инструмента, уточняющий вопрос и формулировку ответа из фактов инструмента. Бэкенд — за валидацию вебхука, идентичность/порядок/ретраи сообщений, состояние сессии и паузу, импорт и нормализацию каталога, курс, исполнение инструментов, **grounding-валидацию ответа**, точные регламентированные тексты, доставку и наблюдаемость. **Claude никогда не источник фактов о товаре, цене, остатке, валюте или доставке; полный каталог в запрос не кладётся.**

**Инструменты** (`consultant/tools.ts`): `search_products`, `search_knowledge`, `get_product`, `get_current_rate`, `get_catalog_link`, `get_story_product`, `ask_manager`, `handoff_to_manager`.

**Пайплайн** (`consultant/handle-message.ts`, 51 KB): `handleConsultantZernioEvent` → `withUserLock(userKey)` → `claimIncomingMessage` / `alreadyAnsweredIncoming` (идемпотентность) → проверка паузы (`isAutomationPaused`) → `managerSpokeInConversation()` (чтение хвоста диалога через Zernio API: событий об исходящих Zernio не шлёт, поэтому перед каждым ответом ищем исходящее сообщение новее нашего последнего и не нашими словами — найдено → пауза `manager_intervention`, ответ не отправляется) → `looksLikePromptInjection` → интенты (`consultant/intent.ts`) → каталог (`catalog.ts`, 35 KB) → Claude (`claude.ts`, 45 KB) → `validate.ts` (13 KB, grounding + запрещённые фразы + длина; один раунд «починки», второй провал → регламентированный техсбой-хендофф) → `style.ts` (запрет восклицательных знаков и эмодзи — единственная точка выхода наружу) → `sendDirectReply` → `recordConsultantRun` в `consultant_message_runs`.

**Регламентированные тексты** отправляются дословно: вопрос о стране (кнопки «Казахстан»/«Россия»), вопрос о товаре, обязательная строка про СДЭК при первой рублёвой цене в сессии, «Может, вас интересует что-нибудь ещё…», список других категорий, ссылка на bovi.kz, «Данного товара сейчас нет в наличии…», «Спасибо! В ближайшее время с вами свяжется менеджер…». Каждый из трёх последних создаёт задачу менеджеру и **ставит жёсткую паузу**. Тон: на «Вы», без эмодзи, запрещены «Отлично», «Прекрасный выбор», «Замечательно», «Будем рады помочь», «Передаю ваш диалог менеджеру».

**Каталог.** Источник — один из: Google Sheet, файл/папка Google Drive, загруженный вручную XLSX/CSV. `consultant/drive.ts` (`googleDriveFileId`, `googleDriveFolderId`, `listPublicFolderFileIds` — берёт свежайший csv/xlsx из папки), `catalog-import.ts:411` (`googleSheetsCsvUrl` → `export?format=csv&gid=`), `xlsx-import.ts` (пакет `xlsx`, первый лист → CSV с `;` → общий парсер), `doc-text.ts` (+ `mammoth` для .docx, `unpdf` для PDF в базе знаний). Импорт валидируется и публикуется атомарно; провал сохраняет последний хороший снимок. Версия каталога и время импорта прикладываются к каждому ответу. Устаревший снимок не даёт обещать цену/наличие.
Нормализованный вариант: `id`/SKU, `name`, `category`, опц. `brand`/`material`/`season`/`description`, `size_label`, цвета, `price_kzt`, остаток, опц. URL товара и картинки.
Особенности: размеры сравниваются как неупорядоченная пара с допуском 3 см («140x70» = «70x140», «70 на 140»); жёсткость матраса читается из названия, MEDIUM снят с продажи и вырезается на чтении каталога и из исходящего текста; жёсткость называется покупателю «комфортный (Soft)» / «упругий (Firm)».

**База знаний** (`consultant/knowledge.ts`): маленькая — инлайном в промпт; большая (у BOVI ~1/5 промпта) заменяется индексом заголовков/тегов, статья достаётся инструментом `search_knowledge`. Ответ цитирует формулировки источника; пустой результат = вопрос менеджеру, а не выдумка.

**Курс рубля** (`consultant/vtb.ts`, `vtb-parse.ts`, `finkaz-parse.ts`, `rate.ts`). ВТБ Казахстан отвечает только на запросы изнутри КЗ, а деплой снаружи — поэтому по умолчанию курс покупки рубля читается текстом со страницы банка на finkaz.kz (`CONSULTANT_RATE_URL`, умолчание — Kaspi); смена банка = смена URL. `CONSULTANT_RATE_SOURCE=vtb` + `CONSULTANT_VTB_RELAY_URL` — прямой путь через ретранслятор внутри КЗ. Три проверки чтения: число в правдоподобном коридоре и buy < sell; собственная метка времени страницы моложе суток; скачок >15% от сохранённого курса отклоняется с записью причины для панели. Курс старше трёх суток не используется вовсе — консультант называет цену в ₸, говорит, что рублёвую подтвердит менеджер, и зовёт менеджера. Курс всегда можно вбить руками в панели. Формула: `price_rub = round(price_kzt / (vtb_buy_rate * 0.95))`. Обновление — крон `/api/cron/consultant-vtb` каждые 15 минут.

**Zernio-интеграция**: вебхук (синхронная обработка для консультанта), плюс два опроса — `inbox-poll.ts` (`pollIncomingConsultantMessages` / `pollIncomingConsultantBurst`, добор входящих, если вебхук потерялся) и `outgoing-poll.ts` (`pollOutgoingManagerMessages`, 15-минутный бэкстоп обнаружения менеджера, сканирует хвост диалога, а не только последнее сообщение).

**Журнал и наблюдаемость**: `consultant_message_runs` (MIGRATION-69) — по строке на отвеченное сообщение с токенами и стоимостью; панель читает неделю: сообщения, расход, цена ответа, доля кэшированного ввода. `consultant/runs.ts`, `analytics.ts`, `tasks.ts`, `ab.ts`. Статусы сообщения: `received → processing → replied` + ретраибельные/терминальные причины отказа. Идемпотентность исходящих выводится из ID входящего и номера попытки. Пауза проверяется до Claude и непосредственно перед отправкой; снимается только явным действием администратора.

**Сторис**: `consultant/story-tags.functions.ts` + `story_product_tags` (MIGRATION-70) — привязка товара к сторис, инструмент `get_story_product` (ответ на сторис со словом «цена»).

**Таблицы консультанта**: `app_settings`, `bot_users` (состояние диалога), `consultant_message_runs`, `story_product_tags`, `zernio_logs`. Админка — `/admin/consultant` (`admin.consultant.tsx`, `consultant.functions.ts`).

### 8.2. Универсальный консультант (`VERTICAL=consultant_universal`, `src/lib/consultant-universal/*`)

Та же модель по умолчанию (`claude-haiku-4-5-20251001`, `CONSULTANT_MODEL`, `UNIVERSAL_AI_TIMEOUT_MS = 15000`). Отличия: не привязан к BOVI-каталогу, работает от **профиля бизнеса** (`profile.ts` — `UniversalBusinessProfile`, есть пресеты: цветочный бутик «Bloom & Petal Boutique», «Almaty Wellness & Bio Supplements», BOVI, «Бизнес Консультант») и **базы знаний** (`knowledge.ts` — `getPresetKnowledgeDocs`, `retrieveKnowledge`). `profiler.ts` (14 KB) — построение профиля бизнеса моделью. `engine.ts` — `buildUniversalPrompt`. Состояние — `UniversalConsultantState` в `bot_users.state`: `automation_paused`, `recent` (история ходов), `last_reply_at`, `customer_contact`.
Инструменты: `handoff_to_manager` (`reason ∈ purchase|book_call|booking|human_requested|custom_inquiry`, `customer_name`, `customer_contact`, `summary`) и `record_order_lead` (`lead_type ∈ order|call|booking`).

### 8.3. Умный поиск (отдельно от консультанта)

`src/lib/smart-search.server.ts`, модуль `smart_search`, тот же `ANTHROPIC_API_KEY`. Фолбэк, когда обычный поиск по каталогу ничего не нашёл. Есть дневной лимит и cooldown; стоимость копится в `ai_usage` (вкладка «Расход» в админке, сброс из панели после оплаты).

---

## 9. Control plane / панель оператора

### 9.1. Механика разделения

Один репозиторий и один бандл. `CONTROL_PLANE=1` на проекте панели включает `/operator/*` и operator-кроны и **выключает** всё клиентское (`/`, `/admin`, `/login`, `/shop`, `/mini-app*`, `/files/*`, `/api/public/*`, `/api/admin/*`, `/api/cron/*`) — не прячет ссылку, а отдаёт 404. Причина (`control-plane.server.ts`): у панели нет `BOT_ID` и tenant-ключа, её подключение идёт под `service_role` мимо RLS, и клиентская админка на таком деплое показывала бы и правила данные **всех** клиентов сразу. Зеркально `requireOperator()` (`operator/guard.server.ts`) отдаёт «Not found» на клиентском деплое. Три слоя изоляции: (1) переменная окружения, (2) отдельная cookie `operator-session` со своим `OPERATOR_SESSION_SECRET`, (3) `requireOperator()` **первой строкой каждой серверной функции** в `src/lib/operator/*` — не в роутере, потому что серверные функции TanStack Start вызываются по HTTP напрямую и `beforeLoad` их не прикрывает. `assertTenantDeployment()` — зеркальный вызов первой строкой клиентских серверных функций.

Сессия оператора: `iron-session`, `httpOnly`/`secure`/`sameSite: lax`, `maxAge` 7 дней; в cookie хранится отпечаток текущего `OPERATOR_PASSWORD` — смена пароля в Vercel отзывает все выданные cookie. Логин: `operator_login_attempts` (MIGRATION-13) с ретеншном.

### 9.2. Страницы панели

- `/operator/login` — форма входа.
- `/operator/_authed/` (`index.tsx`) — список клиентов: поиск, фильтры по подписке и здоровью, архивные скрыты по умолчанию, групповые действия, бейдж ниши рядом с именем (кроме `digital`).
- `/operator/_authed/$botId` — карточка клиента: данные, `app_url`, тумблеры модулей, смена ниши (`VERTICAL_KEYS`), «Переустановить webhook», здоровье и диагностика через `/api/internal/*`, счётчик расхода LLM/Vision со сбросом, аудит чеков (`receipt-audit-section.tsx`, `ai-usage-section.tsx`), подписка.
- `/operator/_authed/onboard` — мастер подключения (пресеты «Магазин», «Магазин + VIP», «Магазин + Instagram»; выбор ниши; кнопка «Как у ниши» применяет `suggestedModules` — **не автоматически**, автовключение платных модулей осталось решением человека).
- `/operator/_authed/broadcast` — рассылка владельцам клиентов (через `/api/internal/notify-owner`, поштучный результат доставки).
- `/operator/_authed/invoices` — счета и реквизиты для выплат (`subscription_invoices`, MIGRATION-58/60).
- `/operator/_authed/journal` — журнал событий (`bot_events`).
- `/operator/_authed/leads` — воронка продаж FrogFlow (`sales_leads` MIGRATION-63, `sales_pipeline` MIGRATION-67, `sales_zernio_outreach` MIGRATION-68).
- `/operator/_authed/requests` — заявки клиентов на подключение модулей (`module_requests`).

### 9.3. Как подключается новый клиент сегодня (DEPLOYMENT.md §«Подключение нового клиента»)

1. Панель → «Подключить клиента». Мастер: проверяет токен через `getMe` (`verifyBotToken`), заводит строку в `bots` (`bot_name`, `owner_id` = человекочитаемый slug с проверкой на дубль, `status: "active"`, `modules` jsonb со всеми 35 ключами, `vertical`, `app_url`, `internal_secret` = `randomSecret()`, `owner_name`, `owner_contact`, `owner_telegram_id`, `notes`), заводит строку в `order_counters` (`last_no = first_order_no` — при переносе клиента из его старой базы ставится текущий максимум, иначе нумерация у покупателей поедет назад), выпускает `SUPABASE_TENANT_KEY` (подпись `SUPABASE_JWT_SECRET`), генерирует `TELEGRAM_WEBHOOK_SECRET` (`randomSecret(16)`) и **печатает готовый блок переменных** для вставки в Vercel (`buildEnvBlockFor`). Включить можно только модули со `status: "available"`. **Токен Telegram нигде не сохраняется** — он нужен только для проверки.
2. Оператор вручную создаёт **новый проект в Vercel из этого же репозитория** и вставляет напечатанный блок переменных.
3. Дождаться сборки, открыть `/login` — должно отвечать 200.
4. Поставить webhook: панель → карточка клиента → «Переустановить webhook». Панель не ставит его сама, а делает `POST {bots.app_url}/api/internal/set-webhook` с `x-internal-secret` — токен берёт сам деплой из своих переменных.
5. Проверить `/start` в Telegram.

Если бот жил на другом деплое, старый проект надо **удалить**: его собственный крон `ensure-webhook` пытается забрать бота обратно. Защита есть — `ownsWebhook`: деплой ставит webhook, только если `bots.app_url` совпадает с его собственным адресом, — но старый проект тратит вызовы и путает диагностику.

### 9.4. Что конкретно значит «деплой на клиента»

- **Отдельный проект Vercel** на каждого клиента, собираемый из одного и того же `master` (пуш в `master` = выкладка в прод у всех живых клиентов, см. `CLAUDE.md`).
- **Отличие только в переменных окружения** (`BOT_ID`, `SUPABASE_TENANT_KEY`, `TELEGRAM_BOT_TOKEN`, `PUBLIC_APP_URL`, `ADMIN_*`, `SESSION_SECRET`, `CRON_SECRET`, `VERTICAL`, `ZERNIO_*`, `SMTP_*`, `VIP_*`).
- **Общая база Supabase на всех**, изоляция — RLS по `bot_id` через `current_bot_id()` из `SUPABASE_TENANT_KEY` (MIGRATION-01/02/04/18/34).
- **Storage** — общие бакеты, изоляция префиксом `<BOT_ID>/` + проверкой `isOwnTenantStorageKey` на каждом пути отдачи (MIGRATION-20/33/39).
- **Вебхуки** — свои на каждый деплой: Telegram (shop + VIP) с собственным `secret_token`, Zernio под собственным ключом клиента. Поддерживаются кроном `ensure-webhook` + `ownsWebhook`.
- **Кроны** — `vercel.json` одинаков у всех, каждый роут сам решает, его это деплой или нет, по `CONTROL_PLANE`.
- **Панель никогда не хранит токены ботов**: всё управление идёт запросами в `/api/internal/*` клиентского деплоя с `x-internal-secret` (= `bots.internal_secret`, лежит в БД, не в env). Утечка секрета даёт максимум возможность написать владельцу; утечка токена означала бы полный контроль над ботом. Таймаут 10 с (45 с для аудита чеков), результат — четыре исхода: `ok` / `skipped` (нечего звать) / `failed` (деплой ответил и отказал) / `unreachable` (таймаут, DNS, TLS, лежащий деплой); никогда не бросает.
- **Приостановка за неоплату** — `bots.status <> 'active'`: боты вежливо молчат (`replyIfPaused`, тот же гард в VIP и Zernio), вебхук не отзывается, токен не трогается. Применяется `sweepSubscriptions()` по политике `bots.settings`.

### 9.5. Что в этой схеме болит (для переписывания)

- `npm run lint` красный (~2100 ошибок prettier) — CI не доходит до typecheck/build/test, результаты сборки в CI не видны; 19 тестов падают исторически (`CLAUDE.md`, `ANALYSIS.md`).
- `npm run build` переписывает `src/routeTree.gen.ts` и «чинит» путь мёртвого 4000-строчного `src/routes/admin.instagram.old.tsx` с `/admin/instagram` на `/admin/instagram/old`, разворачивая мёртвый файл в настоящий маршрут админки. Лечится удалением файла.
- `bot.server.ts.old` (657 KB) лежит в корне репозитория.
- Создание проекта Vercel и вставка переменных — ручной шаг; API Vercel не используется.
- Известные отложенные дефекты, зафиксированные прямо в коде: `sum(order_items) ≠ orders.total` при доставке (строки «Доставка» в `order_items` нет, только колонка `delivery_fee`); Direct не проверяет остаток; ни один канал не умеет уменьшать количество в корзине; промокоды/баллы/сертификаты не поддержаны в Direct; Direct не спрашивает телефон; запрет смешанной корзины проверяется только в коде (read-then-write), без триггера в БД; нет текстовой «отмены» на шагах физического чекаута в Telegram; `maxDuration` вебхука Zernio не поднят (отсюда «69 потерянных Instagram-событий» в `ANALYSIS.md`, страхует крон-добор).
