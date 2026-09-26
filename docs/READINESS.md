# Готовность v2 по описи v1

Собирается командой `node scripts/readiness.ts` из `docs/inherited-knowledge.md`
и `docs/readiness.json` — руками не правится. `npm test` падает, если сводка
устарела, пункт описи назван неверно или указанного теста нет.

**Готовность для первых клиентов: 80,1 %** — покрыто тестами v2
589 из 735 нужных сейчас пунктов.

**Путь заказа: 92,3 %** — 312 из 338
(каталог, цена, оформление, оплата и чек, выдача; файлы — `ORDER_PATH` в скрипте).

| всего | покрыто | из них живыми тестами | дыра | позже | не нужно в v2 |
| ----- | ------- | --------------------- | ---- | ----- | ------------- |
| 1125 | 589 | 43 | 146 | 33 | 357 |

«Позже» — поведение нужно, но не магазинам, которые переезжают первыми
(модуль ещё не перенесён). «Не нужно в v2» — поведение убрано или заменено;
причина записана в `docs/readiness.json`.

## По файлам описи

| файл v1 | всего | покрыто | дыра | позже | не нужно | готовность |
| ------- | ----- | ------- | ---- | ----- | -------- | ---------- |
| поломки v1 (fix) | 51 | 15 | 8 | 0 | 28 | 65,2 % |
| `src/lib/comment-dm-fallback.test.ts` | 29 | 29 | 0 | 0 | 0 | 100 % |
| `src/lib/consultant/bovi-features.test.ts` | 7 | 0 | 0 | 0 | 7 | — |
| `src/lib/cron-auth.test.ts` | 7 | 0 | 5 | 0 | 2 | 0 % |
| `src/lib/csv.test.ts` | 14 | 6 | 8 | 0 | 0 | 42,8 % |
| `src/lib/error-message.test.ts` | 9 | 1 | 8 | 0 | 0 | 11,1 % |
| `src/lib/internal/internal-api.test.ts` | 8 | 0 | 0 | 0 | 8 | — |
| `src/lib/logger.test.ts` | 9 | 0 | 0 | 9 | 0 | — |
| `src/lib/manager-chat.test.ts` | 6 | 3 | 3 | 0 | 0 | 50 % |
| `src/lib/modules/registry.test.ts` | 1 | 0 | 1 | 0 | 0 | 0 % |
| `src/lib/modules/require-module.test.ts` | 8 | 1 | 7 | 0 | 0 | 12,5 % |
| `src/lib/operator/env-block.test.ts` | 7 | 0 | 0 | 0 | 7 | — |
| `src/lib/operator/leads-pipeline.test.ts` | 46 | 0 | 0 | 0 | 46 | — |
| `src/lib/operator/subscription-cron.test.ts` | 9 | 9 | 0 | 0 | 0 | 100 % |
| `src/lib/operator/subscriptions.test.ts` | 13 | 12 | 1 | 0 | 0 | 92,3 % |
| `src/lib/tenant-storage-key.test.ts` | 5 | 3 | 2 | 0 | 0 | 60 % |
| `src/lib/verticals/vertical.test.ts` | 13 | 1 | 8 | 0 | 4 | 11,1 % |
| `src/lib/vip-subscriptions.test.ts` | 9 | 4 | 4 | 0 | 1 | 50 % |
| `tests/admin-order-notify.test.ts` | 6 | 5 | 0 | 0 | 1 | 100 % |
| `tests/ai-usage.test.ts` | 5 | 2 | 1 | 0 | 2 | 66,6 % |
| `tests/analytics.test.ts` | 16 | 16 | 0 | 0 | 0 | 100 % |
| `tests/bot-order-placement.test.ts` | 4 | 3 | 1 | 0 | 0 | 75 % |
| `tests/bot-user-claim.test.ts` | 1 | 0 | 0 | 0 | 1 | — |
| `tests/broadcast-audience.test.ts` | 6 | 0 | 6 | 0 | 0 | 0 % |
| `tests/broadcast-create.test.ts` | 3 | 2 | 1 | 0 | 0 | 66,6 % |
| `tests/cart-reminder.test.ts` | 5 | 5 | 0 | 0 | 0 | 100 % |
| `tests/category-tree.test.ts` | 3 | 0 | 2 | 1 | 0 | 0 % |
| `tests/confectioner-admin.test.ts` | 16 | 16 | 0 | 0 | 0 | 100 % |
| `tests/consultant-1c-price.test.ts` | 8 | 0 | 0 | 0 | 8 | — |
| `tests/consultant-ask-manager.test.ts` | 4 | 0 | 1 | 0 | 3 | 0 % |
| `tests/consultant-broad-answer.test.ts` | 10 | 0 | 0 | 0 | 10 | — |
| `tests/consultant-cache-cost.test.ts` | 16 | 0 | 3 | 0 | 13 | 0 % |
| `tests/consultant-catalog-match.test.ts` | 16 | 0 | 0 | 0 | 16 | — |
| `tests/consultant-dialogues.test.ts` | 27 | 0 | 0 | 0 | 27 | — |
| `tests/consultant-discontinued.test.ts` | 13 | 0 | 0 | 0 | 13 | — |
| `tests/consultant-doc-text.test.ts` | 7 | 0 | 0 | 0 | 7 | — |
| `tests/consultant-finkaz-rate.test.ts` | 8 | 0 | 0 | 0 | 8 | — |
| `tests/consultant-knowledge-search.test.ts` | 4 | 1 | 0 | 0 | 3 | 100 % |
| `tests/consultant-manager-guard.test.ts` | 8 | 8 | 0 | 0 | 0 | 100 % |
| `tests/consultant-notify-recipients.test.ts` | 6 | 1 | 5 | 0 | 0 | 16,6 % |
| `tests/consultant-run-insert.test.ts` | 3 | 0 | 0 | 0 | 3 | — |
| `tests/consultant-settings-write.test.ts` | 4 | 4 | 0 | 0 | 0 | 100 % |
| `tests/consultant-style-budget.test.ts` | 16 | 0 | 0 | 0 | 16 | — |
| `tests/consultant-usage-stats.test.ts` | 4 | 0 | 1 | 0 | 3 | 0 % |
| `tests/consultant-vtb-rate.test.ts` | 12 | 0 | 0 | 0 | 12 | — |
| `tests/consultant.test.ts` | 73 | 8 | 7 | 0 | 58 | 53,3 % |
| `tests/currency.test.ts` | 4 | 3 | 1 | 0 | 0 | 75 % |
| `tests/datetime.test.ts` | 5 | 3 | 2 | 0 | 0 | 60 % |
| `tests/delivery-message.test.ts` | 4 | 3 | 0 | 0 | 1 | 100 % |
| `tests/delivery-zones.test.ts` | 5 | 4 | 1 | 0 | 0 | 80 % |
| `tests/direct-flow.test.ts` | 57 | 55 | 0 | 2 | 0 | 100 % |
| `tests/direct-purchase.test.ts` | 14 | 14 | 0 | 0 | 0 | 100 % |
| `tests/direct-receipt-download.test.ts` | 3 | 3 | 0 | 0 | 0 | 100 % |
| `tests/direct-reply.test.ts` | 2 | 2 | 0 | 0 | 0 | 100 % |
| `tests/fulfillment-dates.test.ts` | 10 | 10 | 0 | 0 | 0 | 100 % |
| `tests/fulfillment-kind.test.ts` | 5 | 5 | 0 | 0 | 0 | 100 % |
| `tests/fulfillment-reminder.test.ts` | 10 | 10 | 0 | 0 | 0 | 100 % |
| `tests/fulfillment.test.ts` | 18 | 17 | 1 | 0 | 0 | 94,4 % |
| `tests/gift-certificates.test.ts` | 5 | 5 | 0 | 0 | 0 | 100 % |
| `tests/instagram-inbox-message.test.ts` | 1 | 0 | 1 | 0 | 0 | 0 % |
| `tests/invoices-server.test.ts` | 11 | 11 | 0 | 0 | 0 | 100 % |
| `tests/loyalty.test.ts` | 7 | 7 | 0 | 0 | 0 | 100 % |
| `tests/manual-order.test.ts` | 8 | 8 | 0 | 0 | 0 | 100 % |
| `tests/mini-app-auth.test.ts` | 4 | 3 | 0 | 0 | 1 | 100 % |
| `tests/mini-app-catalog.test.ts` | 13 | 4 | 5 | 1 | 3 | 44,4 % |
| `tests/mini-app-library.test.ts` | 5 | 4 | 1 | 0 | 0 | 80 % |
| `tests/mini-app-rate-limit.test.ts` | 5 | 1 | 0 | 0 | 4 | 100 % |
| `tests/mini-app-regressions.test.ts` | 27 | 10 | 2 | 0 | 15 | 83,3 % |
| `tests/mini-app-related.test.ts` | 4 | 4 | 0 | 0 | 0 | 100 % |
| `tests/mini-app-text.test.ts` | 2 | 0 | 0 | 0 | 2 | — |
| `tests/mini-app-validation.test.ts` | 4 | 1 | 0 | 0 | 3 | 100 % |
| `tests/misc-retention.test.ts` | 3 | 1 | 2 | 0 | 0 | 33,3 % |
| `tests/order-files-page.test.ts` | 8 | 1 | 0 | 0 | 7 | 100 % |
| `tests/order-platform.test.ts` | 4 | 3 | 1 | 0 | 0 | 75 % |
| `tests/orders-pure.test.ts` | 11 | 11 | 0 | 0 | 0 | 100 % |
| `tests/payment-proof.test.ts` | 2 | 2 | 0 | 0 | 0 | 100 % |
| `tests/pricing.test.ts` | 20 | 20 | 0 | 0 | 0 | 100 % |
| `tests/product-materials.test.ts` | 25 | 25 | 0 | 0 | 0 | 100 % |
| `tests/promo-codes.test.ts` | 4 | 4 | 0 | 0 | 0 | 100 % |
| `tests/receipt-audit.test.ts` | 20 | 0 | 0 | 20 | 0 | — |
| `tests/receipt-ocr-auto.test.ts` | 6 | 6 | 0 | 0 | 0 | 100 % |
| `tests/receipt-verify.test.ts` | 51 | 50 | 0 | 0 | 1 | 100 % |
| `tests/reviews-server.test.ts` | 4 | 1 | 3 | 0 | 0 | 25 % |
| `tests/reviews.test.ts` | 6 | 5 | 1 | 0 | 0 | 83,3 % |
| `tests/robokassa.test.ts` | 11 | 11 | 0 | 0 | 0 | 100 % |
| `tests/smart-search.test.ts` | 14 | 8 | 4 | 0 | 2 | 66,6 % |
| `tests/telegram-init-data.test.ts` | 3 | 3 | 0 | 0 | 0 | 100 % |
| `tests/telegram-webapp-init-data.test.ts` | 9 | 0 | 9 | 0 | 0 | 0 % |
| `tests/tenant-isolation.test.ts` | 7 | 3 | 4 | 0 | 0 | 42,8 % |
| `tests/vip-flow.test.ts` | 24 | 24 | 0 | 0 | 0 | 100 % |
| `tests/web-storefront-handoff.test.ts` | 2 | 2 | 0 | 0 | 0 | 100 % |
| `tests/whatsapp-activation.test.ts` | 12 | 0 | 4 | 0 | 8 | 0 % |
| `tests/whatsapp-broadcast-audience.test.ts` | 3 | 2 | 1 | 0 | 0 | 66,6 % |
| `tests/whatsapp-catalog.test.ts` | 14 | 10 | 4 | 0 | 0 | 71,4 % |
| `tests/whatsapp-contact-exclusions.test.ts` | 3 | 3 | 0 | 0 | 0 | 100 % |
| `tests/zernio-account-disconnected.test.ts` | 4 | 0 | 4 | 0 | 0 | 0 % |
| `tests/zernio-automation-body.test.ts` | 8 | 8 | 0 | 0 | 0 | 100 % |
| `tests/zernio-base-url.test.ts` | 5 | 3 | 2 | 0 | 0 | 60 % |
| `tests/zernio-idempotency.test.ts` | 6 | 6 | 0 | 0 | 0 | 100 % |
| `tests/zernio-inbox-order.test.ts` | 3 | 3 | 0 | 0 | 0 | 100 % |
| `tests/zernio-inbox-shape.test.ts` | 2 | 2 | 0 | 0 | 0 | 100 % |
| `tests/zernio-logs-retention.test.ts` | 2 | 1 | 1 | 0 | 0 | 50 % |
| `tests/zernio-message.test.ts` | 17 | 12 | 5 | 0 | 0 | 70,5 % |
| `tests/zernio-post-ids.test.ts` | 9 | 9 | 0 | 0 | 0 | 100 % |
| `tests/zernio-retry.test.ts` | 2 | 1 | 1 | 0 | 0 | 50 % |
| `tests/zernio-webhook.test.ts` | 13 | 7 | 3 | 0 | 3 | 70 % |

