# Готовность v2 по описи v1

Собирается командой `node scripts/readiness.ts` из `docs/inherited-knowledge.md`
и `docs/readiness.json` — руками не правится. `npm test` падает, если сводка
устарела, пункт описи назван неверно или указанного теста нет.

**Готовность для первых клиентов: 51 %** — покрыто тестами v2
375 из 734 нужных сейчас пунктов.

| всего | покрыто | из них живыми тестами | дыра | позже | не нужно в v2 |
| ----- | ------- | --------------------- | ---- | ----- | ------------- |
| 1125 | 375 | 43 | 359 | 33 | 358 |

«Позже» — поведение нужно, но не магазинам, которые переезжают первыми
(модуль ещё не перенесён). «Не нужно в v2» — поведение убрано или заменено;
причина записана в `docs/readiness.json`.

## По файлам описи

| файл v1 | всего | покрыто | дыра | позже | не нужно | готовность |
| ------- | ----- | ------- | ---- | ----- | -------- | ---------- |
| поломки v1 (fix) | 51 | 14 | 9 | 0 | 28 | 60,8 % |
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
| `src/lib/operator/subscription-cron.test.ts` | 9 | 3 | 6 | 0 | 0 | 33,3 % |
| `src/lib/operator/subscriptions.test.ts` | 13 | 12 | 1 | 0 | 0 | 92,3 % |
| `src/lib/tenant-storage-key.test.ts` | 5 | 3 | 2 | 0 | 0 | 60 % |
| `src/lib/verticals/vertical.test.ts` | 13 | 1 | 8 | 0 | 4 | 11,1 % |
| `src/lib/vip-subscriptions.test.ts` | 9 | 4 | 4 | 0 | 1 | 50 % |
| `tests/admin-order-notify.test.ts` | 6 | 0 | 5 | 0 | 1 | 0 % |
| `tests/ai-usage.test.ts` | 5 | 2 | 1 | 0 | 2 | 66,6 % |
| `tests/analytics.test.ts` | 16 | 2 | 14 | 0 | 0 | 12,5 % |
| `tests/bot-order-placement.test.ts` | 4 | 2 | 2 | 0 | 0 | 50 % |
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
| `tests/consultant-notify-recipients.test.ts` | 6 | 0 | 6 | 0 | 0 | 0 % |
| `tests/consultant-run-insert.test.ts` | 3 | 0 | 0 | 0 | 3 | — |
| `tests/consultant-settings-write.test.ts` | 4 | 0 | 4 | 0 | 0 | 0 % |
| `tests/consultant-style-budget.test.ts` | 16 | 0 | 0 | 0 | 16 | — |
| `tests/consultant-usage-stats.test.ts` | 4 | 0 | 1 | 0 | 3 | 0 % |
| `tests/consultant-vtb-rate.test.ts` | 12 | 0 | 0 | 0 | 12 | — |
| `tests/consultant.test.ts` | 73 | 5 | 10 | 0 | 58 | 33,3 % |
| `tests/currency.test.ts` | 4 | 1 | 3 | 0 | 0 | 25 % |
| `tests/datetime.test.ts` | 5 | 3 | 2 | 0 | 0 | 60 % |
| `tests/delivery-message.test.ts` | 4 | 0 | 4 | 0 | 0 | 0 % |
| `tests/delivery-zones.test.ts` | 5 | 0 | 5 | 0 | 0 | 0 % |
| `tests/direct-flow.test.ts` | 57 | 48 | 7 | 2 | 0 | 87,2 % |
| `tests/direct-purchase.test.ts` | 14 | 3 | 11 | 0 | 0 | 21,4 % |
| `tests/direct-receipt-download.test.ts` | 3 | 1 | 2 | 0 | 0 | 33,3 % |
| `tests/direct-reply.test.ts` | 2 | 1 | 1 | 0 | 0 | 50 % |
| `tests/fulfillment-dates.test.ts` | 10 | 6 | 4 | 0 | 0 | 60 % |
| `tests/fulfillment-kind.test.ts` | 5 | 4 | 1 | 0 | 0 | 80 % |
| `tests/fulfillment-reminder.test.ts` | 10 | 4 | 6 | 0 | 0 | 40 % |
| `tests/fulfillment.test.ts` | 18 | 4 | 14 | 0 | 0 | 22,2 % |
| `tests/gift-certificates.test.ts` | 5 | 3 | 2 | 0 | 0 | 60 % |
| `tests/instagram-inbox-message.test.ts` | 1 | 0 | 1 | 0 | 0 | 0 % |
| `tests/invoices-server.test.ts` | 11 | 4 | 7 | 0 | 0 | 36,3 % |
| `tests/loyalty.test.ts` | 7 | 4 | 3 | 0 | 0 | 57,1 % |
| `tests/manual-order.test.ts` | 8 | 8 | 0 | 0 | 0 | 100 % |
| `tests/mini-app-auth.test.ts` | 4 | 3 | 0 | 0 | 1 | 100 % |
| `tests/mini-app-catalog.test.ts` | 13 | 0 | 9 | 1 | 3 | 0 % |
| `tests/mini-app-library.test.ts` | 5 | 0 | 5 | 0 | 0 | 0 % |
| `tests/mini-app-rate-limit.test.ts` | 5 | 0 | 1 | 0 | 4 | 0 % |
| `tests/mini-app-regressions.test.ts` | 27 | 5 | 7 | 0 | 15 | 41,6 % |
| `tests/mini-app-related.test.ts` | 4 | 0 | 4 | 0 | 0 | 0 % |
| `tests/mini-app-text.test.ts` | 2 | 0 | 0 | 0 | 2 | — |
| `tests/mini-app-validation.test.ts` | 4 | 1 | 0 | 0 | 3 | 100 % |
| `tests/misc-retention.test.ts` | 3 | 1 | 2 | 0 | 0 | 33,3 % |
| `tests/order-files-page.test.ts` | 8 | 1 | 0 | 0 | 7 | 100 % |
| `tests/order-platform.test.ts` | 4 | 0 | 2 | 0 | 2 | 0 % |
| `tests/orders-pure.test.ts` | 11 | 2 | 9 | 0 | 0 | 18,1 % |
| `tests/payment-proof.test.ts` | 2 | 0 | 2 | 0 | 0 | 0 % |
| `tests/pricing.test.ts` | 20 | 3 | 17 | 0 | 0 | 15 % |
| `tests/product-materials.test.ts` | 25 | 17 | 8 | 0 | 0 | 68 % |
| `tests/promo-codes.test.ts` | 4 | 4 | 0 | 0 | 0 | 100 % |
| `tests/receipt-audit.test.ts` | 20 | 0 | 0 | 20 | 0 | — |
| `tests/receipt-ocr-auto.test.ts` | 6 | 0 | 6 | 0 | 0 | 0 % |
| `tests/receipt-verify.test.ts` | 51 | 16 | 34 | 0 | 1 | 32 % |
| `tests/reviews-server.test.ts` | 4 | 1 | 3 | 0 | 0 | 25 % |
| `tests/reviews.test.ts` | 6 | 5 | 1 | 0 | 0 | 83,3 % |
| `tests/robokassa.test.ts` | 11 | 6 | 5 | 0 | 0 | 54,5 % |
| `tests/smart-search.test.ts` | 14 | 8 | 4 | 0 | 2 | 66,6 % |
| `tests/telegram-init-data.test.ts` | 3 | 3 | 0 | 0 | 0 | 100 % |
| `tests/telegram-webapp-init-data.test.ts` | 9 | 0 | 9 | 0 | 0 | 0 % |
| `tests/tenant-isolation.test.ts` | 7 | 3 | 4 | 0 | 0 | 42,8 % |
| `tests/vip-flow.test.ts` | 24 | 24 | 0 | 0 | 0 | 100 % |
| `tests/web-storefront-handoff.test.ts` | 2 | 0 | 2 | 0 | 0 | 0 % |
| `tests/whatsapp-activation.test.ts` | 12 | 0 | 4 | 0 | 8 | 0 % |
| `tests/whatsapp-broadcast-audience.test.ts` | 3 | 2 | 1 | 0 | 0 | 66,6 % |
| `tests/whatsapp-catalog.test.ts` | 14 | 4 | 10 | 0 | 0 | 28,5 % |
| `tests/whatsapp-contact-exclusions.test.ts` | 3 | 3 | 0 | 0 | 0 | 100 % |
| `tests/zernio-account-disconnected.test.ts` | 4 | 0 | 4 | 0 | 0 | 0 % |
| `tests/zernio-automation-body.test.ts` | 8 | 8 | 0 | 0 | 0 | 100 % |
| `tests/zernio-base-url.test.ts` | 5 | 3 | 2 | 0 | 0 | 60 % |
| `tests/zernio-idempotency.test.ts` | 6 | 6 | 0 | 0 | 0 | 100 % |
| `tests/zernio-inbox-order.test.ts` | 3 | 0 | 3 | 0 | 0 | 0 % |
| `tests/zernio-inbox-shape.test.ts` | 2 | 2 | 0 | 0 | 0 | 100 % |
| `tests/zernio-logs-retention.test.ts` | 2 | 1 | 1 | 0 | 0 | 50 % |
| `tests/zernio-message.test.ts` | 17 | 12 | 5 | 0 | 0 | 70,5 % |
| `tests/zernio-post-ids.test.ts` | 9 | 9 | 0 | 0 | 0 | 100 % |
| `tests/zernio-retry.test.ts` | 2 | 1 | 1 | 0 | 0 | 50 % |
| `tests/zernio-webhook.test.ts` | 13 | 7 | 3 | 0 | 3 | 70 % |

