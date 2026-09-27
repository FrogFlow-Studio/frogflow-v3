# Готовность v2 по описи v1

Собирается командой `node scripts/readiness.ts` из `docs/inherited-knowledge.md`
и `docs/readiness.json` — руками не правится. `npm test` падает, если сводка
устарела, пункт описи назван неверно или указанного теста нет.

**Готовность для первых клиентов: 98 %** — покрыто тестами v2
751 из 766 нужных сейчас пунктов.

**Путь заказа: 99,1 %** — 337 из 340
(каталог, цена, оформление, оплата и чек, выдача; файлы — `ORDER_PATH` в скрипте).

| всего | покрыто | из них живыми тестами | дыра | позже | не нужно в v2 |
| ----- | ------- | --------------------- | ---- | ----- | ------------- |
| 1125 | 751 | 49 | 15 | 2 | 357 |

«Позже» — поведение нужно, но не магазинам, которые переезжают первыми
(модуль ещё не перенесён). «Не нужно в v2» — поведение убрано или заменено;
причина записана в `docs/readiness.json`.

## По файлам описи

| файл v1 | всего | покрыто | дыра | позже | не нужно | готовность |
| ------- | ----- | ------- | ---- | ----- | -------- | ---------- |
| поломки v1 (fix) | 51 | 15 | 8 | 0 | 28 | 65,2 % |
| `src/lib/comment-dm-fallback.test.ts` | 29 | 29 | 0 | 0 | 0 | 100 % |
| `src/lib/consultant/bovi-features.test.ts` | 7 | 0 | 0 | 0 | 7 | — |
| `src/lib/cron-auth.test.ts` | 7 | 5 | 0 | 0 | 2 | 100 % |
| `src/lib/csv.test.ts` | 14 | 14 | 0 | 0 | 0 | 100 % |
| `src/lib/error-message.test.ts` | 9 | 9 | 0 | 0 | 0 | 100 % |
| `src/lib/internal/internal-api.test.ts` | 8 | 0 | 0 | 0 | 8 | — |
| `src/lib/logger.test.ts` | 9 | 9 | 0 | 0 | 0 | 100 % |
| `src/lib/manager-chat.test.ts` | 6 | 6 | 0 | 0 | 0 | 100 % |
| `src/lib/modules/registry.test.ts` | 1 | 0 | 1 | 0 | 0 | 0 % |
| `src/lib/modules/require-module.test.ts` | 8 | 8 | 0 | 0 | 0 | 100 % |
| `src/lib/operator/env-block.test.ts` | 7 | 0 | 0 | 0 | 7 | — |
| `src/lib/operator/leads-pipeline.test.ts` | 46 | 0 | 0 | 0 | 46 | — |
| `src/lib/operator/subscription-cron.test.ts` | 9 | 9 | 0 | 0 | 0 | 100 % |
| `src/lib/operator/subscriptions.test.ts` | 13 | 13 | 0 | 0 | 0 | 100 % |
| `src/lib/tenant-storage-key.test.ts` | 5 | 4 | 1 | 0 | 0 | 80 % |
| `src/lib/verticals/vertical.test.ts` | 13 | 9 | 0 | 0 | 4 | 100 % |
| `src/lib/vip-subscriptions.test.ts` | 9 | 8 | 0 | 0 | 1 | 100 % |
| `tests/admin-order-notify.test.ts` | 6 | 5 | 0 | 0 | 1 | 100 % |
| `tests/ai-usage.test.ts` | 5 | 3 | 0 | 0 | 2 | 100 % |
| `tests/analytics.test.ts` | 16 | 16 | 0 | 0 | 0 | 100 % |
| `tests/bot-order-placement.test.ts` | 4 | 4 | 0 | 0 | 0 | 100 % |
| `tests/bot-user-claim.test.ts` | 1 | 0 | 0 | 0 | 1 | — |
| `tests/broadcast-audience.test.ts` | 6 | 6 | 0 | 0 | 0 | 100 % |
| `tests/broadcast-create.test.ts` | 3 | 3 | 0 | 0 | 0 | 100 % |
| `tests/cart-reminder.test.ts` | 5 | 5 | 0 | 0 | 0 | 100 % |
| `tests/category-tree.test.ts` | 3 | 0 | 2 | 1 | 0 | 0 % |
| `tests/confectioner-admin.test.ts` | 16 | 16 | 0 | 0 | 0 | 100 % |
| `tests/consultant-1c-price.test.ts` | 8 | 0 | 0 | 0 | 8 | — |
| `tests/consultant-ask-manager.test.ts` | 4 | 1 | 0 | 0 | 3 | 100 % |
| `tests/consultant-broad-answer.test.ts` | 10 | 0 | 0 | 0 | 10 | — |
| `tests/consultant-cache-cost.test.ts` | 16 | 3 | 0 | 0 | 13 | 100 % |
| `tests/consultant-catalog-match.test.ts` | 16 | 0 | 0 | 0 | 16 | — |
| `tests/consultant-dialogues.test.ts` | 27 | 0 | 0 | 0 | 27 | — |
| `tests/consultant-discontinued.test.ts` | 13 | 0 | 0 | 0 | 13 | — |
| `tests/consultant-doc-text.test.ts` | 7 | 0 | 0 | 0 | 7 | — |
| `tests/consultant-finkaz-rate.test.ts` | 8 | 0 | 0 | 0 | 8 | — |
| `tests/consultant-knowledge-search.test.ts` | 4 | 1 | 0 | 0 | 3 | 100 % |
| `tests/consultant-manager-guard.test.ts` | 8 | 8 | 0 | 0 | 0 | 100 % |
| `tests/consultant-notify-recipients.test.ts` | 6 | 6 | 0 | 0 | 0 | 100 % |
| `tests/consultant-run-insert.test.ts` | 3 | 0 | 0 | 0 | 3 | — |
| `tests/consultant-settings-write.test.ts` | 4 | 4 | 0 | 0 | 0 | 100 % |
| `tests/consultant-style-budget.test.ts` | 16 | 0 | 0 | 0 | 16 | — |
| `tests/consultant-usage-stats.test.ts` | 4 | 1 | 0 | 0 | 3 | 100 % |
| `tests/consultant-vtb-rate.test.ts` | 12 | 0 | 0 | 0 | 12 | — |
| `tests/consultant.test.ts` | 73 | 15 | 0 | 0 | 58 | 100 % |
| `tests/currency.test.ts` | 4 | 4 | 0 | 0 | 0 | 100 % |
| `tests/datetime.test.ts` | 5 | 5 | 0 | 0 | 0 | 100 % |
| `tests/delivery-message.test.ts` | 4 | 3 | 0 | 0 | 1 | 100 % |
| `tests/delivery-zones.test.ts` | 5 | 5 | 0 | 0 | 0 | 100 % |
| `tests/direct-flow.test.ts` | 57 | 57 | 0 | 0 | 0 | 100 % |
| `tests/direct-purchase.test.ts` | 14 | 14 | 0 | 0 | 0 | 100 % |
| `tests/direct-receipt-download.test.ts` | 3 | 3 | 0 | 0 | 0 | 100 % |
| `tests/direct-reply.test.ts` | 2 | 2 | 0 | 0 | 0 | 100 % |
| `tests/fulfillment-dates.test.ts` | 10 | 10 | 0 | 0 | 0 | 100 % |
| `tests/fulfillment-kind.test.ts` | 5 | 5 | 0 | 0 | 0 | 100 % |
| `tests/fulfillment-reminder.test.ts` | 10 | 10 | 0 | 0 | 0 | 100 % |
| `tests/fulfillment.test.ts` | 18 | 18 | 0 | 0 | 0 | 100 % |
| `tests/gift-certificates.test.ts` | 5 | 5 | 0 | 0 | 0 | 100 % |
| `tests/instagram-inbox-message.test.ts` | 1 | 1 | 0 | 0 | 0 | 100 % |
| `tests/invoices-server.test.ts` | 11 | 11 | 0 | 0 | 0 | 100 % |
| `tests/loyalty.test.ts` | 7 | 7 | 0 | 0 | 0 | 100 % |
| `tests/manual-order.test.ts` | 8 | 8 | 0 | 0 | 0 | 100 % |
| `tests/mini-app-auth.test.ts` | 4 | 3 | 0 | 0 | 1 | 100 % |
| `tests/mini-app-catalog.test.ts` | 13 | 7 | 2 | 1 | 3 | 77,7 % |
| `tests/mini-app-library.test.ts` | 5 | 5 | 0 | 0 | 0 | 100 % |
| `tests/mini-app-rate-limit.test.ts` | 5 | 1 | 0 | 0 | 4 | 100 % |
| `tests/mini-app-regressions.test.ts` | 27 | 11 | 1 | 0 | 15 | 91,6 % |
| `tests/mini-app-related.test.ts` | 4 | 4 | 0 | 0 | 0 | 100 % |
| `tests/mini-app-text.test.ts` | 2 | 0 | 0 | 0 | 2 | — |
| `tests/mini-app-validation.test.ts` | 4 | 1 | 0 | 0 | 3 | 100 % |
| `tests/misc-retention.test.ts` | 3 | 3 | 0 | 0 | 0 | 100 % |
| `tests/order-files-page.test.ts` | 8 | 1 | 0 | 0 | 7 | 100 % |
| `tests/order-platform.test.ts` | 4 | 4 | 0 | 0 | 0 | 100 % |
| `tests/orders-pure.test.ts` | 11 | 11 | 0 | 0 | 0 | 100 % |
| `tests/payment-proof.test.ts` | 2 | 2 | 0 | 0 | 0 | 100 % |
| `tests/pricing.test.ts` | 20 | 20 | 0 | 0 | 0 | 100 % |
| `tests/product-materials.test.ts` | 25 | 25 | 0 | 0 | 0 | 100 % |
| `tests/promo-codes.test.ts` | 4 | 4 | 0 | 0 | 0 | 100 % |
| `tests/receipt-audit.test.ts` | 20 | 20 | 0 | 0 | 0 | 100 % |
| `tests/receipt-ocr-auto.test.ts` | 6 | 6 | 0 | 0 | 0 | 100 % |
| `tests/receipt-verify.test.ts` | 51 | 50 | 0 | 0 | 1 | 100 % |
| `tests/reviews-server.test.ts` | 4 | 4 | 0 | 0 | 0 | 100 % |
| `tests/reviews.test.ts` | 6 | 6 | 0 | 0 | 0 | 100 % |
| `tests/robokassa.test.ts` | 11 | 11 | 0 | 0 | 0 | 100 % |
| `tests/smart-search.test.ts` | 14 | 12 | 0 | 0 | 2 | 100 % |
| `tests/telegram-init-data.test.ts` | 3 | 3 | 0 | 0 | 0 | 100 % |
| `tests/telegram-webapp-init-data.test.ts` | 9 | 9 | 0 | 0 | 0 | 100 % |
| `tests/tenant-isolation.test.ts` | 7 | 7 | 0 | 0 | 0 | 100 % |
| `tests/vip-flow.test.ts` | 24 | 24 | 0 | 0 | 0 | 100 % |
| `tests/web-storefront-handoff.test.ts` | 2 | 2 | 0 | 0 | 0 | 100 % |
| `tests/whatsapp-activation.test.ts` | 12 | 4 | 0 | 0 | 8 | 100 % |
| `tests/whatsapp-broadcast-audience.test.ts` | 3 | 3 | 0 | 0 | 0 | 100 % |
| `tests/whatsapp-catalog.test.ts` | 14 | 14 | 0 | 0 | 0 | 100 % |
| `tests/whatsapp-contact-exclusions.test.ts` | 3 | 3 | 0 | 0 | 0 | 100 % |
| `tests/zernio-account-disconnected.test.ts` | 4 | 4 | 0 | 0 | 0 | 100 % |
| `tests/zernio-automation-body.test.ts` | 8 | 8 | 0 | 0 | 0 | 100 % |
| `tests/zernio-base-url.test.ts` | 5 | 5 | 0 | 0 | 0 | 100 % |
| `tests/zernio-idempotency.test.ts` | 6 | 6 | 0 | 0 | 0 | 100 % |
| `tests/zernio-inbox-order.test.ts` | 3 | 3 | 0 | 0 | 0 | 100 % |
| `tests/zernio-inbox-shape.test.ts` | 2 | 2 | 0 | 0 | 0 | 100 % |
| `tests/zernio-logs-retention.test.ts` | 2 | 2 | 0 | 0 | 0 | 100 % |
| `tests/zernio-message.test.ts` | 17 | 17 | 0 | 0 | 0 | 100 % |
| `tests/zernio-post-ids.test.ts` | 9 | 9 | 0 | 0 | 0 | 100 % |
| `tests/zernio-retry.test.ts` | 2 | 2 | 0 | 0 | 0 | 100 % |
| `tests/zernio-webhook.test.ts` | 13 | 10 | 0 | 0 | 3 | 100 % |

