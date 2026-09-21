# Инвентарь схемы Postgres/Supabase FrogFlow (состояние «как в проде сейчас»)

Источники: `src/integrations-supabase/types.ts` (интроспекция живой базы через PostgREST + ручные дописки), `COMPLETE-SETUP.sql`, `setup-database.sql`, `setup-storage.sql`, `setup-rls-policies.sql`, `PATCH-*.sql`, `MIGRATION-00 … MIGRATION-70`, `MIGRATION-README.md`, `ANALYSIS.md`.

**Каталога `supabase/` в репозитории нет** — миграции не через Supabase CLI, а нумерованные `.sql` в корне, применяются вручную (SQL Editor) либо `node scripts/apply-migration.mjs <файл>` через Management API. Типы подтягиваются `node scripts/sync-db-types.mjs` (дописывает только колонки уже известных таблиц; новые таблицы в `types.ts` заводят руками — отсюда комментарии «ручной патч» в файле).

Проект Supabase: `fnwksbasxakktscdjlfp`. PostgREST 14.5.

---

## 0. Краткая карта (43 таблицы в `public`)

| Домен | Таблицы |
|---|---|
| Тенанты / control-plane | `bots`, `bot_events`, `bot_health_snapshots`, `module_requests`, `admin_login_attempts`, `operator_login_attempts`, `operator_broadcasts`, `operator_settings`, `subscription_payments`, `subscription_invoices`, `app_settings` |
| Каталог | `categories`, `products`, `product_images`, `product_variants`, `product_material_files`, `product_reviews` |
| Заказы / корзина | `orders`, `order_items`, `order_counters`, `cart_items`, `web_cart_handoffs`, `delivery_zones`, `promo_codes`, `gift_certificates`, `referrals` |
| Покупатели | `bot_users`, `blocked_users`, `manager_chat_state`, `manager_chat_messages` |
| Оплата | `payment_methods` |
| VIP | `vip_tariffs`, `vip_subscriptions`, `vip_member_profiles` |
| Рассылки | `broadcasts`, `broadcast_recipients`, `whatsapp_templates` |
| Консультант / AI | `consultant_message_runs`, `consultant_handoffs`, `consultant_catalog_imports`, `story_product_tags` |
| Instagram / WhatsApp / Zernio | `zernio_logs`, `comment_dm_fallback_sends`, `comment_automation_settings`, **+ легаси**: `zernio_automations`, `ig_keywords`, `ig_watched_posts`, `ig_poll_runs`, `ig_exclusions`, `ig_comment_actions`, `ig_post_leads` |
| Отдел продаж самой FrogFlow | `sales_leads`, `sales_lead_events` |

**Тенантный ключ — везде `bot_id UUID → bots(id) ON DELETE CASCADE`.** Никакого `tenant_id`/`organization_id` в схеме нет. Исключения (платформенные таблицы без `bot_id`): `operator_login_attempts`, `operator_broadcasts`, `operator_settings`, `sales_leads`, `sales_lead_events`. Плюс `payment_methods` — у неё `bot_id` есть, но в `types.ts` не описаны FK/Relationships.

---

## 1. Таблицы по доменам

Обозначения: `PK` — первичный ключ, `NN` — NOT NULL, `D:` — DEFAULT. Nullability взята из `Row` в `types.ts` (это отражение `required` из OpenAPI PostgREST живой базы), типы и DEFAULT — из DDL-миграций.

### 1.1 Тенантность / control-plane

#### `bots` — строка арендатора (MIGRATION-00 реконструирует DDL задним числом; таблица заведена руками до первой миграции)
| колонка | тип | null | default / примечание |
|---|---|---|---|
| `id` | UUID | NN | `gen_random_uuid()` — **PK** |
| `bot_name` | TEXT | NN | — |
| `owner_id` | TEXT | NN | человекочитаемый слаг («saltanat»). **Уникальность держит код** (`onboard.server.ts`), а не констрейнт БД |
| `bot_token` | TEXT | null | M08 занулила у всех (токен живёт в env деплоя) |
| `status` | TEXT | null* | `'active'`; CHECK `status IN ('active','paused','suspended')` (M08/M15) |
| `modules` | JSONB | null | `'{}'::jsonb` — флаги модулей (см. §4) |
| `settings` | JSONB | null | `'{"on_overdue":"warn","warn_days_before":5,"grace_days":3}'` — политика при неоплате |
| `subscription_plan` | TEXT | null | — |
| `subscription_expires_at` | TIMESTAMPTZ | null | **пишет только триггер** `trg_sync_subscription_expiry` из `subscription_payments` (M09) |
| `app_url` | TEXT | null | адрес клиентского деплоя для ссылок панели и `/api/internal/*` |
| `internal_secret` | TEXT | null | секрет заголовка `x-internal-secret` |
| `owner_telegram_id` | BIGINT | null | chat_id владельца |
| `owner_name` | TEXT | null | — |
| `owner_contact` | TEXT | null | — |
| `paused_message` | TEXT | null | чем бот отвечает при `status <> 'active'` |
| `notes` | TEXT | null | — |
| `archived_at` | TIMESTAMPTZ | null | M15; клиент ушёл, но данные остаются |
| `created_at` | TIMESTAMPTZ | null | `now()` |
| `updated_at` | TIMESTAMPTZ | null | `now()` |
| `tags` | TEXT[] | NN | `'{}'::text[]` (M47) — теги оператора для фильтра в панели |
| `vertical` | TEXT | NN | `'digital'` (M49) — ниша; **рантайм клиента её НЕ читает**, он читает env `VERTICAL` |

*`status` в `types.ts` nullable, в DDL — `NOT NULL DEFAULT 'active'`; расхождение унаследовано от ручного создания таблицы.

Индексы: `idx_bots_archived_at(archived_at)`. Уникальных индексов, кроме PK, нет. Известные строки (из M06/M08): Анастасия `0bac1f86-…`, SALTANAT `de44b934-…`, Print KZ Art `89d155d1-…`, DID 02 (Дидактика) `19ce949b-…`, Развивашка `d6331748-…`.

#### `bot_events` (M08, kinds расширены M12/M14) — журнал действий оператора
`id UUID PK D:gen_random_uuid()`, `bot_id UUID NN→bots`, `at TIMESTAMPTZ NN D:now()`, `actor TEXT NN`, `kind TEXT NN`, `payload JSONB NN D:'{}'`.
CHECK `bot_events_kind_check`: `kind IN ('module_on','module_off','pause','resume','suspend','onboard','webhook','env_block','meta','payment','policy','message')`.
Индексы: `idx_bot_events_bot_id`, `idx_bot_events_at(at DESC)`, `idx_bot_events_bot_at(bot_id, at DESC)` (M34).

#### `bot_health_snapshots` (M48, RLS добавлена M59)
`id UUID PK`, `bot_id UUID NN→bots`, `at TIMESTAMPTZ NN D:now()`, `ok BOOLEAN NN`, `error TEXT`, `pending_updates INTEGER`.
Индекс `bot_health_snapshots_bot_id_at_idx(bot_id, at DESC)`. Крон каждые 15 мин, хранение 30 дней.

#### `module_requests` (M25) — заявки клиента на включение модуля
`id UUID PK`, `bot_id UUID NN→bots`, `module_key TEXT NN`, `requested_at TIMESTAMPTZ NN D:now()`, `status TEXT NN D:'pending' CHECK IN ('pending','resolved')`, `resolved_at TIMESTAMPTZ`.
Индексы: `idx_module_requests_bot_at(bot_id, requested_at DESC)`; **уникальный частичный** `uq_module_requests_pending(bot_id, module_key) WHERE status='pending'`.

#### `admin_login_attempts` (M22) — антибрут админки клиента
`id UUID PK`, `at TIMESTAMPTZ NN D:now()`, `bot_id UUID NN→bots`, `ip TEXT`, `ok BOOLEAN NN`. Индекс `idx_admin_login_attempts_bot_at(bot_id, at DESC)`.

#### `operator_login_attempts` (M13) — антибрут панели оператора, **без `bot_id`**
`id UUID PK`, `at TIMESTAMPTZ NN D:now()`, `username TEXT NN`, `ip TEXT`, `ok BOOLEAN NN`. Индексы `idx_operator_login_attempts_at(at DESC)`, `idx_operator_login_attempts_ip_at(ip, at DESC)`. Права у `anon/authenticated/tenant_bot` отозваны.