## Дыры (359)

### поломки v1

- fix(consultant): notify every manager listed, and say who did not get it — adminRecipients (core/notify/recipients.ts) шлёт владельцу и всем admin_chat_id без дублей, но теста нет; тест-кнопки с отчётом кто не получил нет
- fix(zernio): read the last hundred messages of a conversation, not the first — listConversationMessages (channels/zernio/api.server.ts) просит sortOrder=desc и сортирует сам, теста нет
- fix(consultant): say which build is live and what the manager check saw — /api/health отдаёт commit и branch, пауза пишется итогом в zernio_logs (handle-message.ts), тестов нет
- fix(consultant): bill the cached prompt, and hold the cache for an hour — engine.server.ts считает cache_creation и cache_read в расход, но теста нет; TTL кеша 5 минут
- fix(consultant): stop losing knowledge base and store info writes — setSetting (core/settings/settings.ts) не читает error у update/insert — отказ записи молча выглядит успехом, теста нет
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

### `src/lib/operator/subscription-cron.test.ts`

- оплаченный бот не трогает — sweepSubscriptions в src/app/operator/billing.server.ts пропускает ok, теста нет
- просрочка дольше отсрочки с политикой suspend — приостанавливает и уведомляет — приостановка в sweepSubscriptions (app/operator/billing.server.ts) без теста
- та же просрочка с политикой warn — только предупреждает, не приостанавливает — grace_over при политике warn в sweepSubscriptions без теста
- новый оплаченный период после предупреждения — предупреждает заново — метка sweep_marker включает срок подписки, но теста на новый период нет
- уже приостановленного бота повторно не трогает — пропуск suspended в sweepSubscriptions без теста
- без даты подписки — пропускает — пропуск no_data в sweepSubscriptions без теста (computeState покрыт)

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

### `tests/admin-order-notify.test.ts`

- парсит сохранённые message_id и отбрасывает мусор — в v2 нет отзыва уведомлений продавцу о заказе (admin_notify_tg:*, удаление через 5 минут) — ни кода, ни теста
- читает пачку с отложенным удалением и старый массив — в v2 нет отзыва уведомлений продавцу о заказе (admin_notify_tg:*, удаление через 5 минут) — ни кода, ни теста
- считает пачку готовой к удалению только после deleteAfter — в v2 нет отзыва уведомлений продавцу о заказе (admin_notify_tg:*, удаление через 5 минут) — ни кода, ни теста
- достаёт id из одного сообщения и из media group — в v2 нет отзыва уведомлений продавцу о заказе (admin_notify_tg:*, удаление через 5 минут) — ни кода, ни теста
- не дублирует одни и те же сообщения и сохраняет флаг кнопок — в v2 нет отзыва уведомлений продавцу о заказе (admin_notify_tg:*, удаление через 5 минут) — ни кода, ни теста

### `tests/ai-usage.test.ts`

- разбирает счётчик чеков — parseUsage (core/receipts/verify.server.ts) читает только JSON — старое число v1 в receipt_ocr_usage станет 0, теста нет

### `tests/analytics.test.ts`

- группирует выручку и скидки по валюте, не смешивая их — analytics.ts складывает выручку всех валют в одну сумму, разбивки по валютам нет
- пустой список — пустой результат — analytics.ts складывает выручку всех валют в одну сумму, разбивки по валютам нет
- возвращает валюту с наибольшим числом заказов — analytics.ts складывает выручку всех валют в одну сумму, разбивки по валютам нет
- пустой список — null — analytics.ts складывает выручку всех валют в одну сумму, разбивки по валютам нет
- доминирующая валюта всегда первая, остальные — по числу заказов — analytics.ts складывает выручку всех валют в одну сумму, разбивки по валютам нет
- доминирующая валюта не обязана быть первой по числу заказов в самой сводке — analytics.ts складывает выручку всех валют в одну сумму, разбивки по валютам нет
- без доминирующей — просто по числу заказов, при равенстве по алфавиту — analytics.ts складывает выручку всех валют в одну сумму, разбивки по валютам нет
- сортирует по количеству проданного, суммирует выручку только для указанных заказов — топ в v2 сортируется по выручке, а не по количеству, теста нет (core/analytics/analytics.ts)
- товар без product_id группируется по названию, а не теряется — топ товаров в core/analytics/analytics.ts без теста
- ограничивает результат limit позициями — топ товаров в core/analytics/analytics.ts без теста
- цифровой заказ в аналитике только после выдачи, сумма = total — PAID_STATUSES в core/analytics/pure.ts включает paid для любых заказов, правило цифрового после выдачи без теста
- физический заказ в работе входит с paid_amount — задаток виден до выдачи — v2 аналитика берёт полный total и не учитывает paid_amount задатка (core/analytics/analytics.ts)
- выданный физический заказ считает полный total, не задаток — v2 аналитика берёт полный total и не учитывает paid_amount задатка (core/analytics/analytics.ts)
- при scale 0.3 строка 20000 даёт 6000, как сводка по paid_amount — v2 аналитика берёт полный total и не учитывает paid_amount задатка (core/analytics/analytics.ts)