## Дыры (146)

### поломки v1

- fix(consultant): notify every manager listed, and say who did not get it — adminRecipients (core/notify/recipients.ts) шлёт владельцу и всем admin_chat_id без дублей, но теста нет; тест-кнопки с отчётом кто не получил нет
- fix(zernio): read the last hundred messages of a conversation, not the first — listConversationMessages (channels/zernio/api.server.ts) просит sortOrder=desc и сортирует сам, теста нет
- fix(consultant): say which build is live and what the manager check saw — /api/health отдаёт commit и branch, пауза пишется итогом в zernio_logs (handle-message.ts), тестов нет
- fix(consultant): bill the cached prompt, and hold the cache for an hour — engine.server.ts считает cache_creation и cache_read в расход, но теста нет; TTL кеша 5 минут
- fix(instagram): resolve build type error and fully customize comment-to-dm buttons — кнопки второго сообщения задаёт продавец (automations.server.ts), но тест не проверяет, что уходят именно его кнопки
- fix(consultant): pass customer_contact to dynamic prompt context — engine.server.ts кладёт state.contact в данные диалога, теста нет
- fix(consultant): fix looksLikeConsultantBotReply empty snippet bug that dropped all incoming messages — findManagerMessage отбрасывает пустые ourReplies (filter(Boolean)), но теста с пустой репликой бота нет
- fix(consultant): prevent duplicate replies and handle affirmative responses like 'интересует' — «интересует» есть в AFFIRMATIVES (channels/zernio/shop-flow.ts), но тест classifyIncoming его не проверяет