#### `operator_broadcasts` (M08) — рассылка оператора владельцам ботов, **без `bot_id`**
`id UUID PK`, `created_at TIMESTAMPTZ NN D:now()`, `actor TEXT NN`, `message_text TEXT NN`, `target TEXT NN` (`'all'|'selected'`), `results JSONB NN D:'[]'` (`[{bot_id,status,error?,at}]`). Индекс `idx_operator_broadcasts_created_at(created_at DESC)`.

#### `operator_settings` (M58) — KV самой платформы, **без `bot_id`**
`key TEXT PK`, `value TEXT`. Известные ключи: `payout_requisites` (реквизиты оператора для счетов), `sales_pipeline` (JSON настроек воронки продаж). RLS включена, **политик нет** → видна только `service_role`.

#### `subscription_payments` (M09) — история оплат подписки клиента
`id UUID PK`, `bot_id UUID NN→bots`, `period_start DATE NN`, `period_end DATE NN`, `amount NUMERIC(12,2) NN`, `currency TEXT NN D:'KZT'`, `paid_at TIMESTAMPTZ NN D:now()`, `note TEXT`, `created_at TIMESTAMPTZ NN D:now()`.
CHECK `subscription_payments_period_order`: `period_end >= period_start`.
Индексы `idx_subscription_payments_bot_id`, `idx_subscription_payments_period_end(bot_id, period_end DESC)`.
Триггер `trg_sync_subscription_expiry` (AFTER INS/UPD/DEL) → двигает `bots.subscription_expires_at = MAX(period_end)`.
RLS включена, политик нет → недоступна клиентским деплоям.

#### `subscription_invoices` (M58, гранты сужены M60) — счета оператора владельцу бота
`id UUID PK`, `bot_id UUID NN→bots`, `amount NUMERIC(12,2) NN CHECK >0`, `currency TEXT NN D:'KZT'`, `note TEXT`, `requisites_snapshot TEXT NN`, `status TEXT NN D:'sent' CHECK IN ('sent','proof_uploaded','paid','rejected','cancelled')`, `proof_path TEXT`, `proof_uploaded_at TIMESTAMPTZ`, `created_at TIMESTAMPTZ NN D:now()`, `created_by TEXT`, `confirmed_at TIMESTAMPTZ`, `reject_reason TEXT`.
Индекс `idx_subscription_invoices_bot_status(bot_id, status)`.
RLS: `tenant_sees_own_invoices` (SELECT), `tenant_uploads_invoice_proof` (UPDATE) — обе `bot_id = current_bot_id()`. M60: у `tenant_bot` табличный UPDATE отозван, оставлен колоночный только на `status, proof_path, proof_uploaded_at`.
Чек лежит в бакете **`payment-proofs`** (тот же, что у заказов).

#### `app_settings` — тенантный KV
`bot_id UUID` (nullable в `types.ts`; M02 объявляет `SET NOT NULL`), `key TEXT NN`, `value TEXT`, `updated_at TIMESTAMPTZ NN D:now()`.
**PK: `(bot_id, key)`** — переключён M02 с `(key)` (constraint `app_settings_pkey`).
Ключи, встречающиеся в коде: `shop_name`, `admin_chat_id`, `admin_contact_link`, `payment_mode`, `deposit_percent`, `delivery_lang_timing`, `delivery_email_note`, `cart_reminder_hours`, `loyalty_earn_percent`, `referral_discount_percent`, `receipt_ocr_auto`, `smart_search_enabled`, `smart_search_last_error`, `robokassa_enabled|test_mode|login|pass1|pass2|pass1_test|pass2_test`, `legal_seller_details`, `legal_offer_html`, `legal_privacy_html`, `legal_about_html`, `legal_offer_file`, `legal_offer_filename`, `legal_privacy_file`, `legal_privacy_filename`, `instruction_video_path`, `instruction_video_file_id`, `instruction_caption`, `vip_group_id`, `vip_payment_instructions`, `vip_test_mode`, `vip_warn_days`, `vip_warn_days_2`, `vip_welcome_message`, `mini_app_catalog`, `instagram_direct_bot_enabled|_features|_scope|_script|_triggers`, `ig_comment_automations_meta`, `whatsapp_bot_excluded_phones`, `consultant_profile`, `consultant_profile_summary`, `consultant_knowledge`, `consultant_reset_at`, `consultant_vtb_buy_rate`.

---

### 1.2 Каталог

#### `categories`
`id UUID PK D:gen_random_uuid()`, `bot_id UUID null`, `name TEXT NN`, `parent_id UUID → categories(id) ON DELETE CASCADE` (самоссылка, вложенность), `sort_order INT NN D:0`, `is_visible BOOLEAN NN D:true` (PATCH-CATEGORY-VISIBLE), `created_at TIMESTAMPTZ NN D:now()`.
Индексы: `idx_categories_bot_id`.

#### `products`
| колонка | тип | null | примечание |
|---|---|---|---|
| `id` | UUID | NN | PK, `gen_random_uuid()` |
| `bot_id` | UUID | null | тенантный ключ |
| `category_id` | UUID | null | → `categories(id)` ON DELETE SET NULL (легаси, один родитель) |
| `category_ids` | JSONB | NN | множественные категории; **jsonb, не uuid[]** (у переносимых клиентов был `uuid[]`) |
| `name` | TEXT | NN | |
| `description` | TEXT | NN | `''` |
| `keywords` | TEXT | NN | `''` |
| `price` | NUMERIC(10,2) | NN | `0` |
| `currency` | TEXT | NN | `'KZT'` |
| `country_prices` | JSONB | NN | цены по странам |
| `file_path` | TEXT | null | материал (ru) в `product-files` |
| `file_name` | TEXT | null | |
| `file_url` | TEXT | null | M01 — внешняя ссылка вместо файла |
| `file_path_kz` | TEXT | null | материал (kk) |
| `file_name_kz` | TEXT | null | |
| `file_url_kz` | TEXT | null | M01 |
| `is_active` | BOOLEAN | NN | `true` |
| `sort_order` | INT | NN | `0` |
| `rating_avg` | NUMERIC(3,2) | null | M43, кэш агрегата — пересчитывает триггер на `product_reviews` |
| `rating_count` | INTEGER | NN | `0` (M43) |
| `stock_quantity` | INTEGER | null | M46; NULL = остаток не отслеживается. CHECK `products_stock_quantity_nonneg` |
| `fulfillment_kind` | TEXT | NN | `'digital'` (M49). CHECK `IN ('digital','physical')` |
| `lead_time_days` | INTEGER | null | M49, срок изготовления. CHECK `products_lead_time_days_nonneg` |
| `created_at` | TIMESTAMPTZ | NN | `now()` |

Индексы: `idx_products_category(category_id)`, `idx_products_search` — GIN `to_tsvector('simple', name||' '||description||' '||keywords)`, `idx_products_bot_id`.

#### `product_images`
`id UUID PK`, `bot_id UUID null`, `product_id UUID NN → products ON DELETE CASCADE`, `image_path TEXT NN`, `sort_order INT NN D:0`, `created_at TIMESTAMPTZ NN D:now()`. Индексы `idx_product_images_product`, `idx_product_images_bot_id`.

#### `product_variants` (M53) — простой список вариантов «имя + цена»
`id UUID PK`, `bot_id UUID NN→bots`, `product_id UUID NN→products ON DELETE CASCADE`, `name TEXT NN`, `price NUMERIC(10,2) NN CHECK >=0`, `sort_order INT NN D:0`.
Индекс `idx_product_variants_product(product_id, sort_order)`. Заменяется целиком при сохранении товара (как `product_images`).

#### `product_material_files` (M01) — материалы товара по языкам
`id UUID PK`, `bot_id UUID NN→bots`, `product_id UUID NN→products ON DELETE CASCADE`, `language TEXT NN D:'ru'`, `file_path TEXT NN`, `file_name TEXT`, `sort_order INT NN D:0`.
CHECK `product_material_files_language_check`: **`language IN ('ru','kk','en','uz')`** — M37 переименовала `'kz'` → `'kk'` и расширила список.
Индексы `idx_pmf_product(product_id, language, sort_order)`, `idx_product_material_files_bot_id` (M18).