### `tests/bot-order-placement.test.ts`

- releaseOrderPlacement снимает флаг, не трогая остальной state — releaseOrderPlacement (core/orders/orders.ts) — сохранность остального state не проверяется
- из двух одновременных попыток claim забирает ровно одна — claimOrderPlacement проверен только последовательно, параллельного теста нет

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

- владелец и все ID из настроек, без повторов — adminRecipients (src/core/notify/recipients.ts) — владелец плюс admin_chat_id без дублей, теста нет
- отправляет каждому — notifyOwner в src/app/operator/operator.server.ts шлёт всем adminRecipients, теста нет
- отказ одного не отменяет остальных и виден поимённо — notifyOwner (operator.server.ts) собирает failed поимённо, теста нет
- если не дошло никому — это не успех — notifyOwner (operator.server.ts) возвращает delivered/failed без признака успеха, теста нет
- получателей нет — говорим об этом прямо — notifyOwner (operator.server.ts) при пустом списке молча возвращает пустые массивы, теста нет
- отказы Telegram переводятся на человеческий — причина отказа отдаётся как description Telegram без перевода (operator.server.ts notifyOwner)

### `tests/consultant-settings-write.test.ts`

- база знаний пишется без onConflict — ключ составной — база знаний пишется через setSetting (core/settings/settings.ts, select+update/insert без onConflict), теста записи новой настройки нет
- адрес и часы пишутся без onConflict — доставка и оплата в consultant_profile пишутся через setSetting (core/settings/settings.ts), теста нет
- отказ базы больше не выглядит как успех — база знаний — setSetting (core/settings/settings.ts) не проверяет error от update/insert — отказ базы выглядит как успех saveConsultantFn
- отказ базы больше не выглядит как успех — адрес магазина — setSetting (core/settings/settings.ts) глотает ошибку записи — профиль консультанта может не сохраниться молча

### `tests/consultant-usage-stats.test.ts`

- цена сообщения считается по тем же ставкам, что и общий счёт — цена ответа считается по PRICE в core/consultant/engine.server.ts и идёт в дневной бюджет, теста формулы нет

### `tests/consultant.test.ts`

- режет цену, которой не было в tools — v2 не сверяет цену в ответе консультанта с каталогом — только правило в промпте (core/consultant/prompt.ts)
- пустой ответ не отправляем — пустой ответ модели заменяется запасной фразой в runConsultant (core/consultant/engine.server.ts), теста нет
- режет выдуманную стоимость доставки — v2 не проверяет выдуманную стоимость доставки в ответе — только правило в промпте (core/consultant/prompt.ts)
- paused state блокирует исходящие — isPaused в core/consultant/engine.server.ts (paused_until) без теста
- state читается из вложенного ключа и не ломает shop DirectState — состояние консультанта в customer.state.consultant (stateOf/saveState в core/consultant/engine.server.ts), теста нет
- по умолчанию Haiku 4.5, имя можно сменить ENV — DEFAULT_MODEL и CONSULTANT_MODEL в core/consultant/engine.server.ts без теста
- покупка → регламентированный handoff и pause — handoff/record_order_lead ставит паузу 12 ч и зовёт продавца (engine.server.ts, channels/zernio/handle-message.ts), теста нет
- валидатор цен не бракует телефонные номера, года и суммы наборов — валидатора цен в ответе консультанта v2 нет (см. правило про выдуманные цены)
- buildAnthropicMessages формирует правильную структуру сообщений без смешивания истории в плоскую строку — история диалога собирается в сообщения Anthropic в runConsultant (core/consultant/engine.server.ts), теста нет
- buildAnthropicMessages объединяет последовательные сообщения одной роли и гарантирует старт с user — runConsultant (core/consultant/engine.server.ts) срезает ведущий assistant, но соседние реплики одной роли не склеивает, теста нет

### `tests/currency.test.ts`

- одна и та же валюта — без похода в сеть, просто округляет — convertAmount в core/pricing/pricing.ts округляет без курса, но теста (с setFxProvider) нет
- API курсов недоступен и кэша ещё не было — null, а не исходное число — convertAmount (core/pricing/pricing.ts) ловит сбой и отдаёт null, теста с упавшим FxProvider нет
- API недоступен, но есть кэш — считает по устаревшему курсу, не по null — в v2 при сбое API устаревший курс из памяти не используется — convertAmount (core/pricing/pricing.ts) отдаёт null, теста нет

### `tests/datetime.test.ts`

- отрицательное смещение (США, UTC-5) — позже полуночи UTC того же числа — zonedDayToUtc (core/export/csv.ts) не проверен на поясе с отрицательным смещением и летнем времени
- полночь и 31 августа 23:59:59 Алматы попадают в один и тот же UTC-час — граница не рвёт сутки пополам — стык соседних суток в zonedDayToUtc (core/export/csv.ts) без пропуска и нахлёста не проверен

### `tests/delivery-message.test.ts`

- ставит приписку продавца последним абзацем — приписки продавца к сообщению о выдаче в v2 нет — channels/zernio/deliver.ts пишет фиксированный текст
- без приписки отправляет текст по умолчанию — приписки продавца к сообщению о выдаче в v2 нет — channels/zernio/deliver.ts пишет фиксированный текст
- срок жизни ссылок берётся из кода, а не из текста продавца — срок «7 дней» зашит строкой в channels/zernio/deliver.ts, теста на текст выдачи в переписке нет (срок проверен только в письме mail.test.ts)
- вариант с кнопкой на страницу файлов тоже несёт приписку — в Direct v2 выдаёт ссылки прямо в переписку, кнопки на страницу файлов и приписки нет (channels/zernio/deliver.ts)

### `tests/delivery-zones.test.ts`

- activeDeliveryZones возвращает зоны по sort_order, скрытые (is_active=false) не попадают — activeDeliveryZones в core/fulfillment/fulfillment.ts фильтрует is_active и сортирует, теста нет
- activeDeliveryZones не видит зоны другого арендатора (RLS-изоляция) — tenant-isolation проверяет RLS на bots и products, на delivery_zones теста нет
- activeDeliveryZones — пустой список, если у арендатора нет ни одной зоны (фолбэк на свободный адрес) — фолбэк на свободный адрес без зон в чекауте (Telegram и shop.server.ts) тестом не проверен
- оба способа включены по умолчанию, пока ничего не настроено — fulfillmentSettings (core/fulfillment/fulfillment.ts) без теста значения по умолчанию
- самовывоз выключен явной настройкой — доставка остаётся включённой — fulfillment_pickup_enabled=false читается в fulfillmentSettings, теста нет

### `tests/direct-flow.test.ts`