### `src/lib/cron-auth.test.ts`

- пропускает верный Bearer-заголовок — isCronAuthorized (src/lib/cron-auth.ts) без теста
- отклоняет неверный секрет в заголовке — isCronAuthorized (src/lib/cron-auth.ts) без теста
- отклоняет запрос вовсе без секрета — isCronAuthorized (src/lib/cron-auth.ts) без теста
- отклоняет всё, если CRON_SECRET не задан на деплое — fail closed — env.ts требует CRON_SECRET от 16 символов, но теста нет
- не путает голый заголовок x-vercel-cron с настоящей авторизацией — isCronAuthorized (src/lib/cron-auth.ts) без теста

### `src/lib/csv.test.ts`

- минус внутри строки — не формула — cell в core/export/csv.ts, теста на дефис внутри строки нет
- заголовок остаётся и при пустых данных — toCsv в core/export/csv.ts, теста на пустые строки нет
- забирает всё, что больше одной страницы — pageAll (src/core/db/page.ts) без теста
- запрашивает страницы подряд, без пропусков и нахлёстов — pageAll (src/core/db/page.ts) без теста
- останавливается на неполной странице — ровно одна страница — pageAll (src/core/db/page.ts) без теста
- ровно PAGE строк — спрашивает следующую страницу — pageAll (src/core/db/page.ts) без теста
- пустая выборка — пустой результат, один запрос — pageAll (src/core/db/page.ts) без теста
- ошибку базы не проглатывает — иначе выгрузка выйдет неполной молча — pageAll (src/core/db/page.ts) без теста