#### `product_reviews` (M43)
`id UUID PK`, `bot_id UUID NN→bots`, `product_id UUID NN→products ON DELETE CASCADE`, `telegram_id BIGINT NN`, `rating SMALLINT NN CHECK BETWEEN 1 AND 5`, `comment TEXT`, `created_at TIMESTAMPTZ NN D:now()`, `updated_at TIMESTAMPTZ NN D:now()`.
**UNIQUE `(bot_id, product_id, telegram_id)`**. Индекс `idx_product_reviews_product(bot_id, product_id)`.
Триггеры: `trg_force_bot_id`, `trg_product_reviews_touch` (updated_at), `trg_recompute_product_rating` (AFTER INS / UPD OF rating / DEL → пересчёт `products.rating_avg/rating_count`).

---

### 1.3 Заказы и корзина

#### `orders` — PK `id BIGSERIAL`
| колонка | тип | null | примечание |
|---|---|---|---|
| `id` | BIGSERIAL | NN | **PK**, глобальная последовательность на всю базу |
| `bot_id` | UUID | null | тенантный ключ |
| `order_no` | BIGINT | NN | M03; номер в пределах бота, выдаёт триггер из `order_counters`. **Может перенумеровываться** `renumber_orders()` |
| `display_no` | BIGINT | null | M28; номер, показанный покупателю — **никогда не меняется** |
| `telegram_id` | BIGINT | NN* | → `bot_users(telegram_id)`; NOT NULL снят PATCH-INSTAGRAM-ZERNIO |
| `user_key` | TEXT | null | `tg_<id>` / `ig_<id>` — кросс-платформенный ключ покупателя |
| `platform` | TEXT | NN | `'telegram'`; ещё `instagram`, `whatsapp`, `manual` |
| `zernio_conversation_id` | TEXT | null | диалог в Zernio |
| `username` | TEXT | null | |
| `display_name` | TEXT | null | |
| `contact` | TEXT | null | |
| `customer_email` | TEXT | null | M17 — основной способ выдачи для заказов из Instagram |
| `country_code` / `country_name` | TEXT | null | |
| `total` | NUMERIC(10,2) | NN | `0` |
| `currency` | TEXT | NN | `'KZT'` |
| `status` | TEXT | NN | `'awaiting_payment'` |
| `payment_proof_path` | TEXT | null | ключ в `payment-proofs` |
| `payment_proof_hash` | TEXT | null | M36, SHA-256 картинки чека (сверка на повтор) |
| `admin_note` | TEXT | null | |
| `delivery_index` | INT | NN | `0` (PATCH-DELIVERY-BATCH) — сколько позиций уже выдано |
| `delivery_retry_count` | INTEGER | NN | `0` (M32) — потолок автоповторов выдачи |
| `delivery_lang_choice` | TEXT | null | M38; код языка или `'all'`, выбран ДО оформления |
| `promo_code` | TEXT | null | M40 |
| `discount_amount` | NUMERIC | NN | `0` (M40) |
| `points_used` / `points_earned` | INTEGER | NN | `0` (M42) |
| `gift_certificate_code` | TEXT | null | M45 |
| `gift_certificate_discount` | NUMERIC | NN | `0` (M45) |
| `fulfillment_kind` | TEXT | NN | `'digital'` (M49), снимок `products.fulfillment_kind`. CHECK `IN ('digital','physical')` |
| `fulfillment_type` | TEXT | null | CHECK `NULL или IN ('pickup','delivery')` |
| `fulfillment_at` | TIMESTAMPTZ | null | когда покупатель получает |
| `fulfillment_address` | TEXT | null | |
| `fulfillment_note` | TEXT | null | |
| `fulfillment_reminder_sent_at` | TIMESTAMPTZ | null | M51, идемпотентность крона |
| `paid_amount` | NUMERIC(10,2) | NN | `0` (M49). CHECK `>= 0` и (M55) `paid_amount <= total` |
| `delivery_zone_id` | UUID | null | M52 → `delivery_zones(id)` ON DELETE SET NULL |
| `delivery_zone_name` | TEXT | null | снимок имени зоны |
| `delivery_fee` | NUMERIC(10,2) | NN | `0` (M52), уже включена в `total` |
| `created_at` / `updated_at` | TIMESTAMPTZ | NN | `now()` |

Уникальные: **`orders_bot_order_no_idx UNIQUE (bot_id, order_no)`** (M03).
Прочие индексы: `idx_orders_telegram`, `idx_orders_status`, `idx_orders_bot_id`, `idx_orders_user_key`, `idx_orders_platform`, `idx_orders_customer_email WHERE customer_email IS NOT NULL` (M17), `idx_orders_bot_proof_hash(bot_id, payment_proof_hash) WHERE payment_proof_hash IS NOT NULL` (M36), `idx_orders_bot_telegram_status_created(bot_id, telegram_id, status, created_at DESC)` и `idx_orders_bot_status_created(bot_id, status, created_at)` (M34), `idx_orders_bot_status_fulfillment_at(bot_id, status, fulfillment_at)` (M49).
Триггеры: `trg_orders_touch` (updated_at), `trg_force_bot_id`, `trg_zz_assign_order_no` (M03), `trg_zzz_freeze_display_no` (M28).
Статусы в коде (CHECK на них в БД нет): `awaiting_payment`, `awaiting_confirmation`, `delivering`, `delivered`, `rejected`, `cancelled`, `refunded`, `paid`, `completed`, а для физических — `accepted`, `in_production`, `ready`.

#### `order_items`
`id UUID PK`, `bot_id UUID null`, `order_id BIGINT NN → orders ON DELETE CASCADE`, `product_id UUID null → products ON DELETE SET NULL`, `product_variant_id UUID null → product_variants ON DELETE SET NULL` (M53), `name_snapshot TEXT NN`, `price_snapshot NUMERIC(10,2) NN`, `quantity INT NN D:1`, `file_path_snapshot TEXT`, `file_name_snapshot TEXT`, `file_url_snapshot TEXT` (M01), `file_path_kz_snapshot TEXT`, `file_name_kz_snapshot TEXT`, `file_url_kz_snapshot TEXT` (M01), `material_files_snapshot JSONB NN D:'[]'`, `material_files_kz_snapshot JSONB NN D:'[]'`, **`material_files_by_lang JSONB NN D:'{}'`** (M37 — источник истины для новых заказов, `{"ru":[…],"kk":[…]}`; две предыдущие колонки остались для старых строк), `delivered_language TEXT` (`NULL|ru|kk|both`).
Индексы: `idx_order_items_order`, `idx_order_items_bot_id`.

#### `order_counters` (M03) — счётчик номеров на бота
`bot_id UUID PK → bots ON DELETE CASCADE`, `last_no BIGINT NN D:0`.

#### `cart_items`
`id UUID PK`, `bot_id UUID null`, `telegram_id BIGINT` (NOT NULL снят), `user_key TEXT null`, `product_id UUID NN → products ON DELETE CASCADE`, `product_variant_id UUID null → product_variants ON DELETE SET NULL` (M53), `quantity INT NN D:1`, `created_at TIMESTAMPTZ NN D:now()`.
**Уникальность (актуальная, M54):** `cart_items_bot_user_key_product_variant_key UNIQUE (bot_id, user_key, product_id, COALESCE(product_variant_id,'00000000-0000-0000-0000-000000000000'::uuid))`.
История: `UNIQUE(telegram_id, product_id)` → `cart_items_user_key_product_id_key(user_key, product_id)` (PATCH-ZERNIO) → `cart_items_bot_user_key_product_id_key` (M04) → текущий (M54, старый дропнут).
Индексы: `idx_cart_items_user_key`, `idx_cart_items_bot_id`.

#### `web_cart_handoffs` (M56) — одноразовая корзина с веб-витрины перед переходом в Telegram (deep link `wc_<token>`)
`token TEXT PK`, `bot_id UUID NN→bots`, `items JSONB NN D:'[]'`, `created_at TIMESTAMPTZ NN D:now()`, `expires_at TIMESTAMPTZ NN`, `claimed_at TIMESTAMPTZ`, `claimed_telegram_id BIGINT`.
Индексы `web_cart_handoffs_bot_id_idx`, `web_cart_handoffs_expires_unclaimed_idx(expires_at) WHERE claimed_at IS NULL`. RLS включена, политик нет.