## Дыры (15)

### поломки v1

- fix(consultant): notify every manager listed, and say who did not get it — adminRecipients (core/notify/recipients.ts) шлёт владельцу и всем admin_chat_id без дублей, но теста нет; тест-кнопки с отчётом кто не получил нет
- fix(zernio): read the last hundred messages of a conversation, not the first — listConversationMessages (channels/zernio/api.server.ts) просит sortOrder=desc и сортирует сам, теста нет
- fix(consultant): say which build is live and what the manager check saw — /api/health отдаёт commit и branch, пауза пишется итогом в zernio_logs (handle-message.ts), тестов нет
- fix(consultant): bill the cached prompt, and hold the cache for an hour — engine.server.ts считает cache_creation и cache_read в расход, но теста нет; TTL кеша 5 минут
- fix(instagram): resolve build type error and fully customize comment-to-dm buttons — кнопки второго сообщения задаёт продавец (automations.server.ts), но тест не проверяет, что уходят именно его кнопки
- fix(consultant): pass customer_contact to dynamic prompt context — engine.server.ts кладёт state.contact в данные диалога, теста нет
- fix(consultant): fix looksLikeConsultantBotReply empty snippet bug that dropped all incoming messages — findManagerMessage отбрасывает пустые ourReplies (filter(Boolean)), но теста с пустой репликой бота нет
- fix(consultant): prevent duplicate replies and handle affirmative responses like 'интересует' — «интересует» есть в AFFIRMATIVES (channels/zernio/shop-flow.ts), но тест classifyIncoming его не проверяет