### `src/lib/error-message.test.ts`

- объект с message — не Error, но текст есть — adminErrorText и ErrorBox (app/i18n/user-error.ts, app/ui/index.tsx) берут e.message или String(e) — не-Error даёт [object Object], теста нет
- объект с error (форма ошибок Zernio) — тоже читается — adminErrorText и ErrorBox (app/i18n/user-error.ts, app/ui/index.tsx) берут e.message или String(e) — не-Error даёт [object Object], теста нет
- message в приоритете над error, если оба есть — adminErrorText и ErrorBox (app/i18n/user-error.ts, app/ui/index.tsx) берут e.message или String(e) — не-Error даёт [object Object], теста нет
- объект без message/error — сериализуется в JSON, не в [object Object] — adminErrorText и ErrorBox (app/i18n/user-error.ts, app/ui/index.tsx) берут e.message или String(e) — не-Error даёт [object Object], теста нет
- пустая строка в message не считается текстом — идёт дальше — adminErrorText и ErrorBox (app/i18n/user-error.ts, app/ui/index.tsx) берут e.message или String(e) — не-Error даёт [object Object], теста нет
- строка и число — просто String() — adminErrorText отдаёт String(e), теста нет
- null/undefined не роняют функцию — String(e) в adminErrorText не падает на null, но теста нет
- циклическая структура — не падает на JSON.stringify, отдаёт String(e) — adminErrorText и ErrorBox (app/i18n/user-error.ts, app/ui/index.tsx) берут e.message или String(e) — не-Error даёт [object Object], теста нет

### `src/lib/manager-chat.test.ts`

- logs a placeholder for text-less messages (photos, etc.) — заглушка [без текста]/[фото] в core/chat/chat.ts и handle-update.ts, теста нет
- does nothing when the module is off, even if a stale active row exists — inboundIntercepted выходит до чтения состояния, но тест без модуля идёт при неактивной строке
- logs the tapped button with a 👉 prefix and mirrors the active flag — префикс 👉 ставит handle-update.ts, тест чата передаёт готовый текст

### `src/lib/modules/registry.test.ts`

- нашёл хотя бы один платный доступный модуль для проверки — в v2 нет теста, что каждый платный доступный модуль реестра проверяется гейтом (core/modules/registry.ts)

### `src/lib/modules/require-module.test.ts`

- модуль подключён — пропускает молча — requireAdminModule в src/app/auth/guards.server.ts без теста
- модуль не подключён — отказывает — requireAdminModule в src/app/auth/guards.server.ts без теста
- проверяется именно запрошенный модуль — requireAdminModule в src/app/auth/guards.server.ts без теста
- ошибка чтения не открывает доступ — модули читаются из TenantContext (core/tenant/directory.ts), теста на сбой чтения нет
- админ и модуль подключён — пропускает — requireAdminModule в src/app/auth/guards.server.ts без теста
- не админ — отказывает до проверки модуля — requireAdminModule сначала зовёт requireAdmin, теста нет
- админ, но модуль не подключён — отказывает — requireAdminModule в src/app/auth/guards.server.ts без теста

### `src/lib/operator/subscriptions.test.ts`

- дата без платежей помечается как неподтверждённая — computeState v2 (core/billing/subscription.ts) не различает дату без платежей, панель оператора этого не показывает

### `src/lib/tenant-storage-key.test.ts`

- пропускает ключ без префикса — файлы, залитые до этой правки — isTenantStorageKey (core/storage/keys.ts) отклоняет ключи без префикса — старые чеки и файлы v1 без префикса в админке v2 не откроются; решить и покрыть тестом
- сравнение с bot_id-префиксом регистронезависимое — isTenantStorageKey сравнивает префикс с учётом регистра, теста нет

### `src/lib/verticals/vertical.test.ts`