#### `delivery_zones` (M52)
`id UUID PK`, `bot_id UUID NN→bots`, `name TEXT NN`, `price NUMERIC(10,2) NN D:0` (CHECK `>=0`, M55), `sort_order INT NN D:0`, `is_active BOOLEAN NN D:true`, `created_at TIMESTAMPTZ NN D:now()`.

#### `promo_codes` (M40)
`id UUID PK`, `bot_id UUID NN→bots`, `code TEXT NN`, `discount_type TEXT NN CHECK IN ('percent','fixed')`, `discount_value NUMERIC NN CHECK >0`, `max_uses INTEGER CHECK (NULL или >0)`, `used_count INTEGER NN D:0`, `valid_until TIMESTAMPTZ`, `is_active BOOLEAN NN D:true`, `created_at TIMESTAMPTZ NN D:now()`.
**UNIQUE `(bot_id, code)`**. Индекс `idx_promo_codes_bot_id`.

#### `gift_certificates` (M45)
`id UUID PK`, `bot_id UUID NN→bots`, `code TEXT NN`, `amount NUMERIC NN CHECK >0`, `currency TEXT NN D:'KZT'`, `note TEXT`, `status TEXT NN D:'active' CHECK IN ('active','redeemed','cancelled')`, `redeemed_by_telegram_id BIGINT`, `redeemed_order_id BIGINT → orders(id) ON DELETE SET NULL`, `created_at TIMESTAMPTZ NN D:now()`, `redeemed_at TIMESTAMPTZ`.
**UNIQUE `(bot_id, code)`**.

#### `referrals` (M41)
`id UUID PK`, `bot_id UUID NN→bots`, `referrer_telegram_id BIGINT NN`, `referred_telegram_id BIGINT NN`, `status TEXT NN D:'pending' CHECK IN ('pending','rewarded')`, `reward_promo_code TEXT`, `created_at TIMESTAMPTZ NN D:now()`, `rewarded_at TIMESTAMPTZ`.
**UNIQUE `(bot_id, referred_telegram_id)`**. Индексы `idx_referrals_bot_id`, `idx_referrals_referrer(bot_id, referrer_telegram_id)`.

---

### 1.4 Покупатели

#### `bot_users` — покупатель в пределах бота
| колонка | тип | null | примечание |
|---|---|---|---|
| `bot_id` | UUID | null* | *M02 объявляет `SET NOT NULL`; в `types.ts` nullable |
| `user_key` | TEXT | NN | `tg_<telegram_id>` / `ig_<provider_id>` — часть PK |
| `telegram_id` | BIGINT | NN | NOT NULL снят PATCH-ZERNIO, в `types.ts` не-null. Для `ig_…`/`wa_…` — синтетический отрицательный: `-parseInt(sha256(user_key).hex.slice(0,13),16)` (v1 `zernioCustomerId`, v2 `syntheticTelegramId`) — на нём держатся корзина, заказы, чат с менеджером |
| `platform` | TEXT | NN | `'telegram'` |
| `username` / `first_name` / `last_name` / `language_code` | TEXT | null | |
| `contact_phone` | TEXT | null | |
| `email` | TEXT | null | M17 |
| `state` | JSONB | NN | `'{}'` — конечный автомат диалога (в т.ч. `placing_order`) |
| `metadata` | JSONB | NN | `'{}'` (PATCH-IG-USER-METADATA) — followerCount, isVerified и т.п. из Zernio |
| `zernio_conversation_id` | TEXT | null | |
| `zernio_account_id` | TEXT | null | |
| `opt_out` | BOOLEAN | NN | `false` |
| `last_auto_dm_at` | TIMESTAMPTZ | null | |
| `loyalty_points` | INTEGER | NN | `0`, CHECK `>= 0` (M42) |
| `cart_reminder_sent_at` | TIMESTAMPTZ | null | M44 |
| `created_at` / `updated_at` | TIMESTAMPTZ | NN | `now()` |

**PK: `(bot_id, user_key)`** — constraint `bot_users_pkey` (M02). История: `telegram_id` → `bot_users_user_key_pkey(user_key)` (PATCH-ZERNIO) → текущий.
**UNIQUE `bot_users_bot_telegram_idx (bot_id, telegram_id)`** (M02). Глобальный `idx_bot_users_telegram_id_unique(telegram_id)` дропнут/пересоздан с `bot_id` в M04.
Индексы: `idx_bot_users_bot_id`, `idx_bot_users_bot_platform(bot_id, platform)` (M34), GIN pg_trgm по `username`, `first_name`, `last_name` (M34).
Триггеры: `trg_bot_users_touch`, `trg_force_bot_id`.

#### `blocked_users` (M01)
`bot_id UUID NN→bots`, `telegram_id BIGINT NN`, `username TEXT`, `first_name TEXT`, `reason TEXT`, `blocked_at TIMESTAMPTZ NN D:now()`. **PK `(bot_id, telegram_id)`**.

#### `manager_chat_state` (M26)
`bot_id UUID NN→bots`, `telegram_id BIGINT NN`, `active BOOLEAN NN D:false`, `connected_at TIMESTAMPTZ`, `last_message_at TIMESTAMPTZ NN D:now()`, `last_message_preview TEXT`, `last_message_direction TEXT CHECK IN ('in','out')`, `unread_count INT NN D:0`.
**PK `(bot_id, telegram_id)`**. Индекс `idx_manager_chat_state_bot_last_message(bot_id, last_message_at DESC)`.

#### `manager_chat_messages` (M26)
`id UUID PK`, `bot_id UUID NN→bots`, `telegram_id BIGINT NN`, `direction TEXT NN CHECK IN ('in','out')`, `sender TEXT NN CHECK IN ('customer','bot','manager')`, `text TEXT NN`, `created_at TIMESTAMPTZ NN D:now()`.
Индекс `idx_manager_chat_messages_thread(bot_id, telegram_id, created_at)`.

---

### 1.5 Оплата

#### `payment_methods` — реквизиты по странам
`id UUID PK`, `bot_id UUID null`, `country_code TEXT NN`, `country_name TEXT NN`, `instructions TEXT NN`, `currency TEXT NN D:'KZT'`, `qr_code_path TEXT` (M01), `is_active BOOLEAN NN D:true`, `sort_order INT NN D:0`, `created_at TIMESTAMPTZ NN D:now()`.
Индекс `idx_payment_methods_bot_id`. Засев по умолчанию: KZ/RU/KG/BY/OTHER.

---

### 1.6 VIP-подписки

#### `vip_tariffs` (M01 + M06)
`id UUID PK`, `bot_id UUID NN→bots`, `name TEXT NN`, `description TEXT NN D:''`, `price NUMERIC(10,2) NN D:0`, `currency TEXT NN D:'KZT'`, `duration_days INT NN D:30`, `duration_minutes INT null` (M06), `is_entry BOOLEAN NN D:false` (M06), `is_public BOOLEAN NN D:true` (M06), `is_active BOOLEAN NN D:true`, `sort_order INT NN D:0`, `created_at TIMESTAMPTZ NN D:now()`.
Индекс `idx_vip_tariffs_bot_id` (M18).

#### `vip_subscriptions` (M01, целостность M31)
`id UUID PK`, `bot_id UUID NN→bots`, `telegram_id BIGINT NN`, `username/first_name/last_name TEXT`, `tariff_id UUID → vip_tariffs ON DELETE RESTRICT`, `status TEXT NN D:'pending_payment'`, `payment_proof_path TEXT`, `group_invite_link TEXT`, `started_at TIMESTAMPTZ`, `expires_at TIMESTAMPTZ NN`, `imported BOOLEAN NN D:false`, `admin_note TEXT`, `created_at TIMESTAMPTZ NN D:now()`, `updated_at TIMESTAMPTZ NN D:now()`.
CHECK `vip_status_check`: `status IN ('pending_payment','active','expired','cancelled')`.
**Уникальные частичные (M31):** `uq_vip_subs_one_pending (bot_id, telegram_id) WHERE status='pending_payment'`, `uq_vip_subs_one_active (bot_id, telegram_id) WHERE status='active'`.
Индексы `idx_vip_subs_bot_tg(bot_id, telegram_id)`, `idx_vip_subs_expires(bot_id, expires_at)`. Триггер `trg_vip_subscriptions_touch`.