- не принимает класс за номер товара — productNumberFromName требует разделитель, но тест v2 не проверяет голое «1»/«2026» без разделителя
- не принимает класс за номер товара #2 — productNumberFromKeywords на «1 класс русский язык» (тот самый случай с Тетрадью №358) в v2 не проверен
- пустые ключевые слова номера не дают — productNumberFromKeywords(null) и ключевые слова без цифр в тесте v2 не проверены
- понимает слово с кнопки на всех 4 языках — matchFulfillmentType (core/fulfillment/pure.ts) не узнаёт «Өзі алып кету» и «O‘zi olib ketish», тест v2 только на русском
- не принимает за почту то, что ею не является — extractEmail на Instagram-ник «@annavenglovskaia» и «собака мейл ру» в v2 не проверен
- на платёжном шаге принимает живые Instagram и WhatsApp media-объекты — parseZernioMessage (channels/zernio/message.ts) берёт только a.url и теряет payload.url, WhatsApp media на шаге оплаты не проверен
- не зависит от нового имени типа, если URL есть — pickReceiptAttachment в v2 отвергает незнакомый тип вложения даже с URL на шаге оплаты, теста нет

### `tests/direct-purchase.test.ts`

- забирает шаг и переводит его в processing_proof — атомарного захвата шага чека в v2 нет — attachPaymentProof (core/orders/orders.ts) проверяет статус без CAS, повтор и гонка не проверены
- второй раз забрать не даёт — шаг уже не awaiting_proof — атомарного захвата шага чека в v2 нет — attachPaymentProof (core/orders/orders.ts) проверяет статус без CAS, повтор и гонка не проверены
- не забирает шаг, на котором чек не ждут — v2 намеренно принимает чек и вне шага по свежему заказу awaiting_payment (shop.server.ts), случай без открытого заказа тестом не проверен
- из двух одновременных попыток забирает шаг ровно одна — атомарного захвата шага чека в v2 нет — attachPaymentProof (core/orders/orders.ts) проверяет статус без CAS, повтор и гонка не проверены
- на пустой корзине заказ не создаёт — placeOrder (core/orders/orders.ts) на пустой корзине тестом не проверен
- физический заказ — записывает fulfillment_type/at/address/note — живой тест физического заказа проверяет только type и address, fulfillment_at и note не проверены
- физический заказ без fulfillment (устаревший вызов) — поля остаются null — placeOrder физического товара без fulfillment тестом не проверен
- товар с двумя вариантами — createOrderFromCart создаёт две строки с верными вариантами — варианты товара в корзине и заказе v2 (core/cart, core/orders) тестом не покрыты
- товар с вариантами без выбранного варианта в корзину не попадает — addToCart товара с вариантами без выбранного варианта тестом не проверен
- недостаточный остаток — заказ не создаётся, остаток не трогается — decrementStock при нехватке на оформлении не проверен, живой тест ловит только out_of_stock в addToCart
- раскупленная вторая позиция — откатывает остаток уже списанной первой — restoreStock при частичном списании (core/fulfillment/fulfillment.ts) тестом не проверен

### `tests/direct-receipt-download.test.ts`

- authenticates WhatsApp media and adds the receiving account — downloadAttachment (channels/zernio/api.server.ts) ставит ключ Zernio, но accountId к медиа WhatsApp не добавляет, теста нет
- does not duplicate an accountId already present in the Zernio URL — добавления accountId к ссылке медиа WhatsApp в v2 нет (downloadAttachment), нет и теста

### `tests/direct-reply.test.ts`

- does not mark an answer as sent when Zernio rejects it — reply() в channels/zernio/shop.server.ts не пишет last_reply при отказе, теста на отказ транспорта нет

### `tests/fulfillment-dates.test.ts`

- считает длину обычных месяцев — daysInMonth (core/fulfillment/pure.ts) напрямую не тестируется
- учитывает високосный год для февраля — високосный февраль в daysInMonth и parseDateInput не проверен
- переносит через 29 февраля високосного года — addDaysToIso через 29 февраля не проверен
- 0 дней возвращает ту же дату — addDaysToIso с 0 дней не проверен

### `tests/fulfillment-kind.test.ts`

- нельзя добавить физический товар, когда в корзине уже цифровой — addToCart возвращает mixed_cart (core/cart/cart.ts), теста нет

### `tests/fulfillment-reminder.test.ts`

- дата получения ровно через 24 часа — на границе, ещё считается — граница ровно 24 часа в isFulfillmentReminderEligible не проверена
- дата получения прямо сейчас — уже не будущее, не напоминаем — граница «ровно сейчас» в isFulfillmentReminderEligible не проверена
- заказ в ближайшие 24 часа — напоминание отправлено и проставлено ровно один раз — sendFulfillmentReminders (core/reminders/fulfillment.ts) без живого теста
- дата получения дальше суток — заказ не трогается — sendFulfillmentReminders без живого теста
- заказ ещё не принят продавцом (awaiting_confirmation), но дата уже завтра — напоминание всё равно шлём — awaiting_confirmation есть в OPEN_PHYSICAL_STATUSES (core/reminders/fulfillment.ts), теста нет
- заказ уже выдан (delivered) — напоминание не шлём — исключение delivered в sendFulfillmentReminders тестом не проверено

### `tests/fulfillment.test.ts`

- acceptOrder переводит awaiting_confirmation в accepted — acceptPhysicalOrder (core/orders/physical-admin.ts) без теста
- acceptOrder повторно на уже принятом — alreadyAccepted, статус не меняется — повторное «Принять заказ» в acceptPhysicalOrder тестом не проверено
- acceptOrder на delivered — тоже alreadyAccepted, не пытается принять заново — acceptPhysicalOrder на delivered тестом не проверен
- acceptOrder на rejected бросает — отклонённый заказ обратно в работу не берут — acceptPhysicalOrder на rejected тестом не проверен
- advanceFulfillment проходит accepted → in_production → ready → delivered — переходы статусов физического заказа (core/orders/admin.ts) без теста
- advanceFulfillment из delivered дальше не идёт — переход из delivered (core/orders/admin.ts) без теста
- двойное нажатие: из двух одновременных advanceFulfillment ровно один продвигает статус — CAS смены статуса физического заказа не проверен
- recordPayment суммирует внесённое (задаток + остаток) — recordPayment (core/fulfillment/fulfillment.ts) с CAS без теста
- processPendingDeliveries не трогает accepted/in_production/ready — повтор выдачи через outbox не должен трогать физические заказы в работе, теста нет
- digital-заказ — всегда полная сумма, режим оплаты не смотрится вовсе — amountDueNow (core/fulfillment/fulfillment.ts) для digital без теста
- payment_mode не настроен — full по умолчанию, вся сумма — значение по умолчанию в fulfillmentSettings без теста
- deposit с мусорным deposit_percent (NaN) — откатывается на 30%, не на NaN₸ — amountDue с NaN процентом не проверен
- deposit с deposit_percent вне диапазона (150) — тоже клэмп на 30% — amountDue с процентом вне 1..100 не проверен
- recordPayment не даёт paid_amount превысить total (CHECK из MIGRATION-55) — recordPayment в v2 обрезает до total вместо отказа, теста нет