- падает в digital, когда VERTICAL не задан — семь живых деплоев не должны заметить разницу — ниша из bots.vertical, asVertical(null) → digital в core/tenant/directory.ts без теста
- падает в digital на пустой строке — asVertical("") → digital в core/tenant/directory.ts без теста
- подхватывает известную нишу — tenantFromRow сохраняет известную нишу, теста нет (core/tenant/directory.ts)
- подхватывает consultant — tenantFromRow с vertical consultant без теста
- digital — shop, не physical-shop UI — src/core/verticals/registry.ts без теста
- confectionery — shop + physical-shop UI — src/core/verticals/registry.ts без теста
- consultant — физические товары, без UI кондитерской — src/core/verticals/registry.ts без теста
- flowers — shop + physical-shop UI + whatsapp focus — src/core/verticals/registry.ts без теста

### `src/lib/vip-subscriptions.test.ts`

- статус не pending_payment (cancelled) — отклоняется с понятной причиной — activateSubscription в core/vip/vip.ts отклоняет не pending_payment, теста нет
- vip_group_id не настроен в панели — отклоняется до создания инвайта — проверка groupId в activateSubscription (core/vip/vip.ts) без теста
- заявку уже обработал другой администратор — откатывает только что созданный инвайт — откат инвайта при гонке в activateSubscription (core/vip/vip.ts) без теста
- новый инвайт создан, но Telegram отклонил его доставку — подписка активна, deliveryFailed: true — deliveryFailed при отказе отправки в activateSubscription без теста

### `tests/ai-usage.test.ts`

- разбирает счётчик чеков — parseUsage (core/receipts/verify.server.ts) читает только JSON — старое число v1 в receipt_ocr_usage станет 0, теста нет

### `tests/bot-order-placement.test.ts`

- из двух одновременных попыток claim забирает ровно одна — атомарность — в SQL-функции claim_order_placement (M27), v2 только передаёт результат RPC; юнит-тест на фейковой базе проверил бы саму подделку, а живой tests/integration/shop-flow.test.ts проверяет claim только последовательно — нужен живой параллельный тест (здесь без ключей не прогнать)

### `tests/broadcast-audience.test.ts`

- аудитория «все» не отдаёт синтетические id покупателей из других каналов — resolveAudience фильтрует platform=telegram и isRealTelegramChat (src/core/broadcasts/broadcasts.ts), но тест v2 проверяет только знак id, не положительный id чужого канала
- фильтр по платформе доезжает до запроса, а не только до результата — .eq(platform, telegram) есть в resolveAudience, теста на фильтр в запросе нет
- строка без telegram_id получателем не считается — isRealTelegramChat отсекает null, но тест на null/строку без telegram_id в аудитории нет
- покупатели считаются только по доставленным телеграм-заказам — живой тест проверяет только отсутствие пробного покупателя; статус delivered и платформа заказа не проверены
- «не покупали» исключает покупателей и чужие каналы разом — живой тест не содержит покупателя и строк чужих каналов
- аудитория по стране тоже не тянет чужие каналы — живой тест проверяет фильтр по стране, но без строк Instagram/WhatsApp

### `tests/broadcast-create.test.ts`

- рассылка в другом канале не считается занятой очередью — проверка занятости идёт с .eq(channel) в createBroadcast (src/core/broadcasts/broadcasts.ts), теста нет

### `tests/category-tree.test.ts`

- defaults to the bot-like tree of root folders — витрина /s/<slug> показывает только корневые категории (src/routes/s.$slug.index.tsx), теста нет
- shows children after opening a main category — витрина v2 не показывает подкатегории и фильтр по категории не включает потомков (src/core/storefront/catalog.ts)

### `tests/consultant-ask-manager.test.ts`

- передача менеджеру по-прежнему ставит паузу — handoff_to_manager ставит паузу 12 ч в src/core/consultant/engine.server.ts, теста нет

### `tests/consultant-cache-cost.test.ts`

- забирает поля кеша из ответа API — engine.server.ts читает cache_creation/cache_read_input_tokens, теста нет
- ответ без полей кеша даёт нули, а не NaN — engine.server.ts подставляет 0 при отсутствии полей кеша, теста нет
- чтение из кеша попадает в стоимость — стоимость с cacheRead считается в engine.server.ts для дневного предела, теста нет

### `tests/consultant-notify-recipients.test.ts`

- отправляет каждому — notifyOwner в src/app/operator/operator.server.ts шлёт всем adminRecipients, теста нет
- отказ одного не отменяет остальных и виден поимённо — notifyOwner (operator.server.ts) собирает failed поимённо, теста нет
- если не дошло никому — это не успех — notifyOwner (operator.server.ts) возвращает delivered/failed без признака успеха, теста нет
- получателей нет — говорим об этом прямо — notifyOwner (operator.server.ts) при пустом списке молча возвращает пустые массивы, теста нет
- отказы Telegram переводятся на человеческий — причина отказа отдаётся как description Telegram без перевода (operator.server.ts notifyOwner)

### `tests/consultant-usage-stats.test.ts`

- цена сообщения считается по тем же ставкам, что и общий счёт — цена ответа считается по PRICE в core/consultant/engine.server.ts и идёт в дневной бюджет, теста формулы нет

### `tests/consultant.test.ts`