#### `vip_member_profiles` (M01 + M06)
`bot_id UUID NN→bots`, `telegram_id BIGINT NN`, `username/first_name/last_name TEXT`, `assigned_tariff_id UUID → vip_tariffs ON DELETE SET NULL`, `assigned_at TIMESTAMPTZ NN D:now()`, `assigned_source TEXT NN D:'deep_link' CHECK IN ('deep_link','payment','admin')`, `admin_label TEXT` (M06), `legacy_locked BOOLEAN NN D:false` (M06), `locale TEXT null`.
**PK `(bot_id, telegram_id)`**.

---

### 1.7 Рассылки

#### `broadcasts` (COMPLETE-SETUP + PATCH-BROADCASTS + M30)
`id UUID PK`, `bot_id UUID null`, `status TEXT NN D:'queued' CHECK IN ('queued','sending','completed','cancelled','failed')`, `message_text TEXT NN`, `photo_paths JSONB NN D:'[]'`, `product_ids JSONB NN D:'[]'`, `show_catalog BOOLEAN NN D:true`, `audience_type TEXT NN D:'all' CHECK IN ('all','country','buyers','non_buyers','test')`, `audience_filter JSONB NN D:'{}'`, `total_count/sent_count/failed_count/blocked_count INT NN D:0`, `created_at TIMESTAMPTZ NN D:now()`, `started_at`, `completed_at`, **M30:** `channel TEXT NN D:'telegram'`, `account_id TEXT`, `template_name TEXT`, `template_language TEXT`, `template_params JSONB NN D:'[]'`.
Индексы: `idx_broadcasts_active(status) WHERE status IN ('queued','sending')`, `idx_broadcasts_bot_id`, `idx_broadcasts_channel_status(channel, status, created_at)` (M30).

#### `broadcast_recipients`
`id UUID PK`, `broadcast_id UUID NN → broadcasts ON DELETE CASCADE`, `bot_id UUID null`, `telegram_id BIGINT NN`, `phone TEXT null` (M30), `status TEXT NN D:'pending' CHECK IN ('pending','sent','failed','blocked')`, `error_message TEXT`, `sent_at TIMESTAMPTZ`.
**UNIQUE `(broadcast_id, telegram_id)`** (M04 мог пересоздать с `bot_id` впереди). Индекс `idx_broadcast_recipients_pending(broadcast_id, status) WHERE status='pending'`, `idx_broadcast_recipients_bot_id`.

#### `whatsapp_templates` (M29)
`id UUID PK`, `bot_id UUID NN→bots`, `account_id TEXT NN`, `name TEXT NN`, `language TEXT NN`, `category TEXT NN`, `status TEXT NN D:'PENDING'`, `reason TEXT`, `components JSONB NN D:'[]'`, `created_at/updated_at TIMESTAMPTZ NN D:now()`.
**UNIQUE `(bot_id, account_id, name, language)`**. Индексы `idx_whatsapp_templates_bot_id`, `idx_whatsapp_templates_approved(bot_id, account_id) WHERE status='APPROVED'`.

---

### 1.8 Консультант / AI (BOVI, MIGRATION-69/70)

#### `consultant_message_runs` — durable-леджер обработки входящих сообщений
`id UUID PK`, `bot_id UUID NN→bots`, `message_id TEXT NN`, `event_id TEXT`, `platform_message_id TEXT`, `conversation_id TEXT NN`, `account_id TEXT`, `user_key TEXT NN`,
`direction TEXT NN D:'incoming' CHECK IN ('incoming','outgoing')`,
`source TEXT NN D:'webhook' CHECK IN ('webhook','poll','admin_test')`,
`status TEXT NN D:'received' CHECK IN ('received','processing','replied','retryable_failed','terminal_failed','cancelled')`,
`incoming_text TEXT`, `reply_text TEXT`, `reply_kind TEXT`, `reply_fingerprint TEXT`, `outbound_message_id TEXT`,
`model TEXT`, `prompt_version TEXT`, `catalog_version TEXT`, `rate_value NUMERIC`, `rate_updated_at TIMESTAMPTZ`, `rate_source TEXT`,
`tool_trace JSONB NN D:'[]'`, `token_usage JSONB NN D:'{}'`, `validator_result JSONB NN D:'{}'`,
`error_code TEXT`, `error_message TEXT`, `attempt_count INTEGER NN D:0`,
`received_at TIMESTAMPTZ NN D:now()`, `claimed_at`, `sent_at`, `completed_at`, `next_retry_at`, `created_at NN D:now()`, `updated_at NN D:now()`.
**UNIQUE `consultant_message_runs_message_key (bot_id, message_id)`**; **UNIQUE частичный `idx_consultant_runs_outbound_message (bot_id, outbound_message_id) WHERE outbound_message_id IS NOT NULL`**.
Индексы `idx_consultant_runs_status_retry(bot_id, status, next_retry_at, received_at)`, `idx_consultant_runs_conversation(bot_id, conversation_id, received_at DESC)`. Триггеры `trg_force_bot_id`, `trg_consultant_runs_touch`.

#### `consultant_handoffs` — очередь передачи менеджеру
`id UUID PK`, `bot_id UUID NN→bots`, `run_id UUID → consultant_message_runs ON DELETE SET NULL`, `user_key TEXT NN`, `conversation_id TEXT`,
`reason TEXT NN CHECK IN ('purchase','out_of_stock','manager_request','unsupported_country','ai_error','catalog_error','validation_error','other')`,
`customer_text TEXT`, `product_ids JSONB NN D:'[]'`, `status TEXT NN D:'open' CHECK IN ('open','done')`, `created_at NN D:now()`, `completed_at`.
**UNIQUE `consultant_handoffs_run_key (bot_id, run_id)`**. Индексы `idx_consultant_handoffs_open(bot_id, status, created_at DESC)`, `idx_consultant_handoffs_user(bot_id, user_key, created_at DESC)`.

#### `consultant_catalog_imports` — append-only история импортов каталога
`id UUID PK`, `bot_id UUID NN→bots`, `version TEXT NN`, `source TEXT NN`, `source_url TEXT`, `status TEXT NN CHECK IN ('published','failed')`, `product_count INTEGER NN D:0`, `skipped_count INTEGER NN D:0`, `errors JSONB NN D:'[]'`, `created_at NN D:now()`.
**UNIQUE `consultant_catalog_imports_version_key (bot_id, version)`**. Индекс `idx_consultant_catalog_imports_recent(bot_id, created_at DESC)`.

#### `story_product_tags` (M70) — привязка товара к сторис для ответов консультанта
`id UUID PK D:gen_random_uuid()`, **`bot_id TEXT` (!) — не UUID и без FK**, `story_id TEXT NN`, `story_url TEXT`, `thumbnail_url TEXT`, `product_name TEXT NN`, `product_price_kzt NUMERIC`, **`product_id TEXT` — тоже TEXT, без FK**, `notes TEXT`, `created_at TIMESTAMPTZ D:now()`, `expires_at TIMESTAMPTZ`.
**UNIQUE `(story_id)`** — глобально, не в пределах бота. Индексы `idx_story_product_tags_story_url`, `idx_story_product_tags_expires`.
Создана без схемы `public.` в DDL, без RLS/грантов — **выбивается из общего стиля**, тенантность фактически отсутствует.

---

### 1.9 Instagram / WhatsApp / Zernio

#### `zernio_logs` (PATCH-INSTAGRAM-ZERNIO + M01)
`id UUID PK`, `bot_id UUID null → bots`, `event_id TEXT UNIQUE`, `event_type TEXT NN`, `status TEXT NN D:'pending'` (`pending|processed|error|ignored`), `payload JSONB NN D:'{}'`, `error_message TEXT`, `created_at TIMESTAMPTZ NN D:now()`.
Индексы `idx_zernio_logs_event_id`, `idx_zernio_logs_type`, `idx_zernio_logs_bot_id`, `idx_zernio_logs_bot_status_created(bot_id, status, created_at)` (M34).
Известная проблема (ANALYSIS.md): ~69 строк вечно висят в `pending` — перечитывать некому.