### `tests/gift-certificates.test.ts`

- нулевая сумма или нулевой номинал — скидки нет — computeGiftDiscount с нулём и отрицательной суммой не проверен
- генерирует разные коды при повторных вызовах — неповторяемость generateGiftCode не проверена

### `tests/instagram-inbox-message.test.ts`

- does not attach a message tag to a regular Direct reply — тело sendInboxMessage (channels/zernio/api.server.ts) без тега для обычного ответа не проверено

### `tests/invoices-server.test.ts`

- пустые реквизиты по умолчанию, сохраняются и читаются обратно — getPayoutRequisites по умолчанию пусто и обрезка пробелов не проверены (app/operator/billing.server.ts)
- отказывает, если реквизиты не заданы — createInvoice без реквизитов тестом не проверен
- заводит счёт, отправляет текст владельцу через callInternal, пишет журнал — живой тест выставляет счёт с deliver: false, доставка владельцу и запись в журнал не проверены
- если addPayment падает — статус откатывается, счёт остаётся подтверждаемым — откат статуса счёта при сбое записи платежа в confirmInvoice не проверен
- двойное подтверждение подряд не задваивает addPayment — живой тест отклоняет повтор, но не проверяет, что платёж записан один раз
- отменить можно только счёт без присланного чека — живой тест отменяет повторно отменённый, отмена счёта с чеком или оплаченного не проверена
- null, пока чек не прислан; signed URL, когда путь есть — ссылка на чек счёта для оператора тестом не проверена

### `tests/loyalty.test.ts`

- нулевая сумма или нулевой процент — баллов нет — computePointsEarned (core/discounts/pure.ts) отсекает 0 и минус, но теста на это нет
- нулевая сумма или нулевой баланс — скидки нет — computePointsDiscount (core/discounts/pure.ts) без теста на нулевую сумму и нулевой баланс
- без согласия сумму не трогает — согласие покупателя opts.usePoints в placeOrder (core/orders/orders.ts) — теста, что без него баллы не списываются, нет

### `tests/mini-app-catalog.test.ts`

- removes products that only belong to hidden categories — storeCatalog (core/storefront/catalog.ts) не отсекает товары только из скрытых категорий (is_visible), теста нет
- searches names, descriptions, variants and keywords across the full index — поиск витрины (storeCatalog) идёт по name/keywords/description без названий вариантов, теста нет
- treats the query as one phrase, like the bot, not AND of substrings — storeCatalog ищет фразу целиком через ilike, но теста на это нет
- keeps uncategorized products only in the unfiltered catalog — фильтр категории storeCatalog (contains category_ids) без теста
- includes products from Mini App category subtrees — storeCatalog фильтрует только по одной категории, без подкатегорий; теста нет
- shows lead time on physical products and hides it for digital — leadTimeDays на карточке витрины (routes/s.$slug.index.tsx, s.$slug.p.$id.tsx) без теста
- [Учителя-CRIT] hides language badges when the multi_language module is off — StoreProduct.languages (core/storefront/catalog.ts) не учитывает модуль multi_language — языки видны и при выключенном модуле; теста нет
- filters materials by language and keeps chips for the unfiltered set — фильтра каталога по языку материала на витрине v2 нет
- lists material files on the product page and keeps a library tab — языки файлов на странице товара и «Мои материалы» (/s/:slug/orders, miniAppOrdersFn) есть, теста нет

### `tests/mini-app-library.test.ts`

- дедуплицирует по товару, оставляя самый свежий заказ — библиотека в miniAppOrdersFn (app/storefront/storefront.functions.ts) не дедуплицирует по товару, теста нет
- исключает физические заказы — библиотека только для цифровых материалов — miniAppOrdersFn берёт только позиции с файлами, отдельной проверки физических и теста нет
- не теряет товар, купленный только в заказе старше последних 80 — miniAppOrdersFn смотрит только 30 последних заказов (listCustomerOrders(ctx, customer, 30)) — та же поломка; теста нет
- подставляет актуальное имя и обложку товара, языки материала — библиотека v2 берёт name_snapshot, без актуального имени и обложки; теста нет
- пустая история заказов — пустая библиотека, без похода за товарами — miniAppOrdersFn возвращает пустое без покупателя, теста нет

### `tests/mini-app-rate-limit.test.ts`

- limits checkout bursts independently per Telegram user — miniAppCheckoutFn (перенос корзины в бота и сообщение с корзиной) без лимита частоты на покупателя

### `tests/mini-app-regressions.test.ts`

- resets Telegram Menu Button when the module is disabled — syncMenuButton (core/tenant/telegram-webhook.server.ts) ставит default без модуля, но тест есть только на откат на v1 (migration), не на выключенный модуль
- filters catalog by material language and uses a two-column grid — фильтра каталога по языку материала на витрине v2 нет
- does not resend files for physical orders — кнопка resend скрыта для физических в «Моих заказах» (channels/telegram/handle-update.ts), но обработчик resend: вид заказа не проверяет; теста нет
- guards the delivery-language callback against a stale button, like fulfilltype:/zone: — проверка mode awaiting_delivery_lang для checkoutlang: есть (channels/telegram/handle-update.ts), теста нет
- hides Direct purchase buttons for out-of-stock products, on the card and in search results — карточка Direct прячет «В корзину» без остатка (channels/zernio/shop.server.ts), теста нет
- offers rating for delivered physical orders, unlike file resend — кнопка оценки для любого выданного заказа в «Моих заказах» (channels/telegram/handle-update.ts), теста нет
- ships a purchased-materials library, sort chips and bottom tabs — библиотека есть (/s/:slug/orders, miniAppOrdersFn), теста нет; сортировки и нижних вкладок в v2 нет

### `tests/mini-app-related.test.ts`

- товар без категории всё равно получает блок похожих — fallback на весь каталог — storeProductFn берёт весь каталог без категории (app/storefront/storefront.functions.ts), теста нет
- товар с категорией использует прежний заголовок и фильтр по категории — похожие по первой категории в storeProductFn, теста нет
- товар из скрытой категории не попадает в похожие — storeCatalog не отсекает скрытые категории, похожие их показывают; теста нет
- нет ни одного другого товара в каталоге — секция не рендерится вовсе — секция скрыта при пустом related (routes/s.$slug.p.$id.tsx), теста нет

### `tests/misc-retention.test.ts`

- pruneOperatorAuditTables удаляет старые bot_events и operator_login_attempts — bot_events проверены в retention.test.ts, pruneOperatorLoginAttempts (core/retention/retention.ts) — без теста
- pruneBroadcastRecipients удаляет получателей кампаний старше окна — pruneBroadcastRecipients (core/retention/retention.ts) без теста

### `tests/order-platform.test.ts`

- keeps Instagram and WhatsApp orders in their own channels — выдача и уведомления ветвятся по orders.platform (channels/telegram/handle-update.ts, app/admin/admin.server.ts), теста нет
- treats legacy and unknown orders as Telegram — v2 сравнивает platform !== "telegram" без нормализации — null или неизвестное уйдёт в Zernio; функции и теста нет

### `tests/orders-pure.test.ts`