- пустой ответ не отправляем — пустой ответ модели заменяется запасной фразой в runConsultant (core/consultant/engine.server.ts), теста нет
- paused state блокирует исходящие — isPaused в core/consultant/engine.server.ts (paused_until) без теста
- state читается из вложенного ключа и не ломает shop DirectState — состояние консультанта в customer.state.consultant (stateOf/saveState в core/consultant/engine.server.ts), теста нет
- по умолчанию Haiku 4.5, имя можно сменить ENV — DEFAULT_MODEL и CONSULTANT_MODEL в core/consultant/engine.server.ts без теста
- покупка → регламентированный handoff и pause — handoff/record_order_lead ставит паузу 12 ч и зовёт продавца (engine.server.ts, channels/zernio/handle-message.ts), теста нет
- buildAnthropicMessages формирует правильную структуру сообщений без смешивания истории в плоскую строку — история диалога собирается в сообщения Anthropic в runConsultant (core/consultant/engine.server.ts), теста нет
- buildAnthropicMessages объединяет последовательные сообщения одной роли и гарантирует старт с user — runConsultant (core/consultant/engine.server.ts) срезает ведущий assistant, но соседние реплики одной роли не склеивает, теста нет

### `tests/currency.test.ts`

- API недоступен, но есть кэш — считает по устаревшему курсу, не по null — расхождение: convertAmount (core/pricing/pricing.ts) при сбое провайдера после истечения TTL (10 мин) отдаёт null, хотя старые курсы ещё лежат в fxMemory; v1 считал по устаревшему кэшу. Кэш v2 только в памяти процесса (в v1 — в таблице settings), после холодного старта его нет вовсе

### `tests/datetime.test.ts`

- отрицательное смещение (США, UTC-5) — позже полуночи UTC того же числа — zonedDayToUtc (core/export/csv.ts) не проверен на поясе с отрицательным смещением и летнем времени
- полночь и 31 августа 23:59:59 Алматы попадают в один и тот же UTC-час — граница не рвёт сутки пополам — стык соседних суток в zonedDayToUtc (core/export/csv.ts) без пропуска и нахлёста не проверен

### `tests/delivery-zones.test.ts`

- activeDeliveryZones не видит зоны другого арендатора (RLS-изоляция) — activeDeliveryZones в v2 не фильтрует bot_id сам и полагается на RLS роли арендатора (ctx.db) — проверить можно только живым тестом в tests/integration (здесь нет ключей); фейковая база RLS не моделирует

### `tests/fulfillment.test.ts`

- recordPayment не даёт paid_amount превысить total (CHECK из MIGRATION-55) — расхождение: v1 отказывал (false, paid_amount не менялся), v2 recordPayment (core/fulfillment/fulfillment.ts) обрезает до total и возвращает true — лишнее молча теряется; инвариант paid ≤ total держится (src/core/fulfillment/fulfillment.test.ts › не поднимает paid_amount выше total), отказ есть только выше, в recordManualPayment

### `tests/instagram-inbox-message.test.ts`

- does not attach a message tag to a regular Direct reply — тело sendInboxMessage (channels/zernio/api.server.ts) без тега для обычного ответа не проверено

### `tests/mini-app-catalog.test.ts`

- searches names, descriptions, variants and keywords across the full index — расхождение: поиск storeCatalog идёт по name/keywords/description, названия вариантов не ищутся (название, описание, ключевые слова — в catalog.test.ts › ищет по названию, описанию и ключевым словам без учёта регистра)
- shows lead time on physical products and hides it for digital — расхождение: на странице товара (routes/s.$slug.p.$id.tsx) срок изготовления показывается при любом leadTimeDays, в том числе у цифрового; у физического с 0 дней карточка пишет «Товар», а не «В наличии»; разметка в JSX без тестов
- [Учителя-CRIT] hides language badges when the multi_language module is off — расхождение: StoreProduct.languages (core/storefront/catalog.ts) не учитывает модуль multi_language — языки файлов видны на странице товара и при выключенном модуле
- filters materials by language and keeps chips for the unfiltered set — расхождение: фильтра каталога по языку материала на витрине v2 нет
- lists material files on the product page and keeps a library tab — расхождение: на странице товара v2 только строка языков, без списка файлов; вкладки «Материалы» нет — библиотека на /s/:slug/orders

### `tests/mini-app-library.test.ts`

- подставляет актуальное имя и обложку товара, языки материала — расхождение: библиотека v2 берёт name_snapshot позиции, без актуального имени, обложки и языка

### `tests/mini-app-regressions.test.ts`

- filters catalog by material language and uses a two-column grid — расхождение: фильтра каталога по языку материала на витрине v2 нет
- ships a purchased-materials library, sort chips and bottom tabs — расхождение: библиотека есть (/s/:slug/orders, miniAppOrdersFn), но сортировки каталога и нижних вкладок в v2 нет

### `tests/misc-retention.test.ts`

- pruneOperatorAuditTables удаляет старые bot_events и operator_login_attempts — bot_events проверены в retention.test.ts, pruneOperatorLoginAttempts (core/retention/retention.ts) — без теста
- pruneBroadcastRecipients удаляет получателей кампаний старше окна — pruneBroadcastRecipients (core/retention/retention.ts) без теста