#### `comment_dm_fallback_sends` (M62, +M64, +M65, +M66)
`id UUID PK`, `bot_id UUID NN→bots`, `automation_id TEXT NN`, `platform_post_id TEXT NN`, `comment_id TEXT NN`,
`status TEXT NN D:'pending' CHECK IN ('pending','sent','failed')`, `error TEXT`,
`comment_reply_status TEXT CHECK IN ('skipped','sent','failed')`, `comment_reply_error TEXT` (M64),
`alt_channel_status TEXT CHECK IN ('skipped','sent','failed')`, `alt_channel_error TEXT` (M65),
`unresolved_prompt_status TEXT CHECK IN ('skipped','sent','failed')`, `unresolved_prompt_error TEXT` (M66),
`created_at NN D:now()`, `updated_at NN D:now()`.
**UNIQUE `(automation_id, comment_id)`** — без `bot_id`. Индекс `idx_comment_dm_fallback_sends_automation`.

#### `comment_automation_settings` (M66)
`bot_id UUID NN→bots`, `automation_id TEXT NN`, `unresolved_prompt_enabled BOOLEAN NN D:false`, `unresolved_prompt_message TEXT`, `created_at NN D:now()`, `updated_at NN D:now()`. **PK `(bot_id, automation_id)`**.

---

### 1.10 Отдел продаж самой FrogFlow (платформенные, без `bot_id`)

#### `sales_leads` (M63 + M67 + M68)
`id UUID PK`, `created_at NN D:now()`, `updated_at NN D:now()`, `business_name TEXT NN`, `niche TEXT`, `city TEXT`, `website_url TEXT`, `instagram_handle TEXT`, `phone TEXT`, `email TEXT`, `signals TEXT`, `source TEXT NN D:'manual'`,
`stage TEXT NN D:'new' CHECK IN ('new','qualified','rejected','contacted','replied','hot','converted','lost')`,
`score INTEGER CHECK BETWEEN 0 AND 100`, `score_reason TEXT`, `draft_message TEXT`, `notes TEXT`, `created_by TEXT`, `contacted_at`, `replied_at`,
M67: `next_action TEXT`, `next_action_at TIMESTAMPTZ`, `follow_up_count INTEGER NN D:0`, `last_touch_at TIMESTAMPTZ`, `outreach_channel TEXT`, `follow_up_draft TEXT`, `auto_processed_at TIMESTAMPTZ`, `lost_reason TEXT`,
M68: `conversation_id TEXT`, `zernio_account_id TEXT`, `outreach_error TEXT`.
Индексы `idx_sales_leads_stage`, `idx_sales_leads_next_action_at(next_action_at) WHERE NOT NULL`, `idx_sales_leads_conversation_id(conversation_id) WHERE NOT NULL`. RLS без политик → только `service_role`.

#### `sales_lead_events` (M67)
`id UUID PK`, `lead_id UUID NN → sales_leads ON DELETE CASCADE`, `created_at NN D:now()`, `actor TEXT NN D:'pipeline'`, `kind TEXT NN`, `detail TEXT`. Индекс `idx_sales_lead_events_lead(lead_id, created_at DESC)`.

---

## 2. Функции (RPC) и enum'ы

### 2.1 `Database['public']['Functions']` — то, что вызывается из кода
| функция | сигнатура | доступ |
|---|---|---|
| `operator_bot_stats()` | `() → TABLE(bot_id uuid, orders_total bigint, orders_30d bigint, last_order_at timestamptz, products_total bigint, customers_total bigint, storage_bytes bigint)`; `LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,storage` (M10) | только `service_role`; `anon/authenticated/tenant_bot` — REVOKE |
| `operator_storage_by_kind()` | `() → TABLE(bot_id uuid, storage_kind text, storage_bytes bigint)`; та же методика, разбивка по видам: «Материалы» / «Фото товаров» / «Чеки оплаты» (M39) | только `service_role` |
| `increment_broadcast_counts(p_broadcast_id uuid, p_sent int DEFAULT 0, p_failed int DEFAULT 0, p_blocked int DEFAULT 0)` | `→ void`; `LANGUAGE sql SECURITY INVOKER` (M11 / PATCH-BROADCASTS) — атомарный инкремент счётчиков рассылки | `service_role`, `tenant_bot` |
| `manager_chat_touch(p_bot_id uuid, p_telegram_id bigint, p_direction text, p_sender text, p_preview text)` | `→ void`; plpgsql, upsert превью и времени (M26). **Живая версия не инкрементирует `unread_count`** (проверено 2026-09-21 под service_role: после реплики покупателя счётчик остаётся 0) — v2 считает непрочитанные сама, CAS в `src/core/chat/chat.ts` | `tenant_bot`, `service_role` |
| `claim_order_placement(p_bot_id uuid, p_telegram_id bigint)` | `→ boolean`; атомарный захват `bot_users.state.placing_order` (M27, вместо CAS по `updated_at`) | `tenant_bot`, `service_role` |

### 2.2 Функции в БД, не описанные в `types.ts` (триггеры и служебные)
| функция | назначение |
|---|---|
| `current_bot_id() → uuid` | `SELECT nullif(current_setting('request.jwt.claims',true)::json->>'bot_id','')::uuid`; `LANGUAGE sql STABLE` (M02/M03) — основа RLS |
| `force_bot_id() → trigger` | BEFORE INSERT: если в JWT есть `bot_id`, принудительно ставит `NEW.bot_id` (M02) |
| `touch_updated_at() → trigger` | `NEW.updated_at = now()` (COMPLETE-SETUP, переопределена M31) |
| `assign_order_no() → trigger` | BEFORE INSERT на `orders`: инкремент `order_counters.last_no` → `NEW.order_no` (M03) |
| `freeze_display_no() → trigger` | BEFORE INSERT: `display_no := order_no`, если пусто (M28) |
| `sync_subscription_expiry() → trigger` | AFTER INS/UPD/DEL на `subscription_payments` → `bots.subscription_expires_at = MAX(period_end)` (M09) |
| `recompute_product_rating() → trigger` | AFTER на `product_reviews` → `products.rating_avg/rating_count` (M43) |
| `renumber_orders(p_bot_id uuid) → void` | перенумеровывает `orders.order_no` в пределах бота по `created_at,id` и чинит `order_counters` (M23). REVOKE от `tenant_bot` |
| `nightly_orders_maintenance() → void` | ночная чистка + перенумерация. **Актуальная версия — M61**: `DELETE FROM orders WHERE status IN ('awaiting_confirmation','awaiting_payment') AND created_at < now()-'7 days' AND (fulfillment_kind<>'physical' OR fulfillment_at IS NULL) AND platform<>'manual' AND payment_proof_path IS NULL AND COALESCE(paid_amount,0)=0`, затем `renumber_orders` только для «разъехавшихся» ботов. Переписывалась M23→24→35→49→50→55→57→61. Крон pg_cron `nightly-orders-maintenance` в `0 0 * * *` |
| `reset_orders_sequence() → void` | `SECURITY DEFINER`, `setval` на последовательность `orders.id`. **Больше не вызывается** (последовательность общая на всех арендаторов); права у `tenant_bot`/`anon`/`authenticated` отозваны (M10) |
| ~~`search_products(search_query text)`~~ | **УДАЛЕНА** M19 (заводилась M07) |

### 2.3 Enum'ы
**Postgres-enum'ов (`CREATE TYPE … AS ENUM`) в схеме НЕТ.** `Database['public']['Enums']` пуст (`[_ in never]: never`), `Constants.public.Enums = {}`. Все перечисления сделаны как `TEXT + CHECK`:

- `bots.status`: `active | paused | suspended`
- `bots.vertical` (без CHECK, значения из `src/lib/verticals/registry.ts`): `digital | confectionery | consultant | flowers | consultant_universal`
- `bot_events.kind`: `module_on | module_off | pause | resume | suspend | onboard | webhook | env_block | meta | payment | policy | message`
- `broadcasts.status`: `queued | sending | completed | cancelled | failed`; `broadcasts.audience_type`: `all | country | buyers | non_buyers | test`; `broadcasts.channel`: без CHECK, `telegram | whatsapp | …`
- `broadcast_recipients.status`: `pending | sent | failed | blocked`
- `orders.status`: **без CHECK**; в коде `awaiting_payment | awaiting_confirmation | delivering | delivered | rejected | cancelled | refunded | paid | completed | accepted | in_production | ready`
- `orders.platform` / `bot_users.platform`: без CHECK; `telegram | instagram | whatsapp | manual`
- `orders.fulfillment_kind` / `products.fulfillment_kind`: `digital | physical`
- `orders.fulfillment_type`: `NULL | pickup | delivery`
- `product_material_files.language`: `ru | kk | en | uz`
- `vip_subscriptions.status`: `pending_payment | active | expired | cancelled`
- `vip_member_profiles.assigned_source`: `deep_link | payment | admin`
- `module_requests.status`: `pending | resolved`
- `manager_chat_*.direction`: `in | out`; `manager_chat_messages.sender`: `customer | bot | manager`
- `promo_codes.discount_type`: `percent | fixed`
- `referrals.status`: `pending | rewarded`
- `gift_certificates.status`: `active | redeemed | cancelled`
- `subscription_invoices.status`: `sent | proof_uploaded | paid | rejected | cancelled`
- `comment_dm_fallback_sends.status`: `pending | sent | failed`; три `*_status`: `skipped | sent | failed`
- `consultant_message_runs`: `direction` `incoming|outgoing`, `source` `webhook|poll|admin_test`, `status` `received|processing|replied|retryable_failed|terminal_failed|cancelled`
- `consultant_handoffs.reason`: `purchase | out_of_stock | manager_request | unsupported_country | ai_error | catalog_error | validation_error | other`; `.status`: `open | done`
- `consultant_catalog_imports.status`: `published | failed`
- `sales_leads.stage`: `new | qualified | rejected | contacted | replied | hot | converted | lost`
- `whatsapp_templates.status`: без CHECK, `PENDING | APPROVED | …` (от Meta)

Расширения: `pg_trgm` (M34), `pg_cron` (крон в M23).

---

## 3. Storage-бакеты