- ссылка приоритетнее пути, если заданы оба — приоритет file_url над file_path в materialsForProduct (core/catalog/materials.ts) без теста
- пустой массив, если нет ни ссылки, ни пути — materialsForProduct для товара без полей — теста нет
- дописывает расширение из storagePath к человеческому имени — v2 отдаёт файл по подписанной ссылке на ключ Storage (signedFileUrl в core/orders/orders.ts, sendDocument в channels/telegram/deliver.ts) — человеческого имени файла нет, функции и теста нет
- не дублирует расширение, если оно уже есть в имени — v2 отдаёт файл по подписанной ссылке на ключ Storage (signedFileUrl в core/orders/orders.ts, sendDocument в channels/telegram/deliver.ts) — человеческого имени файла нет, функции и теста нет
- заменяет запрещённые в именах файлов символы на пробел — v2 отдаёт файл по подписанной ссылке на ключ Storage (signedFileUrl в core/orders/orders.ts, sendDocument в channels/telegram/deliver.ts) — человеческого имени файла нет, функции и теста нет
- схлопывает повторные пробелы и обрезает края — v2 отдаёт файл по подписанной ссылке на ключ Storage (signedFileUrl в core/orders/orders.ts, sendDocument в channels/telegram/deliver.ts) — человеческого имени файла нет, функции и теста нет
- обрезает слишком длинное имя до 80 символов основы — v2 отдаёт файл по подписанной ссылке на ключ Storage (signedFileUrl в core/orders/orders.ts, sendDocument в channels/telegram/deliver.ts) — человеческого имени файла нет, функции и теста нет
- подставляет запасное имя, если после очистки ничего не осталось — v2 отдаёт файл по подписанной ссылке на ключ Storage (signedFileUrl в core/orders/orders.ts, sendDocument в channels/telegram/deliver.ts) — человеческого имени файла нет, функции и теста нет
- без расширения в пути хранилища возвращает имя как есть — v2 отдаёт файл по подписанной ссылке на ключ Storage (signedFileUrl в core/orders/orders.ts, sendDocument в channels/telegram/deliver.ts) — человеческого имени файла нет, функции и теста нет

### `tests/payment-proof.test.ts`

- accepts jpeg/png/pdf with matching magic bytes — attachPaymentProof (core/orders/orders.ts) не сверяет сигнатуру файла чека; проверки и теста нет
- rejects empty files, spoofed mime types and oversized payloads — attachPaymentProof не отвергает пустой, подменённый по mime и слишком большой чек; проверки и теста нет

### `tests/pricing.test.ts`

- для Казахстана берёт ручную цену, а не основную — resolveListPrice (src/core/pricing/pricing.ts) — ручная цена страны, теста нет
- для России считает по курсу и показывает рубли — resolveListPrice (src/core/pricing/pricing.ts) — конвертация в валюту страны, теста нет
- при неизвестной стране считает по домашней стране продавца — resolveListPrice (src/core/pricing/pricing.ts) — страна не выбрана → домашняя, теста нет
- товар без цен по странам считается по курсу от основной — resolveListPrice (src/core/pricing/pricing.ts) — товар без country_prices, теста нет
- страна без реквизитов не роняет расчёт — resolveListPrice (src/core/pricing/pricing.ts) — страна без реквизитов, теста нет
- курс недоступен (convertAmount вернул null) — откатывается на базовую цену — resolveListPrice (src/core/pricing/pricing.ts) — откат при отсутствии курса, теста нет
- игнорирует ручную цену страны и конвертацию — всегда база — resolveListPrice (src/core/pricing/pricing.ts) — без multi_currency всегда база, теста нет
- подставляет цену варианта вместо базовой products.price — resolveListPrice (src/core/pricing/pricing.ts) — цена варианта, теста нет
- курс всё ещё применяется к цене варианта для другой страны — resolveListPrice (src/core/pricing/pricing.ts) — конвертация цены варианта, теста нет
- ручная цена страны (country_prices) для варианта не ищется — сознательный обход — resolveListPrice (src/core/pricing/pricing.ts) — обход ручной цены для варианта, теста нет
- без модуля multi_currency — тоже цена варианта, без конвертации — resolveListPrice (src/core/pricing/pricing.ts) — вариант без multi_currency, теста нет
- для домашней страны продавца — без конвертации — zoneFee (src/core/fulfillment/fulfillment.ts) — домашняя страна, теста нет
- для другой страны — конвертирует по курсу, а не просто меняет ярлык — zoneFee (src/core/fulfillment/fulfillment.ts) — конвертация комиссии, теста нет
- страна ещё не выбрана — считает по домашней стране продавца — zoneFee (src/core/fulfillment/fulfillment.ts) — страна не выбрана, теста нет
- страна без реквизитов — остаётся домашняя валюта, число не выдумывается — zoneFee (src/core/fulfillment/fulfillment.ts) — страна без реквизитов, теста нет
- курс недоступен (convertAmount вернул null) — откатывается на домашнюю валюту — zoneFee (src/core/fulfillment/fulfillment.ts) — откат при отсутствии курса, теста нет
- без модуля multi_currency — всегда домашняя валюта, независимо от страны — zoneFee (src/core/fulfillment/fulfillment.ts) — без multi_currency, теста нет

### `tests/product-materials.test.ts`

- не путает языки — включая новые en/uz, не только ru/kk — materialsForProduct проверен только на ru/kk, en/uz без теста
- у товара без файлов не выдумывает материал — materialsForProduct({}) и null — теста нет
- считает так же, как снимок, по всем 4 языкам — productSellable проверен только на file_path; uz-only и строка без пути — без теста
- откатывается на старые ru/kk снимки, если карты по языкам нет — itemMaterials (core/orders/pure.ts) не читает material_files_snapshot/material_files_kz_snapshot — старые заказы без карты по языкам не выдадутся; теста нет
- откатывается на совсем старые одиночные *_snapshot-колонки — откат itemMaterials на file_*_snapshot есть, теста нет
- en/uz не имеют legacy-отката — пусто, если карты по языкам нет — itemMaterials для en/uz без карты — теста нет
- берёт первый непустой язык по порядку ru→kk→en→uz — порядок языков itemLanguages (core/orders/pure.ts) без теста
- пусто, если ни в одном языке ничего нет — itemLanguages для позиции без файлов — теста нет

### `tests/receipt-ocr-auto.test.ts`

- без ключа и с true — автопроверка включена — receiptOcrAutoEnabled в src/core/receipts/verify.server.ts (нет ключа — включено) без теста
- явное false выключает автопроверку — receiptOcrAutoEnabled в src/core/receipts/verify.server.ts (false выключает) без теста
- тумблер включён — читаем чек даже без proof_auto (KZ до кнопки реквизитов) — вход в OCR по тумблеру в handle-update.ts и zernio/shop.server.ts без теста
- тумблер выключен и нет proof_auto — обычный заказ, OCR нет — вход в OCR по тумблеру в handle-update.ts и zernio/shop.server.ts без теста
- без ключа и с true — автопроверка включена #2 — receiptOcrAutoEnabled в src/core/receipts/verify.server.ts (нет ключа — включено) без теста
- явное false выключает автопроверку #2 — receiptOcrAutoEnabled в src/core/receipts/verify.server.ts (false выключает) без теста