### `tests/order-platform.test.ts`

- treats legacy and unknown orders as Telegram — расхождение: v2 ветвится по order.platform !== "telegram" без нормализации (app/admin/admin.server.ts notifyCustomer и действие confirm, channels/telegram/handle-update.ts) — заказ с неизвестным platform уходит в ветку Zernio, а не в Telegram; функции orderPlatform нет (null в v2 исключён: orders.platform NOT NULL)

### `tests/reviews-server.test.ts`

- возвращает уникальные товары доставленного заказа этого покупателя — reviewableProductsForOrder (src/core/reviews/reviews.ts) проверен только на одной позиции, повторы не проверены
- чужой заказ или недоставленный — пустой список — reviewableProductsForOrder на чужом и недоставленном заказе не проверен
- updateReviewComment для несуществующей оценки — false, без побочных эффектов — saveComment (src/core/reviews/reviews.ts) вернёт true, если оценки нет, теста нет

### `tests/reviews.test.ts`

- округляет и не выходит за границы 1..5 — starsForRating проверен только сверху (9), округление и нижняя граница нет

### `tests/smart-search.test.ts`

- пустой список ids — пустой результат — parseSmartSearchIds на пустом массиве ids не проверен
- digital (умолчание, VERTICAL не задан) — промпт про учебные материалы — domainHint/buildPrompt в src/core/search/smart-pure.ts без теста
- confectionery — промпт про торты и десерты — domainHint/buildPrompt в src/core/search/smart-pure.ts без теста
- consultant — промпт про прайс, не учебные материалы — domainHint/buildPrompt в src/core/search/smart-pure.ts без теста

### `tests/telegram-webapp-init-data.test.ts`

- читает tgWebAppData из hash Mini App — расхождение: v2 берёт initData только из window.Telegram.WebApp.initData (useTelegramWebApp в src/app/storefront/cart.tsx); запасного чтения tgWebAppData из hash, query string или sessionStorage (__telegram__initParams) и раннего захвата launch params нет
- читает tgWebAppData из query string — расхождение: v2 берёт initData только из window.Telegram.WebApp.initData (useTelegramWebApp в src/app/storefront/cart.tsx); запасного чтения tgWebAppData из hash, query string или sessionStorage (__telegram__initParams) и раннего захвата launch params нет
- собирает значение, если внутренний query не закодирован целиком — расхождение: v2 берёт initData только из window.Telegram.WebApp.initData (useTelegramWebApp в src/app/storefront/cart.tsx); запасного чтения tgWebAppData из hash, query string или sessionStorage (__telegram__initParams) и раннего захвата launch params нет
- пустой hash — пустая строка — расхождение: v2 берёт initData только из window.Telegram.WebApp.initData (useTelegramWebApp в src/app/storefront/cart.tsx); запасного чтения tgWebAppData из hash, query string или sessionStorage (__telegram__initParams) и раннего захвата launch params нет
- берёт tgWebAppData из JSON, который пишет telegram-web-app.js — расхождение: v2 берёт initData только из window.Telegram.WebApp.initData (useTelegramWebApp в src/app/storefront/cart.tsx); запасного чтения tgWebAppData из hash, query string или sessionStorage (__telegram__initParams) и раннего захвата launch params нет
- игнорирует битый JSON — расхождение: v2 берёт initData только из window.Telegram.WebApp.initData (useTelegramWebApp в src/app/storefront/cart.tsx); запасного чтения tgWebAppData из hash, query string или sessionStorage (__telegram__initParams) и раннего захвата launch params нет
- разбирает сохранённый hash+search — расхождение: v2 берёт initData только из window.Telegram.WebApp.initData (useTelegramWebApp в src/app/storefront/cart.tsx); запасного чтения tgWebAppData из hash, query string или sessionStorage (__telegram__initParams) и раннего захвата launch params нет
- предпочитает SDK, затем capture, затем hash — расхождение: v2 берёт initData только из window.Telegram.WebApp.initData (useTelegramWebApp в src/app/storefront/cart.tsx); запасного чтения tgWebAppData из hash, query string или sessionStorage (__telegram__initParams) и раннего захвата launch params нет
- захватывает launch params до SDK и не просит закрыть окно — расхождение: v2 берёт initData только из window.Telegram.WebApp.initData (useTelegramWebApp в src/app/storefront/cart.tsx); запасного чтения tgWebAppData из hash, query string или sessionStorage (__telegram__initParams) и раннего захвата launch params нет

### `tests/tenant-isolation.test.ts`

- ключ арендатора видит только свои заказы — изоляция orders под tenantDb в живом тесте v2 не проверяется, есть только bots/products/app_settings
- ключ арендатора видит только своих покупателей — изоляция bot_users под tenantDb в живом тесте v2 не проверяется
- служебные таблицы панели арендатору недоступны — закрытость bot_events, operator_broadcasts, operator_login_attempts для роли арендатора в v2 не проверяется
- подделанная подпись не принимается — jwt.test.ts проверяет подпись только локально (verifyTenantJwt), отказ базы на поддельный ключ не проверяется