### `src/lib/modules/registry.test.ts`

- нашёл хотя бы один платный доступный модуль для проверки — в v2 нет теста, что каждый платный доступный модуль реестра проверяется гейтом (core/modules/registry.ts)

### `src/lib/tenant-storage-key.test.ts`

- пропускает ключ без префикса — файлы, залитые до этой правки — выдача покупателю закрыта (src/core/storage/keys.test.ts › пропускает ключ без префикса — файлы v1, залитые до разметки ключей); isTenantStorageKey в админке v2 старые чеки и файлы v1 без префикса по-прежнему не откроет

### `tests/category-tree.test.ts`

- defaults to the bot-like tree of root folders — витрина /s/<slug> показывает только корневые категории (src/routes/s.$slug.index.tsx), теста нет
- shows children after opening a main category — витрина v2 не показывает подкатегории и фильтр по категории не включает потомков (src/core/storefront/catalog.ts)

### `tests/mini-app-catalog.test.ts`

- shows lead time on physical products and hides it for digital — расхождение: на странице товара (routes/s.$slug.p.$id.tsx) срок изготовления показывается при любом leadTimeDays, в том числе у цифрового; у физического с 0 дней карточка пишет «Товар», а не «В наличии»; разметка в JSX без тестов
- lists material files on the product page and keeps a library tab — расхождение: список файлов на странице товара есть (src/core/storefront/product-files.test.ts), вкладки «Материалы» нет — библиотека на /s/:slug/orders

### `tests/mini-app-regressions.test.ts`

- ships a purchased-materials library, sort chips and bottom tabs — расхождение: библиотека есть (/s/:slug/orders, miniAppOrdersFn), но сортировки каталога и нижних вкладок в v2 нет