### `tests/receipt-verify.test.ts`

- переплата на 30% проходит — граница ровно +30% в findMatchingAmount (src/core/receipts/pure.ts) не проверена
- константы соответствуют документированным значениям — UNDERPAY_TOLERANCE/OVERPAY_TOLERANCE в src/core/receipts/pure.ts без теста
- если в чеке ожидаемая валюта — берём её, даже когда рядом другая — detectReceiptCurrencies и правило «своя валюта есть — не конфликт» в src/core/receipts/pure.ts без теста
- только чужая валюта — возвращаем её — detectReceiptCurrencies в src/core/receipts/pure.ts без теста
- нет маркеров — null — detectReceiptCurrencies в src/core/receipts/pure.ts без теста
- чек без упоминания какой-либо валюты — не конфликт (доверяем сумме, как раньше) — analyzeReceiptText без валюты в тексте не проверен
- валюта вне списка известных — не блокируем — analyzeReceiptText с валютой вне CURRENCY_MARKERS не проверен
- без ожидаемой валюты — не проверяем вообще — analyzeReceiptText без currency не проверен
- одинаковые байты — одинаковый хеш — sha256 чека считается внутри verifyReceipt (verify.server.ts), теста нет
- разные байты — разный хеш — sha256 чека считается внутри verifyReceipt (verify.server.ts), теста нет
- успешный чек с оговоркой «в случае ошибки» не считается отказом — looksLikeFailedPayment на успешном чеке с оговоркой не проверен
- payment_failed просим переслать, а не кладём в ручную выдачу — isRetryReason в src/core/receipts/pure.ts без теста
- случайный текст без маркеров — не похоже — looksLikeReceipt на длинном тексте без маркеров не проверен (в тесте только короткое «привет»)
- карточка товара с «в корзине» — не чек, даже если сумма та же — looksLikeShopScreenNotReceipt на карточке товара («в корзине») не проверен
- настоящий чек не режется, даже если сверху попал текст бота — смешанный текст (скрин бота + фискальный чек) в looksLikeShopScreenNotReceipt не проверен
- ВТБ: сумма операции 228 ₽ и выплата 1101.24 KZT, не телефон и не дата — extractMoneyAmounts на чеке ВТБ (1101.24 KZT и 228 ₽) не проверен
- Сбер: сумма в местной валюте 1077.30 KZT — extractMoneyAmounts на «сумма в местной валюте» не проверен
- Сбер: 661.50 и 1072.58 KZT тоже читаются — extractMoneyAmounts на «сумма в местной валюте» не проверен
- голое 1900 тоже сумма, не год — extractMoneyAmounts на сумме без валюты («Оплата 1900») не проверен
- экран «Платёж выполнен» 227 ₽ — extractMoneyAmounts на 227 ₽ с телефоном рядом не проверен
- на смешанном чеке в KZT остаётся выплата, не рубли — amountsForCurrency на смешанном чеке KZT/RUB не проверен
- чек уже принят по другому заказу — receipt_reused, автовыдачи нет — verifyReceipt в src/core/receipts/verify.server.ts без теста (receipt_reused)
- чек новый (нет совпадения по хешу) — автовыдача, proofHash в результате — verifyReceipt в src/core/receipts/verify.server.ts без теста (хеш чека в результате)
- успешный чек с фразой «в случае ошибки» — автовыдача — analyzeReceiptText на успешном чеке с «в случае ошибки» не проверен
- чек с тенге и рублями — находит 1101.24 KZT под заказ 1100 ₸ — analyzeReceiptText на смешанном чеке KZT/RUB не проверен
- на экране только 227 ₽ — переводим заказ 1100 ₸ и принимаем — v2 не переводит сумму заказа по курсу, чек в чужой валюте уходит в currency_mismatch (src/core/receipts/pure.ts), кода и теста нет
- Сбер «местная валюта» 1077.30 KZT на заказ 228 ₽ — принимаем (спред банка ~10%) — v2 не переводит сумму заказа по курсу, чек в чужой валюте уходит в currency_mismatch (src/core/receipts/pure.ts), кода и теста нет
- Сбер 661.50 KZT на заказ 152 ₽ — ~17% ниже mid-market, в допуске ±30% — v2 не переводит сумму заказа по курсу, чек в чужой валюте уходит в currency_mismatch (src/core/receipts/pure.ts), кода и теста нет
- Сбер ~50% ниже mid-market — всё ещё к продавцу — v2 не переводит сумму заказа по курсу, чек в чужой валюте уходит в currency_mismatch (src/core/receipts/pure.ts), кода и теста нет
- скрин карточки товара вместо чека — не принимаем — analyzeReceiptText на карточке товара не проверен
- чек в другой валюте — переводим сумму заказа и сверяем — v2 не переводит сумму заказа по курсу, чек в чужой валюте уходит в currency_mismatch (src/core/receipts/pure.ts), кода и теста нет
- чек в другой валюте, сумма после курса не сошлась — amount_mismatch — v2 не переводит сумму заказа по курсу, чек в чужой валюте уходит в currency_mismatch (src/core/receipts/pure.ts), кода и теста нет
- PDF идёт в files:annotate и проходит ту же сверку суммы — verifyReceipt в src/core/receipts/verify.server.ts без теста (PDF через files:annotate и текст из PDF)
- картинка по-прежнему идёт в images:annotate — verifyReceipt в src/core/receipts/verify.server.ts без теста (картинка через images:annotate)

### `tests/reviews-server.test.ts`

- возвращает уникальные товары доставленного заказа этого покупателя — reviewableProductsForOrder (src/core/reviews/reviews.ts) проверен только на одной позиции, повторы не проверены
- чужой заказ или недоставленный — пустой список — reviewableProductsForOrder на чужом и недоставленном заказе не проверен
- updateReviewComment для несуществующей оценки — false, без побочных эффектов — saveComment (src/core/reviews/reviews.ts) вернёт true, если оценки нет, теста нет

### `tests/reviews.test.ts`

- округляет и не выходит за границы 1..5 — starsForRating проверен только сверху (9), округление и нижняя граница нет

### `tests/robokassa.test.ts`

- считает обычный MD5 в hex, как ждёт Robokassa — md5Hex не сверяется с известным хешем, тест v2 считает ожидание той же функцией
- IsTest=1 только когда явно попросили — buildPaymentUrl проверен только с testMode=true, IsTest=0 не проверен
- отклоняет, если сумма в подписи не совпадает с переданной — verifyResultSignature с другой суммой не проверен
- учитывает Shp_-параметры отсортированными по ключу, как того требует протокол — сортировка нескольких Shp_ в verifyResultSignature не проверена (в тесте один Shp_bot)
- NaN от нечислового OutSum не считается прошедшей проверку суммы — сверка суммы в src/routes/api/robokassa.$botId.$action.ts без теста

### `tests/smart-search.test.ts`