### `tests/whatsapp-activation.test.ts`

- restarts Instagram on /start so a CMD «Купить» button wakes the shop — postback /start от кнопки автоматизации (normalizeDmButtons ставит его по умолчанию) в handlePostback (shop.server.ts) уходит в default → question, магазин не открывается, теста нет
- treats a hidden /start payload as start even when the chat shows «купить» — скрытый payload /start кнопки CMD в handlePostback (shop.server.ts) не распознаётся как старт, теста нет
- treats a CMD payload that is itself a trigger word as start — postback со словом-вызовом не сверяется с triggers в handlePostback (shop.server.ts), теста нет
- ignores native Zernio ACT:: buttons and ordinary chat — чужой postback ACT:: уходит в default ветку handlePostback (shop.server.ts) → question, теста нет

### `tests/whatsapp-broadcast-audience.test.ts`

- без списка исключений отдаёт всех подряд — resolveWhatsAppAudience (core/broadcasts/broadcasts.ts) без списка исключений не проверяется, живой тест всегда задаёт список

### `tests/whatsapp-catalog.test.ts`

- отсутствующее или битое смещение — это ноль, а не NaN — расхождение: handlePostback (shop.server.ts) берёт Number(b)\|\|0 — отсутствующее и нечисловое смещение дают 0, но отрицательное проходит: CAT:<id>:-5 показывает пустую страницу (cats.slice(-5, 2)) только с «Ещё»/«Корзиной»/«Назад»
- «Назад» из категории ведёт к её родителю, а не к ней самой — расхождение: «Назад» из раздела в showCatalog/showProductList (shop.server.ts) всегда шлёт CATALOG — в корень, а не к родителю; из раздела второго уровня покупатель выпадает на верх каталога
- длинное название продолжается в описании — там товары и расходятся — расхождение: rowSubtitle в v2 нет — описание строки товара WhatsApp всегда только цена (showProductList, shop.server.ts), хвост длинного названия обрезается clipRowTitle, и «034. Декор на дверь к 1…»/«035. …» неразличимы
- не влезает вместе — хвост названия важнее цены — расхождение: rowSubtitle в v2 нет — описание строки всегда цена, хвост названия туда не попадает ни при каком месте

### `tests/zernio-account-disconnected.test.ts`

- уведомляет продавца по всем адресам из admin_chat_id — handleAccountDisconnected (channels/zernio/handle-account.ts) без теста
- без настроенного admin_chat_id ничего не отправляет — handleAccountDisconnected (channels/zernio/handle-account.ts) без теста
- не повторяет уведомление о том же аккаунте раньше шести часов — кулдаун zernio_disconnect_notified в handle-account.ts без теста
- другой аккаунт уведомляется даже пока первый ещё в кулдауне — кулдаун по аккаунту в handle-account.ts без теста

### `tests/zernio-base-url.test.ts`

- calls the JSON API even when Vercel contains only the Zernio host — что запросы (connect.server.ts, api.server.ts) идут по нормализованному адресу, тестом не проверено
- reports a useful configuration error for an HTML response — ошибка «Проверьте ZERNIO_BASE_URL» на HTML-ответ в api.server.ts без теста

### `tests/zernio-logs-retention.test.ts`

- сообщает done, когда удалять нечего — pruneZernioLogs (core/retention/retention.ts) возвращает done, но тестом это не проверено

### `tests/zernio-message.test.ts`

- берёт accountId как канонический, а не id — приоритет accountId над id в parseZernioMessage (message.ts) есть, но в тесте оба поля равны
- подпись строки приходит текстом и остаётся в text, не подменяя payload — что подпись строки остаётся в text отдельно от postbackPayload (message.ts), тестом не проверено
- кнопка чужой автоматизации Zernio отдаётся как есть — payload ACT:: в parseZernioMessage (message.ts) отдаётся как есть, но теста нет
- кнопка WhatsApp (button_reply) читается так же, как строка списка — button_reply в INTERACTIVE_TAP_TYPES (message.ts) есть, тест проверяет только list_reply
- запасное чтение из message.metadata работает, если форма вернётся — запасное чтение message.metadata в parseZernioMessage (message.ts) без теста

### `tests/zernio-retry.test.ts`

- выключенный модуль instagram — добор не трогает ничего — retryStuckEventsFor (channels/zernio/dispatch.server.ts) отбирает клиентов по профилю Zernio, не по модулю; теста нет

### `tests/zernio-webhook.test.ts`

- accepts an HMAC-SHA256 signature for the untouched raw body — verifyZernioSignature (src/routes/api/zernio/webhook.ts) без теста
- rejects missing credentials, altered bodies and altered signatures — verifyZernioSignature (src/routes/api/zernio/webhook.ts) без теста
- двум аккаунтам без точного id не угадывает — findTenant по неизвестному id Zernio (core/tenant/directory.ts) отдельно не проверен, есть только тест на общий аккаунт у двух клиентов