| бакет | public | file_size_limit (после M05) | MIME | назначение |
|---|---|---|---|---|
| `product-files` | **false** (M33) | 200 МБ | `NULL` (сняты M05) | платные материалы, только signed URL под `service_role` |
| `product-images` | **false** (M20) | 50 МБ | image/jpeg, png, gif, webp | фото товаров; раздача через `/api/public/img/$` |
| `payment-proofs` | false | 50 МБ | `NULL` | чеки по заказам **и по `subscription_invoices`** |
| `broadcast-images` | **true** | 50 МБ | image/* | картинки рассылок; политика `Public Read broadcast-images` |
| `legal-docs` | **true** | 100 МБ | `NULL` | оферта/политика/о продавце; `Public Read legal-docs` |
| `instruction-videos` | **true** | 200 МБ | `NULL` | видеоинструкция для покупателя; `Public Read` + `Service Role All` |
| `instagram-media` | **true** | 100 МБ | — | медиа из Instagram; `Service Role All instagram-media`. В коде почти не используется (1 упоминание) |

**Изоляция в Storage сделана не через RLS, а разметкой путей:** новые ключи пишутся с префиксом `{bot_id}/`, раздача сверяет префикс с `BOT_ID` деплоя (`src/lib/tenant-storage-key.server.ts`). Причина — `storage.objects` в Supabase не резолвит кастомную роль `tenant_bot`. Ключи без префикса (залитые раньше) обслуживаются как есть.

---

## 4. Как устроена тенантность

### Что такое «бот» = «арендатор»
Единица тенантности одна: **строка в `bots`**. Отдельной сущности «организация/аккаунт» нет — один клиент = один бот = один Vercel-деплой. Состав строки: идентичность (`id`, `bot_name`, `owner_id`-слаг), связь с деплоем (`app_url`, `internal_secret`), владелец (`owner_telegram_id`, `owner_name`, `owner_contact`), режим (`status`, `paused_message`, `archived_at`), биллинг (`subscription_plan`, `subscription_expires_at`, `settings` с политикой `on_overdue|warn_days_before|grace_days`), продуктовая конфигурация (`modules` JSONB, `vertical`, `tags`).

**Отдельного поля `domain` нет** — его роль выполняет `app_url`.

`bots.modules` — JSONB-словарь булевых флагов. Реестр в `src/lib/modules/registry.ts`, 44 ключа: `shop, broadcasts, multi_files, order_status, excel_export, legal_docs, dashboard, robokassa, crypto, receipt_ocr, telegram_stars, coupons, gift_certificates, upsell, quiz, multi_currency, multi_language, vip, blocked, courses, smart_search, web_storefront, telegram_mini_app, instagram, dm_shop, whatsapp, wa_shop, wa_broadcasts, cart_reminder, winback, funnel, loyalty, referral, manager_chat, helpdesk, review_request, notify_in_bot, crm_pipeline, admin_roles, crm_integration, multi_bot, stock, limited_offers, waitlist`. M08 нормализовала набор у 5 известных ботов, M16 добила до канонического списка (`defaults || COALESCE(modules,'{}')`), включив всем `order_status`/`excel_export` и выставив `multi_language` тем, у кого есть kz-материалы.

`bots.vertical` — ниша (`digital | confectionery | consultant | flowers | consultant_universal`), нужна **только панели оператора**; рантайм клиента читает env-переменную `VERTICAL`, а не колонку.

### Как сделана RLS
Три слоя:

1. **`current_bot_id()`** — читает `bot_id` из JWT-претензии `request.jwt.claims`. Ключ арендатора выпускается скриптом `scripts/mint-tenant-key.mjs`, кладётся в деплой как `SUPABASE_TENANT_KEY`.
2. **Роль `tenant_bot`** (`NOLOGIN NOINHERIT`, выдана `authenticator`). `GRANT SELECT/INSERT/UPDATE/DELETE ON ALL TABLES`, `USAGE,SELECT ON ALL SEQUENCES`, `EXECUTE ON ALL FUNCTIONS`, плюс `ALTER DEFAULT PRIVILEGES` чтобы новые таблицы не остались без прав. PostgREST переключается в неё по claim `role`.
3. **Политика `tenant_isolation`** на каждой таблице с `bot_id`: `FOR ALL TO tenant_bot USING (bot_id = current_bot_id()) WITH CHECK (bot_id = current_bot_id())`, плюс **триггер `trg_force_bot_id BEFORE INSERT`**, который принудительно перезаписывает `NEW.bot_id` из претензии — подделать из приложения нельзя. Под `service_role` (претензии нет) поведение прежнее.

На `bots` отдельно: `tenant_sees_own_bot FOR SELECT TO tenant_bot USING (id = current_bot_id())` — арендатор видит только свою строку и не может её менять.

Платформенные таблицы (`operator_login_attempts`, `operator_broadcasts`, `operator_settings`, `subscription_payments`, `bot_health_snapshots`, `sales_leads`, `sales_lead_events`, `web_cart_handoffs`) закрыты приёмом **«RLS включена, политик нет»** → доступны только `service_role`, обходящему RLS.

Старые политики `"Service Role All <table>"` (`FOR ALL TO service_role USING(true)`) из COMPLETE-SETUP остались и ничему не мешают.

**Запросы в коде при этом не меняются** — фильтр по `bot_id` обеспечивает БД, а не приложение. Откат на любом шаге: убрать `SUPABASE_TENANT_KEY` из деплоя.

### Что ввели MIGRATION-01 и MIGRATION-02

**MIGRATION-01 «Фаза 1 — фундамент» (только аддитивно, ✅ применена):**
- добавила `bot_id UUID REFERENCES bots(id) ON DELETE CASCADE` в `bot_users, cart_items, product_images, broadcast_recipients, zernio_logs, zernio_automations, ig_watched_posts, ig_keywords, ig_exclusions, ig_comment_actions, ig_post_leads` (в `products, categories, orders, order_items, app_settings, payment_methods, broadcasts, ig_poll_runs` колонка уже была);
- бэкфилл всех строк одним существующим ботом (Анастасия), **временный `ALTER COLUMN bot_id SET DEFAULT '<uuid>'`** на всех 19 таблицах + `idx_<t>_bot_id` на каждой. Этот DEFAULT снят позже — MIGRATION-06;
- добавила недостающие колонки переносимых клиентов: `products.file_url/file_url_kz`, `payment_methods.qr_code_path`, `order_items.file_url_snapshot/file_url_kz_snapshot/material_files_snapshot/material_files_kz_snapshot`;
- завела 5 новых таблиц сразу с составными ключами: `blocked_users`, `vip_tariffs`, `vip_subscriptions`, `vip_member_profiles`, `product_material_files` + RLS и `GRANT … TO service_role`.

**MIGRATION-02 «Фаза 2 — изоляция» (ломающая, применять после деплоя кода):**
- `current_bot_id()`, роль `tenant_bot`, гранты и `ALTER DEFAULT PRIVILEGES`;
- **смена первичных ключей**: `app_settings` `(key)` → `(bot_id, key)`; `bot_users` `(user_key)` → `(bot_id, user_key)` + уникальный `bot_users_bot_telegram_idx(bot_id, telegram_id)`; обе колонки `bot_id` объявлены `SET NOT NULL`. Имя старого PK не угадывалось (`bot_users_user_key_pkey`), поэтому берётся из `pg_constraint`;
- `force_bot_id()` + `trg_force_bot_id` и политика `tenant_isolation` на 25 таблицах (список включает `order_counters` из Фазы 3, с `CONTINUE WHEN to_regclass(...) IS NULL`);
- политика `tenant_sees_own_bot` на `bots`.

Сопутствующие фазы: **M03** — пер-тенантная нумерация заказов (`order_counters`, `orders.order_no`, `orders_bot_order_no_idx`, триггер); **M04** — автоматическое пересоздание **всех** глобальных уникальных индексов на таблицах с `bot_id` в виде `(bot_id, …)` (именно на глобальном `idx_bot_users_telegram_id_unique` споткнулся первый перенос: один человек в Telegram не мог быть покупателем у двух клиентов); **M06** — снятие временных `DEFAULT bot_id` и заведение ботов DID 02 / Развивашка.

---

## 5. Легаси и мёртвое

### 5.1 Мёртвая схема Instagram-автоматизации прошлого поколения
Семь таблиц — `ig_poll_runs`, `ig_comment_actions`, `ig_post_leads`, `ig_watched_posts`, `ig_keywords`, `ig_exclusions`, `zernio_automations` — **не упоминаются в коде ни одной строкой**, только в `types.ts`. Остатки опроса на другом провайдере (в `ig_post_leads` есть `unipile_comment_id`, слова «unipile» в репозитории нет). Опрос работал 27.07–01.08 (7452 прогона), потом перешли на вебхуки Zernio, код удалили, таблицы и ~5,2 МБ данных остались.

**`MIGRATION-21-drop-dead-instagram-tables.sql` их дропает, но, судя по всему, НЕ применена:** все семь по-прежнему присутствуют в `types.ts` (файл синхронизируется интроспекцией живой базы), а в `MIGRATION-README.md` записи о её применении нет. **Для v2: считать их существующими, но не трогать и не использовать.**

Их поля (из `types.ts`, на случай если понадобится не сломать):
- `ig_keywords`: `id, bot_id, keyword NN, reply_text NN, comment_reply_text, comments_post_id, post_id, post_note, post_shortcode, dm_file_kind/dm_file_name/dm_file_path, is_active NN, created_at NN, updated_at NN`
- `ig_watched_posts`: `id, bot_id, post_id NN, post_shortcode, post_display_id, comments_post_id, caption_snapshot, is_active NN, created_at NN, updated_at NN`
- `ig_poll_runs`: `id, bot_id, started_at NN, finished_at, status NN, posts_polled NN, comments_scanned NN, rules_count NN, matched NN, sent NN, skipped NN, errors, note`
- `ig_exclusions`: `id, bot_id, provider_user_id, username, reason, created_at NN`
- `ig_comment_actions`: `id, bot_id, comment_id NN, comment_text, post_id NN, keyword_id → ig_keywords, lead_id → ig_post_leads, provider_user_id, username, status NN, attempt_no NN, error_message, debug_info, created_at NN`
- `ig_post_leads`: `id, bot_id, post_id NN, provider_user_id NN, username, author_profile_id, keyword_id → ig_keywords, first_comment_id, last_comment_id, last_comment_text, comment_replied_at, dm_status NN, dm_attempts NN, dm_recipient_id, dm_sent_at, first_dm_attempt_at, next_retry_at, retry_until_at, closed_reason, last_error, unipile_comment_id, is_active NN, created_at NN, updated_at NN`
- `zernio_automations`: `id, bot_id, title NN, keywords TEXT[] NN, reply_text NN, dm_text, post_id, is_active NN, trigger_count NN, created_at NN, updated_at NN`

### 5.2 Удалённые объекты
- Функция **`search_products(text)` удалена** (M19; заводилась M07). В `types.ts` её нет.
- `reset_orders_sequence()` **существует, но мертва** — не вызывается, права отозваны у всех кроме владельца.
- Индекс `cart_items_bot_user_key_product_id_key` **дропнут** M54 в пользу варианта с `product_variant_id`.
- Политики `"Public Read product-images"` и `"Public Read product-files"` **удалены** (M20, M33), бакеты закрыты.

### 5.3 Дублирующиеся / устаревающие колонки (живы, но перекрыты новыми)
- `order_items.material_files_snapshot` + `material_files_kz_snapshot` — **перекрыты** `material_files_by_lang` (M37); остаются только ради старых заказов.
- `order_items.file_path_snapshot/file_name_snapshot/file_url_snapshot` и `*_kz_snapshot` — ещё более ранний слой (один файл на язык).
- `products.category_id` — легаси одиночной категории рядом с `category_ids JSONB`.
- `orders.order_no` vs `display_no`: `order_no` перенумеровывается ночной задачей, покупателю показывать надо `display_no`.
- `products.rating_avg/rating_count` — кэш, не источник истины.

### 5.4 Файлы SQL, которые НЕ являются схемой прода
`setup-database.sql` — более старый дубль `COMPLETE-SETUP.sql` (без `is_visible`, `broadcasts`, бакетов). `add-payment-methods.sql`, `add-delivered-language-tracking.sql`, `reset-orders-sequence.sql` — разовые заплатки, их содержимое поглощено `COMPLETE-SETUP.sql` / миграциями.

---

## 6. Известные расхождения и подводные камни для v2

1. **Nullability `bot_id`.** `types.ts` показывает `bot_id: string | null` на всех «фазово-первых» таблицах (`products`, `categories`, `orders`, `order_items`, `app_settings`, `payment_methods`, `broadcasts`, `bot_users`, `cart_items`, `product_images`, `broadcast_recipients`, `zernio_logs`), хотя MIGRATION-02 объявляет `SET NOT NULL` для `app_settings` и `bot_users`, а комментарий в `scripts/sync-db-types.mjs` утверждает «`bot_id` is NOT NULL everywhere». В `Insert`-типах `bot_id` всегда опционален **намеренно** (его ставит триггер). **Перед v2 стоит проверить фактическую nullability запросом к живой базе** — на неё нельзя опираться по типам.
2. **`orders.id` — общая на всю базу BIGSERIAL-последовательность.** Номер для покупателя — `display_no`, внутренний пер-тенантный — `order_no`.
3. **`story_product_tags` выбивается из схемы**: `bot_id`/`product_id` типа TEXT без FK, `UNIQUE(story_id)` глобальный, без RLS и грантов. Тенантность там не обеспечена БД.
4. **`comment_dm_fallback_sends.UNIQUE(automation_id, comment_id)`** — без `bot_id`; `automation_id` — внешний ID Zernio, так что коллизий между тенантами практически быть не должно, но формально изоляции на уникальности нет.
5. **Миграции, применённость которых на бою не подтверждена** (по `MIGRATION-README.md` и комментариям в `types.ts`): **21** (дроп мёртвых ig-таблиц), **65** (`alt_channel_*`), **66** (`unresolved_prompt_*` + `comment_automation_settings`). Записей о 62/67/68/69/70 в README тоже нет — 62/64 подтверждены, остальные надо верифицировать.
6. Ночная чистка `nightly_orders_maintenance()` **удаляет** старые `awaiting_payment/awaiting_confirmation` заказы. Если v2 заводит новый статус «черновик», он под неё попадёт — учитывать условия из M61.
7. Storage-изоляция — **на префиксах путей `{bot_id}/`, не на RLS**. Любой код v2, читающий/удаляющий из бакетов, обязан сверять префикс сам.