- пустой список ids — пустой результат — parseSmartSearchIds на пустом массиве ids не проверен
- digital (умолчание, VERTICAL не задан) — промпт про учебные материалы — domainHint/buildPrompt в src/core/search/smart-pure.ts без теста
- confectionery — промпт про торты и десерты — domainHint/buildPrompt в src/core/search/smart-pure.ts без теста
- consultant — промпт про прайс, не учебные материалы — domainHint/buildPrompt в src/core/search/smart-pure.ts без теста

### `tests/telegram-webapp-init-data.test.ts`

- читает tgWebAppData из hash Mini App — v2 берёт initData только из Telegram.WebApp (useTelegramWebApp в src/app/storefront/cart.tsx), запасного чтения launch params нет, теста нет
- читает tgWebAppData из query string — v2 берёт initData только из Telegram.WebApp (useTelegramWebApp в src/app/storefront/cart.tsx), запасного чтения launch params нет, теста нет
- собирает значение, если внутренний query не закодирован целиком — v2 берёт initData только из Telegram.WebApp (useTelegramWebApp в src/app/storefront/cart.tsx), запасного чтения launch params нет, теста нет
- пустой hash — пустая строка — v2 берёт initData только из Telegram.WebApp (useTelegramWebApp в src/app/storefront/cart.tsx), запасного чтения launch params нет, теста нет
- берёт tgWebAppData из JSON, который пишет telegram-web-app.js — v2 берёт initData только из Telegram.WebApp (useTelegramWebApp в src/app/storefront/cart.tsx), запасного чтения launch params нет, теста нет
- игнорирует битый JSON — v2 берёт initData только из Telegram.WebApp (useTelegramWebApp в src/app/storefront/cart.tsx), запасного чтения launch params нет, теста нет
- разбирает сохранённый hash+search — v2 берёт initData только из Telegram.WebApp (useTelegramWebApp в src/app/storefront/cart.tsx), запасного чтения launch params нет, теста нет
- предпочитает SDK, затем capture, затем hash — v2 берёт initData только из Telegram.WebApp (useTelegramWebApp в src/app/storefront/cart.tsx), запасного чтения launch params нет, теста нет
- захватывает launch params до SDK и не просит закрыть окно — v2 берёт initData только из Telegram.WebApp (useTelegramWebApp в src/app/storefront/cart.tsx), запасного чтения launch params нет, теста нет

### `tests/tenant-isolation.test.ts`

- ключ арендатора видит только свои заказы — изоляция orders под tenantDb в живом тесте v2 не проверяется, есть только bots/products/app_settings
- ключ арендатора видит только своих покупателей — изоляция bot_users под tenantDb в живом тесте v2 не проверяется
- служебные таблицы панели арендатору недоступны — закрытость bot_events, operator_broadcasts, operator_login_attempts для роли арендатора в v2 не проверяется
- подделанная подпись не принимается — jwt.test.ts проверяет подпись только локально (verifyTenantJwt), отказ базы на поддельный ключ не проверяется

### `tests/web-storefront-handoff.test.ts`

- совпадает с форматом deep link — префикс wc_ (HANDOFF_PREFIX в core/storefront/handoff.ts) и разбор его в handle-update.ts тестом не закреплены
- quantity по умолчанию 1 в типе — parseHandoffItems (core/storefront/handoff.ts) подставляет 1 и режет 1..99, теста нет

### `tests/whatsapp-activation.test.ts`

- restarts Instagram on /start so a CMD «Купить» button wakes the shop — postback /start от кнопки автоматизации (normalizeDmButtons ставит его по умолчанию) в handlePostback (shop.server.ts) уходит в default → question, магазин не открывается, теста нет
- treats a hidden /start payload as start even when the chat shows «купить» — скрытый payload /start кнопки CMD в handlePostback (shop.server.ts) не распознаётся как старт, теста нет
- treats a CMD payload that is itself a trigger word as start — postback со словом-вызовом не сверяется с triggers в handlePostback (shop.server.ts), теста нет
- ignores native Zernio ACT:: buttons and ordinary chat — чужой postback ACT:: уходит в default ветку handlePostback (shop.server.ts) → question, теста нет

### `tests/whatsapp-broadcast-audience.test.ts`

- без списка исключений отдаёт всех подряд — resolveWhatsAppAudience (core/broadcasts/broadcasts.ts) без списка исключений не проверяется, живой тест всегда задаёт список

### `tests/whatsapp-catalog.test.ts`

- корень разбирается в parentId = null — CAT:<id>:<offset> разбирается прямо в handlePostback (shop.server.ts), пустой id корня передаётся как "", не null; теста нет
- категория и смещение читаются как есть — разбор CAT:<id>:<offset> в handlePostback (shop.server.ts) без теста
- отсутствующее или битое смещение — это ноль, а не NaN — Number(b)\|\|0 в handlePostback (shop.server.ts) пропускает отрицательное смещение, теста нет
- чужие постбэки не перехватываются — разбор postback в handlePostback (shop.server.ts) по head без теста
- «Назад» из категории ведёт к её родителю, а не к ней самой — в v2 «Назад» из раздела шлёт CATALOG (в корень, shop.server.ts), к родителю не ведёт; теста нет
- страница оставляет место под «Назад» и «Ещё» — WA_LIST_PAGE = WA_LIST_MAX_ROWS - 3 (shop-flow.ts), теста, что навигация не вытесняет товары, нет
- короткому названию описание — просто цена — в списке WhatsApp описание строки — только цена (shop.server.ts), функции rowSubtitle и теста нет
- длинное название продолжается в описании — там товары и расходятся — хвост длинного названия в описание строки WhatsApp не переносится (shop.server.ts ставит только цену), похожие товары неразличимы
- цена дописывается, когда остаётся место — rowSubtitle в v2 нет, описание строки — только цена
- не влезает вместе — хвост названия важнее цены — rowSubtitle в v2 нет, хвост названия в описание не попадает

### `tests/zernio-account-disconnected.test.ts`

- уведомляет продавца по всем адресам из admin_chat_id — handleAccountDisconnected (channels/zernio/handle-account.ts) без теста
- без настроенного admin_chat_id ничего не отправляет — handleAccountDisconnected (channels/zernio/handle-account.ts) без теста
- не повторяет уведомление о том же аккаунте раньше шести часов — кулдаун zernio_disconnect_notified в handle-account.ts без теста
- другой аккаунт уведомляется даже пока первый ещё в кулдауне — кулдаун по аккаунту в handle-account.ts без теста

### `tests/zernio-base-url.test.ts`

- calls the JSON API even when Vercel contains only the Zernio host — что запросы (connect.server.ts, api.server.ts) идут по нормализованному адресу, тестом не проверено
- reports a useful configuration error for an HTML response — ошибка «Проверьте ZERNIO_BASE_URL» на HTML-ответ в api.server.ts без теста

### `tests/zernio-inbox-order.test.ts`

- ответ от новых к старым разворачивается в хронологический — сортировка переписки по времени в api.server.ts без теста
- ответ уже в хронологическом порядке не портится — сортировка переписки по времени в api.server.ts без теста
- последним оказывается самое свежее — его и проверяет защита — что последним в переписке идёт самое свежее (api.server.ts) для защиты менеджера, тестом не проверено

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
