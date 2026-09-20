# Инвентаризация FrogFlow: админ-панель, панель оператора, серверные функции, тесты, UI, скрипты

Обследован `/home/user/frogflow` (TanStack Start + React 19 + Supabase, монорепо-единый бандл, два вида деплоя: клиентский и панель оператора). Ниже — спецификация текущего состояния для переписывания.

---

## 0. Общий каркас (нужен для понимания всего остального)

### Два вида деплоя из одного репозитория

`src/lib/control-plane.server.ts`:

- `isControlPlane()` → `process.env.CONTROL_PLANE === "1"`.
- `assertTenantDeployment()` — первой строкой серверных функций клиентской админки; на панели бросает `"Not found"`.
- Зеркальная половина — `requireOperator()` в `src/lib/operator/guard.server.ts`: на клиентском деплое тоже `"Not found"`.

Причина (прямая цитата из комментария): у панели нет `BOT_ID` и нет ключа арендатора, её подключение к базе идёт под `service_role` в обход RLS — клиентская админка, открытая на панели, показала бы данные ВСЕХ клиентов.

### Корневой роут `src/routes/__root.tsx`

- `createRootRouteWithContext<{ queryClient: QueryClient }>()`.
- `beforeLoad` вызывает `getRuntimeModulesFn()` и кладёт результат в контекст роутера: `{ modules, status, pausedMessage, isPanel, vertical, verticalTitle, defaultFulfillmentKind }`.
- `shellComponent` — `<html lang="en">`, `<HeadContent/>`, `<Scripts/>`; `component` — `QueryClientProvider` + `<Outlet/>` + `<Toaster richColors position="top-center"/>` (sonner).
- Свои `notFoundComponent` (404) и `errorComponent` («This page didn't load», кнопка «Try again» → `router.invalidate()`), оба на английском (расхождение с русским интерфейсом).
- Подключает `src/styles.css?url`.

### Runtime-модули и вертикали

`src/lib/modules/modules.functions.ts` → `getRuntimeModulesFn`:

- На панели (`CONTROL_PLANE=1`) возвращает `emptyModules()`, `status: "active"`, `isPanel: true` — в базу не ходит.
- На клиентском деплое: `loadModules()`, `botStatus()`, `pausedMessage()` из `src/lib/modules/modules.server.ts` — читает строку `bots` по `BOT_ID` (`select status, modules, paused_message`), кеш в памяти процесса на 60 сек, `resetModuleCache()` сбрасывается через `POST /api/internal/reload`.
- Отсутствие `BOT_ID` на клиентском деплое — громкая ошибка.

`src/lib/modules/registry.ts` — канонический реестр модулей (`MODULE_KEYS`, `moduleDef(key)`), поля `title / group / price / status ("available" | "planned") / requires? / note?`. Группы и позиции:

| группа | ключи (цена ₸ разово, `planned` помечен) |
|---|---|
| База | `shop`, `broadcasts`, `multi_files`, `order_status`, `excel_export`, `legal_docs`, `dashboard` — все `price: null` («входит в пакет») |
| Оплата | `robokassa` 25000, `crypto` 25000 *planned*, `receipt_ocr` 20000, `telegram_stars` 17000 *planned*, `coupons` 20000, `gift_certificates` 14000, `upsell` 12000 *planned*, `quiz` 12000 *planned* |
| Каталог | `multi_currency` 18000, `multi_language` 16000, `vip` 22000, `blocked` 14000, `courses` 18000 *planned*, `smart_search` 16000, `web_storefront` 22000, `telegram_mini_app` 28000 |
| Instagram | `instagram` 22000, `dm_shop` 16000 |
| WhatsApp | `whatsapp` 22000, `wa_shop` 16000, `wa_broadcasts` 18000 |
| Удержание | `cart_reminder` 9000, `winback` 24000 *planned*, `funnel` 21000 *planned*, `loyalty` 14000, `referral` 14000 |
| Сервис | `manager_chat` 14000, `helpdesk` 22000 *planned*, `review_request` 7000, `notify_in_bot` 9000 *planned* |
| Аналитика | `crm_pipeline` 14000 *planned*, `admin_roles` 14000 *planned*, `crm_integration` 12000 *planned*, `multi_bot` 23000 *planned* |
| Физические товары | `stock` 12000, `limited_offers` 7000 *planned*, `waitlist` 9000 *planned* |

`src/lib/verticals/registry.ts` — `VERTICAL_KEYS`: `digital` («Цифровые материалы», mode shop, fulfillment digital), `confectionery` («Кондитерская», shop/physical), `flowers` («Цветы и букеты», shop/physical), `consultant` («Консультант (ун. BOVI)», mode consultant), `consultant_universal` («Универсальный консультант», mode consultant). Хелперы `isPhysicalShopVertical()`, `isConsultantVertical()`, у каждой ниши есть `suggestedModules`.

Клиентские хуки: `useModules()` и `useVertical()` читают `useRouteContext({ from: "__root__" })`.

### Подключение к Supabase — `src/integrations-supabase/client.server.ts`

- `supabaseAdmin` — Proxy. `.from()/.rpc()` идут через `dbClient()`: если задан `SUPABASE_TENANT_KEY`, клиент подписывается этим JWT (роль `tenant_bot` + claim `bot_id`), и RLS из `MIGRATION-02` режет строки по арендатору. `.storage` **всегда** отдаётся из `serviceClient()` (service_role), потому что Storage не резолвит кастомную роль.
- `supabaseService` — полный service_role для осознанной кросс-арендаторской работы; так работает вся панель оператора.
- Жёсткая проверка при старте: `BOT_ID` задан, а `SUPABASE_TENANT_KEY` — нет → бросает ошибку («подключение идёт под service_role и видит данные всех клиентов»).
- Поддержка новых «непрозрачных» ключей Supabase (`sb_publishable_` / `sb_secret_`) — кастомный `fetch`, который снимает `Authorization` и ставит `apikey`.
- `src/integrations-supabase/client.ts` — браузерный клиент на `VITE_SUPABASE_*` (используется только `auth-attacher`).
- `src/integrations-supabase/auth-middleware.ts` / `auth-attacher.ts` — сгенерированный каркас Supabase Auth; **в админке и панели оператора не используется**: обе панели авторизуются своими cookie-сессиями, не Supabase Auth.

---

## 1. Админ-панель клиента (per-client)

### 1.1. Аутентификация

**Форма входа — `src/routes/login.tsx`**

- `beforeLoad`: `if (context.isPanel) throw notFound()` — на панели оператора страницы входа в админку не существует.
- Свой самодостаточный словарь `copy: Record<Locale, {...}>` (4 языка) — контекст `AdminLocaleContext` здесь ещё недоступен, потому что рендер идёт до аутентификации. Селектор языка пишет тот же `localStorage["admin-locale"]`, что и панель.
- Поля: логин (по умолчанию заполнено `"admin"`), пароль. Вызывает `adminLogin` через `useServerFn`. `res.ok` → `router.navigate({ to: "/admin" })`, иначе текст «Неверный логин или пароль». `catch` пропускается через `errorMessage(e)` — чтобы блокировка после перебора («попробуйте через N минут») и ошибка окружения были видны, а не «вечный спиннер».
- UI: `Button`, `Input`, `Label` из `components-ui`, нативный `<select>` для языка.

**Серверные функции — `src/lib/admin.functions.ts`** (3 боевых + счётчик)

| функция | метод | что делает |
|---|---|---|
| `adminLogin` | POST | `assertTenantDeployment()` → проверка `ADMIN_USERNAME`/`ADMIN_PASSWORD` заданы → `adminSessionSecretReady()` (иначе вход закрыт с объяснением) → динамический импорт `admin-login-guard.server` → `checkLockout(ip)` → при блокировке пишет попытку и бросает → `loginDelay()` 300 мс → **оба** `secretsMatch()` считаются всегда (чтобы неверное имя не отвечало быстрее неверного пароля) → `recordAttempt` → `s.update({ authed: true, passFp })` |
| `adminLogout` | POST | `assertTenantDeployment()` + `s.clear()` |
| `adminCheck` | GET | `assertTenantDeployment()` + `{ authed: await isAdminAuthed() }` |

Валидатор: `z.object({ username: z.string().min(1), password: z.string().min(1) })`.

**Сессия — `src/lib/admin-session.server.ts`**

- `useSession<AdminSession>` из `@tanstack/react-start/server`; `AdminSession = { authed?: boolean; passFp?: string }`.
- Конфиг: `name: "admin-session"`, `maxAge: 60*60*24*30` (30 дней), cookie `httpOnly: true, secure: true, sameSite: "lax", path: "/"`.
- Секрет: `SESSION_SECRET`, минимум 32 символа. Если короче/нет — подставляется `randomBytes(32)` этого процесса, и `adminSessionSecretReady()` возвращает `false`, из-за чего `adminLogin` вообще отказывает во входе с объяснением. (Исторически подставлялось общеизвестное значение из исходников — cookie можно было подделать.)
- `isAdminAuthed()` сравнивает не только `authed === true`, но и `passFp === adminPasswordFingerprint()` — смена `ADMIN_PASSWORD` в Vercel отзывает уже выданные cookie.
- `requireAdmin()` = `assertTenantDeployment()` + `isAdminAuthed()` иначе `throw new Error("Unauthorized")`.
- `passwordFingerprint()` (`src/lib/password-fingerprint.server.ts`) — `sha256(secret).hex.slice(0,16)`.

**Защита от перебора — `src/lib/admin-login-guard.server.ts`**

- Константы: `WINDOW_MIN = 15`, `MAX_FAILURES = 5`, `KEEP_DAYS = 30`, задержка 300 мс.
- `secretsMatch(a,b)` — `timingSafeEqual(sha256(a), sha256(b))` (хеши, чтобы длины совпадали).
- `clientIp()` — `x-forwarded-for` (первый элемент) → `x-real-ip` → `null`.
- `checkLockout(ip)` — `SELECT count(*) FROM admin_login_attempts WHERE ok=false AND at >= now()-15min [AND ip=…]`. **Любая ошибка базы → не запираем** (таблица заведена `MIGRATION-22` и может быть ещё не применена).
- `recordAttempt(ip, ok)` — `INSERT admin_login_attempts {bot_id: BOT_ID, ip, ok}`; при `ok` дочищает записи старше 30 дней.
- Таблица per-tenant (`bot_id NOT NULL`, обычная политика `tenant_isolation`).

**Гейт роутера — `src/routes/admin.tsx`**

```
beforeLoad: async ({ context }) => {
  if (context.isPanel) throw notFound();
  const res = await adminCheck();
  if (!res.authed) throw redirect({ to: "/login" });
}
```

Важная архитектурная деталь: роутерный гейт — только UX. Настоящая проверка — `requireAdmin()` первой строкой каждой серверной функции, потому что `createServerFn` вызывается по HTTP напрямую (общий эндпоинт `/_serverFn`), мимо `beforeLoad`.

### 1.2. Общий layout `/admin` (`src/routes/admin.tsx`, 13 КБ)

- Оборачивает всё в `AdminLocaleContext.Provider value={{ locale, changeLocale }}`.
- Шапка: заголовок `t("adminPanel", locale)` + бейдж ниши (если `vertical !== "digital"`), навигация, `<select>` языка, кнопка «Выйти» (`adminLogout` + `navigate({to:"/login"})`).
- Навигация **разная в зависимости от ниши**:
  - `isConsultant`: только «Консультант» + «Instagram» (+ «Настройки»).
  - остальные: «Дашборд», группа **Каталог** (Категории / Товары), «Заказы», «Аналитика», группа **Оплата** (Реквизиты / Robokassa / Зоны доставки — последняя только для `isPhysicalShop`), группа **Продвижение** (Рассылка / Промокоды / Сертификаты / Instagram / WhatsApp / Чат с менеджером), группа **Аудитория** (VIP-группа / Блокировка), «Модули», «Настройки».
- Группы реализованы как `DropdownMenu` (`GroupNav` / `GroupLink`) — плоский список из 9+ пунктов перестал умещаться.
- Недоступные модули не `disabled`, а рисуют «🔒» и по клику показывают `toast(t("moduleLockedAlert", locale))` — Radix не вызывает `onSelect` у `disabled`.
- `ManagerChatGroupLink` — бейдж непрочитанных, `useQuery({ queryKey:["manager_chat_total_unread"], queryFn: totalManagerChatUnreadFn, refetchInterval: 20_000 })`.
- Контент — `<main className="max-w-7xl mx-auto p-4 md:p-6"><Outlet/></main>`.

### 1.3. Локализация админки — `src/lib/admin-locale.tsx` + `src/lib/i18n.ts`

`admin-locale.tsx` (700 байт, весь файл):

```tsx
export const AdminLocaleContext = createContext<{ locale: Locale; changeLocale: (next: Locale) => void } | null>(null);
export function useAdminLocale() {
  const ctx = useContext(AdminLocaleContext);
  if (!ctx) throw new Error("useAdminLocale must be used within AdminLayout");
  return ctx;
}
```

- Провайдер — только `AdminLayout` в `admin.tsx`. Состояние — `useState<Locale>("ru")`, читается из `localStorage["admin-locale"]` в `useEffect` (то есть первый рендер всегда `ru`, потом мигает на сохранённый). `changeLocale` пишет в localStorage и ставит `document.documentElement.lang`.
- Ни cookie, ни серверного рендера языка нет; `<html lang="en">` в shell не совпадает с выбранным языком до гидратации.
- `src/lib/i18n.ts`: `SUPPORTED_LOCALES = ["ru","kk","en","uz"]`, `localeNames`, `localeFlags`, `isLocale()`, плоский словарь `messages` (~60 ключей: навигация + общие кнопки save/cancel/delete/edit/add/create/close/loading/saving/confirm/yes/no/search/back/actions/name/status/error/success/noData + модульные `requestConnection/requestSent/alreadyRequested/connected/includedInPlan/moduleLocked/moduleLockedAlert`) и `t(key, locale)`.
- **Главная особенность (важно для переписывания):** общий словарь покрывает только шапку и кнопки. Каждая крупная страница несёт **свой локальный `const copy: Record<Locale, {…}>`** — в `admin.index.tsx` это ~25 ключей ×4 языка, в `admin.settings.tsx` ~110 ключей ×4, в `admin.orders.tsx` ~80 ключей ×4. Это сотни строк переводов, вкопанных в файлы маршрутов.
- Страница `/login` дублирует словарь целиком, потому что контекста там нет.

### 1.4. Страницы админки

Легенда колонки «Гейт»: `C` = `rejectConsultantShopPage(context)` (в нише `consultant` редирект на `/admin/consultant`), `M:x` = `if (!context.modules.x) throw redirect({to:"/admin"})`.

| Маршрут / файл | Строк | Гейт | Что показывает / правит | Серверные функции | Таблицы |
|---|---|---|---|---|---|
| `/admin/` `admin.index.tsx` | 230 | — | Дашборд: 7 плиток (Товары, Всего заказов, Ждут оплаты, Ждут подтверждения, В работе, Готовы к выдаче, Выдано). Плитки «В работе»/«Готовы» показываются только для `isPhysicalShop` или если значение >0. Подсказка «Выдаётся сейчас: N». Блок «Как пользоваться» — 4 шага, свой вариант для digital / physical / consultant. У `isConsultant` плиток нет вовсе. | `getDashboardStats` | `orders`, `products` |
| `/admin/categories` `admin.categories.tsx` | 637 | C | CRUD категорий, дерево (родитель/потомок), порядок, видимость (`setCategoryVisible`), удаление с проверкой привязанных товаров | `listCategories`, `createCategory`, `updateCategory`, `setCategoryVisible`, `deleteCategory`; `getSettings`, `saveSetting` | `categories`, `products`, `app_settings` |
| `/admin/products` `admin.products.tsx` | 1373 | C | CRUD товаров: название, описание, цены (мультивалютность), категории (множественные `category_ids`), изображения (`product_images`), файлы-материалы по языкам (`product_material_files`, `MATERIAL_LANGUAGES`), варианты (`product_variants`), остатки, физический/цифровой. Загрузка через signed upload URL. Постраничное чтение `fetchAll` (PostgREST обрывает на 1000) | `listProducts`, `getProduct`, `saveProduct`, `deleteProduct`, `listCategoriesForProducts`, `getSignedUploadUrl`; `listPaymentMethods` | `products`, `product_images`, `product_material_files`, `product_variants`, `categories`; Storage `product-images` / `product-files` |
| `/admin/orders` `admin.orders.tsx` | 1905 | C | Главный рабочий экран. Список заказов с фильтрами по платформе (Telegram/Instagram/WhatsApp/ручной) и по дате самовывоза (сегодня/завтра/просрочено/без даты). Действия: Подтвердить и выдать, Принять заказ, В работу, Готов, Выдан, Откатить, Выдать заново, Продолжить выдачу (порционная отправка файлов), Напомнить об оплате, Отклонить (с причиной), Заблокировать покупателя, Удалить. Просмотр скриншота чека/квитанции, скачивание. Правка способа выдачи (самовывоз/доставка, адрес, заметка, зона доставки). Ручное создание заказа и ручной платёж. Экспорт заказов и покупателей в CSV за период | `listOrders`, `listCatalogForOrders`, `confirmOrder`, `recordManualPayment`, `createManualOrder`, `updateOrderFulfillment`, `advanceOrderFulfillment`, `revertOrderFulfillment`, `redeliverOrder`, `continueDeliveryOrder`, `rejectOrder`, `remindPaymentOrder`, `deleteOrder`; `blockTelegramUserFn`; `exportOrdersCsvFn`, `exportCustomersCsvFn`; `getAppTimeZone`; `listDeliveryZones` | `orders`, `order_items`, `products`, `bot_users`, `delivery_zones`, `app_settings` |
| `/admin/analytics` `admin.analytics.tsx` | 520 | C | Финансовая аналитика: выручка по валютам, конвертация в одну валюту (вкладка `__combined`), разбивка по периодам/товарам | `getFinancialAnalytics`, `getFinancialAnalyticsConverted` | `orders`, `order_items` |
| `/admin/payment-methods` `admin.payment-methods.tsx` | 372 | C | «Реквизиты»: способы оплаты по странам, инструкции, QR/картинка (signed upload) | `listPaymentMethods`, `savePaymentMethod`, `deletePaymentMethod`; `getSignedUploadUrl` | `payment_methods`, `products` |
| `/admin/robokassa` `admin.robokassa.tsx` | 563 | C + M:`robokassa` | Настройки эквайринга (логин/пароли/тестовый режим) + загрузка юридических документов (оферта, политика) в бакет `legal-docs` | `getSettings`, `saveSetting`, `getLegalDocUploadUrl`, `commitLegalDocFn`, `clearLegalDocFn` | `app_settings`; Storage `legal-docs` |
| `/admin/delivery-zones` `admin.delivery-zones.tsx` | 323 | C | Зоны доставки: район, цена, активность. Перед удалением считает заказы, использующие зону | `listDeliveryZones`, `saveDeliveryZone`, `countOrdersUsingZone`, `deleteDeliveryZone`; `listPaymentMethods` | `delivery_zones`, `orders` |
| `/admin/broadcast` `admin.broadcast.tsx` | 937 | C | Рассылки по базе: составление текста, картинка (signed upload в `broadcast-images`), выбор аудитории с предпросмотром размера, тестовая отправка, запуск, пакетная обработка (`processBroadcastBatchFn` — продолжение очереди), отмена, история. Поддержка WhatsApp-шаблонов | `previewBroadcastAudience`, `sendTestBroadcastFn`, `startBroadcastFn`, `listBroadcastsFn`, `getBroadcastFn`, `processBroadcastBatchFn`, `cancelBroadcastFn`, `getBroadcastUploadUrl`; `getWhatsAppAccountsFn`, `getWhatsAppTemplatesFn`; `listPaymentMethods`; `listProducts` | `broadcasts`, `broadcast_recipients`, `bot_users`, `orders`, `products`, `app_settings`; RPC `increment_broadcast_counts` |
| `/admin/promo-codes` `admin.promo-codes.tsx` | 364 | C | CRUD промокодов (код, тип скидки, лимиты, срок) | `listPromoCodes`, `savePromoCode`, `deletePromoCode` | `promo_codes` |
| `/admin/gift-certificates` `admin.gift-certificates.tsx` | 312 | C | Подарочные сертификаты: выпуск, список, отмена | `listGiftCertificates`, `createGiftCertificate`, `cancelGiftCertificate` | `gift_certificates` |
| `/admin/instagram` `admin.instagram.tsx` | **4664** | M:`instagram` | Крупнейший файл админки. Подключение аккаунта (OAuth-ссылка Zernio), здоровье аккаунта, регистрация вебхука, отключение. Настройки Direct-бота (`settings` / `script` / `features` / `scope` / `triggers`). Список диалогов и переписка, ручная отправка. Дашборд «Instagram за 30 дней». Автоматизации по комментариям (CRUD + вкл/выкл + логи). Посты Zernio, синхронизация по URL, создание/отмена/повтор публикации. Листание комментариев поста, догоняющие private-reply и ответы в комментариях. Настройки авто-ответов по комментариям. Профили контактов. Возврат ИИ-консультанта в диалог. Вкладка «Сторис» (общий компонент `StoriesTab`) | 38 функций из `instagram.functions.ts` (см. §3) | `app_settings`, `bot_users`, `orders`, `zernio_logs`, `comment_automation_settings` |
| `/admin/whatsapp` `admin.whatsapp.tsx` | 792 | C + M:`whatsapp` | Вкладки: **Бот** (настройки), **Шаблоны** (список + создание), **Чаты** (диалоги, переписка, отправка), **Аккаунты** (подключение, здоровье, вебхук, отключение) | `getWhatsAppConnectUrlFn`, `getWhatsAppAccountsFn`, `getWhatsAppAccountHealthFn`, `disconnectWhatsAppAccountFn`, `registerWhatsAppWebhookFn`, `getWhatsAppBotSettingsFn`, `saveWhatsAppBotSettingsFn`, `getWhatsAppTemplatesFn`, `createWhatsAppTemplateFn`, `getWhatsAppConversationsFn`, `getWhatsAppConversationMessagesFn`, `sendWhatsAppConversationMessageFn` | `app_settings`, `whatsapp_templates` |
| `/admin/manager-chat` `admin.manager-chat.tsx` | 235 | C + M:`manager_chat` | Список диалогов с непрочитанными, переписка, «подключиться»/«отключиться» от диалога (передача управления от бота менеджеру), отметка прочитанного, ответ | `listManagerChatConversationsFn`, `totalManagerChatUnreadFn`, `listManagerChatMessagesFn`, `connectManagerChatFn`, `disconnectManagerChatFn`, `markManagerChatReadFn`, `sendManagerChatReplyFn` | `manager_chat_state`, `manager_chat_messages`, `bot_users`; RPC `manager_chat_touch` |
| `/admin/blocked` `admin.blocked.tsx` | 381 | C + M:`blocked` | Список заблокированных, поиск пользователей бота, блокировка/разблокировка с причиной | `listBlockedUsersFn`, `blockTelegramUserFn`, `unblockTelegramUserFn`; `searchTelegramUsersFn` | `blocked_users`, `bot_users`, `orders`, `cart_items`, `vip_subscriptions`, `app_settings` |
| `/admin/vip` `admin.vip.tsx` | 103 | C + M:`vip` | Layout VIP с под-навигацией (Дашборд / Тарифы / Подписчики / Настройки VIP) и жёлтой плашкой «🧪 Тест-режим активен (время в минутах)» при `vip_test_mode === "true"` | `getSettings` | `app_settings` |
| `/admin/vip/` `admin.vip.index.tsx` | 113 | наследует | Три карточки-счётчика: Активных / Ожидают оплаты-подтверждения / Истёкших | `getVipSubscriptions({status:"all"})` | `vip_subscriptions` |
| `/admin/vip/tariffs` `admin.vip.tariffs.tsx` | 676 | наследует | CRUD тарифов VIP, входной тариф, username VIP-бота | `getVipTariffs`, `getVipEntryTariff`, `getVipBotUsername`, `saveVipTariff`, `deleteVipTariff` | `vip_tariffs` |
| `/admin/vip/subscribers` `admin.vip.subscribers.tsx` | 1086 | наследует | Список подписчиков, профили участников группы, ручное добавление, продление, подтверждение/отклонение оплаты, исключение из сообщества, повторная отправка инвайта, удаление; поиск пользователей, проверка членства в группе, блокировка | `getVipSubscriptions`, `getVipMemberProfiles`, `addVipSubscriptionManual`, `extendVipSubscription`, `deleteVipSubscription`, `confirmVipSubscription`, `rejectVipSubscription`, `excludeVipFromCommunity`, `resendVipInvite`; `getSettings`; `blockTelegramUserFn`; `searchTelegramUsersFn`; `lookupVipGroupMemberFn`; `getVipTariffs` | `vip_subscriptions`, `vip_member_profiles`, `vip_tariffs`, `bot_users`, `app_settings` |
| `/admin/vip/settings` `admin.vip.settings.tsx` | 372 | наследует | Настройки VIP (группа, тест-режим, тексты) + ручной запуск VIP-крона | `getSettings`, `saveSetting`, `runVipCronNow` | `app_settings`, `vip_subscriptions` |
| `/admin/modules` `admin.modules.tsx` | 153 | C | Витрина модулей: карточки по группам, бейдж «Подключено», цена или «Входит в пакет», предупреждение «Требует: X» о невыполненных `requires`, кнопка «Заказать подключение» → `requestModuleConnection` (пишет `module_requests` и открывает deep-link `t.me/<OPERATOR_TELEGRAM_USERNAME>` с готовым текстом). Показывает только `status === "available"` | `getPendingModuleRequests`, `requestModuleConnection` | `module_requests` |
| `/admin/settings` `admin.settings.tsx` | **1502** | — (без гейта) | 4 вкладки: **Общее** (получатели уведомлений — Telegram ID, контакт продавца, тайминг выбора языка выдачи), **Магазин** (режим оплаты: полная/задаток с процентом/при получении; самовывоз-доставка; реферальная программа с процентом; лояльность с процентом начисления; напоминание о брошенной корзине с часами; умный поиск с ключом и лимитами; распознавание чека), **Бот** (ссылка на веб-витрину и Mini App с кнопками «Открыть»/«Скопировать», видеоинструкция — загрузка/удаление/подпись, доступ и смена пароля), **Расход** (расход ИИ). Внизу — «Опасная зона»: `resetAllData` | `getSettings`, `saveSetting`, `getShopUrl`, `getMiniAppUrl`, `getInstructionVideoUploadUrl`, `commitInstructionVideoFn`, `clearInstructionVideoFn`; `resetAllData` | `app_settings` + при сбросе: `orders`, `order_items`, `products`, `product_images`, `product_material_files`, `categories`, `cart_items`, `bot_users`, `story_product_tags`, `consultant_catalog_imports`, `consultant_handoffs`, `consultant_message_runs` |
| `/admin/consultant` `admin.consultant.tsx` | **1702** | `rejectNonConsultantPage` (только ниша consultant) | 6 вкладок: **Обзор**, **Диалоги**, **Сторис** (`StoriesTab`), **База знаний**, **Настройка ИИ**, **Диагностика**. Импорт каталога (файл / Google Sheets / Google Drive), курс VTB (авто-обновление и ручная установка), A/B-настройки, чек-лист, задачи, тест уведомлений в Telegram, вкл/выкл бота, возврат бота в диалог, инфо о магазине, база знаний (текст + импорт файла PDF/Word) | 19 функций из `consultant/consultant.functions.ts` | `app_settings`, `zernio_logs` |
| — `admin.stories-tab.tsx` | 385 | не маршрут | Компонент `StoriesTab`, импортируется в `admin.consultant.tsx` и `admin.instagram.tsx`. Теги товаров на сторис | `listStoryTagsFn`, `upsertStoryTagFn`, `deleteStoryTagFn`, `getStoriesFn`, `getConsultantCatalogFn`; `getInstagramAccountsFn` | `story_product_tags` |
| — `admin.instagram.old.tsx` | 218 КБ | **мёртвый файл** | Не должен быть маршрутом, но генератор роутов TanStack при `npm run build` переписывает в нём путь на `/admin/instagram/old` и разводит 4000-строчный мёртвый файл в настоящий маршрут админки (задокументировано в `CLAUDE.md`). Лечится удалением файла | — | — |

**Другие маршруты того же деплоя (не админка, но в одном бандле):** `/` (`index.tsx`), `/shop` (`shop.ts`, 40 КБ — публичная веб-витрина), `/mini-app*` (5 файлов, Telegram Mini App), `/files/$token` (выдача файлов по токену), `legal/` (оферта/политика), и 40 файлов `src/routes/api/**` (см. §3.6).

### 1.5. Гейт модулей на сервере — состояние

`src/lib/modules/require-module.server.ts` содержит `requireModule(key)` и `requireAdminWithModule(key)` с развёрнутым обоснованием («тумблеры были косметикой: серверные функции модуль не проверяли — все 39 требовали только `requireAdmin()`»).

**Фактически используется ровно в двух местах продакшен-кода:** `src/lib/modules/manager-chat.functions.ts` (`requireAdminWithModule("manager_chat")`) и `src/lib/manager-chat.server.ts` (`requireModule("manager_chat")`). Всё остальное (`vip`, `instagram`, `blocked`, `robokassa`, `whatsapp`, `coupons`, `gift_certificates`, `smart_search`, …) на сервере не гейтится — только `beforeLoad` в роутере. При этом `src/lib/modules/registry.test.ts` заявлен как «module registry — every sold module has a server-side gate». **Это ключевой дефект, который надо закрыть в переписывании.**

---

## 2. Панель оператора (владелец платформы)

### 2.1. Аутентификация и изоляция

Три слоя (описаны в `guard.server.ts`, отсылка к `CONTROL-PLANE-PLAN.md §2`):

1. `CONTROL_PLANE=1` задан только на проекте панели.
2. Своя сессия: cookie **`operator-session`**, свой секрет `OPERATOR_SESSION_SECRET`, не пересекается с `admin-session`. `maxAge: 60*60*24*7` (7 дней), `httpOnly/secure/sameSite:"lax"/path:"/"`. `OperatorSession = { authed?, username?, passFp? }`.
3. `requireOperator()` — первой строкой **каждой** серверной функции в `src/lib/operator/*`.

- `operatorSessionSecretReady()` — `OPERATOR_SESSION_SECRET` ≥ 32 символов, иначе подпись случайным секретом процесса и вход закрыт с объяснением (iron-session на коротком секрете падал 500-й без объяснения).
- `requireOperator()`: не тот деплой → `throw new Error("Not found")` (**тот же текст, что и «нет сессии» — намеренно**, клиентский деплой не должен подтверждать даже наличие функции). Сессия: `authed === true && passFp === operatorPasswordFingerprint()`.
- `operatorRouteStatus()` — не бросает, возвращает `"not_this_deployment" | "unauthenticated" | "authenticated"`; только для `beforeLoad`.

**Защита входа — `src/lib/operator/login-guard.server.ts`**: те же `WINDOW_MIN=15`, `MAX_FAILURES=5`, `KEEP_DAYS=30`, `loginDelay()` 300 мс, `secretsMatch` через sha256+`timingSafeEqual`, `clientIp()`. Отличия от админского: таблица `operator_login_attempts` (не per-tenant), при отсутствии IP считает неудачи **по имени пользователя**, ошибки базы логируются в `console.error` (в админском — молча).

**`src/lib/operator/operator-auth.functions.ts`**: `operatorRouteStatusFn` (GET), `operatorLoginFn` (POST, zod `{username,password}`), `operatorLogoutFn` (POST). `operatorLoginFn` сам проверяет `CONTROL_PLANE !== "1"` → `"Not found"`, наличие `OPERATOR_USERNAME`/`OPERATOR_PASSWORD`, готовность секрета, затем lockout → delay → два `secretsMatch` → `recordAttempt` → `s.update({authed, username, passFp})`.

**Роуты-гейты:**

- `src/routes/operator.tsx` — гейт всего поддерева `/operator/*` **включая страницу входа**: `status === "not_this_deployment"` → `notFound()`. Компонент — просто `<Outlet/>`.
- `src/routes/operator.login.tsx` — `status === "authenticated"` → `redirect({to:"/operator"})`. Форма без селектора языка (панель только по-русски), подпись «Не связана со входом в админку клиентов».
- `src/routes/operator._authed.tsx` — **pathless layout**, `not_this_deployment` → `notFound()` (defense in depth), `unauthenticated` → `redirect({to:"/operator/login"})`. Шапка: «Панель оператора», ссылки Клиенты / Заявки (с бейджем) / Рассылка / Счета / Лиды / Журнал, кнопка «Выйти». `<main className="max-w-6xl mx-auto p-4 md:p-6">`. `RequestsNavLink` опрашивает `listPendingModuleRequestsFn` каждые 15 сек.

### 2.2. Страницы панели

| Маршрут / файл | Строк | Что делает |
|---|---|---|
| `/operator/login` `operator.login.tsx` | 103 | Форма входа |
| `/operator/` `operator._authed.index.tsx` | **1440** | **Список клиентов.** Таблица со всеми ботами: статус, ниша, модули (`ModulesCell`), подписка (`SubCell`), заказы за 30 дней (`OrdersCell`, амбра при 14+ днях молчания), здоровье (`HealthCell`), место в Storage. Сортировка по клику на заголовок (клиентская), текстовый поиск, фильтры по подписке/здоровью/модулю/тегам, показ архивных, закрепление клиентов (pin, `localStorage`), настройка видимых колонок (хранится множество **скрытых**, чтобы новая колонка была видна по умолчанию), групповые действия с выделением, экспорт клиентов в CSV, баннер «Требует внимания», дайджест «Что изменилось с прошлого захода» (`SinceLastVisit`, `localStorage`), сводка по деньгам (`MoneySummary`), график выручки по месяцам (`RevenueByMonthChart`, recharts `BarChart`), обзор хранилища (`StorageOverview` + `StorageDonut`), проверка готовности всех деплоев (`ReadinessAll`). Реалтайм — не вебсокеты, а опрос: лёгкие запросы (bots, module_requests, revenue) каждые 15 сек, тяжёлые (stats/health/storage) реже |
| `/operator/$botId` `operator._authed.$botId.tsx` | **1792** | **Карточка клиента**, 8 вкладок: **Обзор** (статус бота: active/paused/suspended, пауза с сообщением), **Модули** (тумблеры по реестру + заявки клиента), **Клиент** (данные владельца: имя, контакт, Telegram ID через `OwnerPicker`, заметки, теги, ниша, архивирование), **Подписка** (`SubscriptionSection`: платежи, добавление/правка/удаление, быстрое продление на N месяцев, политика просрочки warn/suspend с `warn_days_before`/`grace_days`, экспорт CSV), **Расход** (`AiUsageSection` — расход ИИ на деплое, сброс), **Проверка чеков** (`ReceiptAuditSection` — инвентарь и сканирование чеков), **Деплой** (`WebhookSection` — диагностика и «Проставить вебхук»; `EnvBlockSection` — генерация блока переменных окружения с возможностью скачать; `ReadinessSection` — чек-лист готовности; `StatsSection` — показатели + `StorageDonut`; `HealthHistorySection` — история падений с длительностями), **Журнал** (события бота). Навигация «← Пред. / След. →» по лёгкому списку. `botQuery` намеренно **без опроса**, чтобы тихий рефетч не затёр незасохранённую правку формы |
| `/operator/onboard` `operator._authed.onboard.tsx` | 565 | **Подключение нового клиента** — см. §2.3 |
| `/operator/requests` `operator._authed.requests.tsx` | 148 | **Единая очередь заявок** «Заказать подключение» со всех клиентов. Раньше заявка была видна только строкой в баннере на главной или на карточке клиента. Действия: включить модуль (`setModuleFn`) и/или отметить обработанной (`resolveModuleRequestFn`). Тот же `queryKey`, что на главной и в карточке — один кеш на три места |
| `/operator/broadcast` `operator._authed.broadcast.tsx` | 226 | **Рассылка владельцам клиентов** в Telegram. Выбор получателей чекбоксами + быстрые сегменты (`selectSegment`), текст, подтверждение через `confirmToast`, результат по каждому получателю (`DeliveryRow`: `sent` / `failed` / `unreachable` / `skipped`), история рассылок |
| `/operator/invoices` `operator._authed.invoices.tsx` | 436 | **Счета на подписку.** `RequisitesEditor` — реквизиты для выплат (хранятся в `operator_settings`). `CreateInvoiceForm` — выставление счёта клиенту (бот, сумма, валюта, примечание); период по умолчанию считается от `currentExpiresAt`. `InvoiceRow` — статусы `sent / proof_uploaded / paid / rejected / cancelled`, просмотр загруженного клиентом подтверждения оплаты (`getInvoiceProofUrlFn` — подписанная ссылка), `ConfirmForm` (подтвердить с периодом, `periodEnd >= periodStart`), отклонить с причиной, отменить |
| `/operator/leads` `operator._authed.leads.tsx` | 793 | **Продажи/лиды.** Воронка по стадиям (`LEAD_STAGES`), счётчики (`funnelCountsFn`), поиск. `AddLeadForm` (название, ниша, город, сайт, Instagram, телефон, почта, сигналы). `LeadCard`: смена стадии, заметки, удаление, **скоринг ИИ** (`scoreLeadFn`), **генерация черновика письма** (`generateDraftFn`), **автопоиск лидов** (`huntLeadsFn` — DuckDuckGo + извлечение через LLM), отправка аутрича (`sendLeadOutreachFn`: whatsapp/instagram/email), отметка «связались» / «follow-up отправлен», прогон конвейера (`processPipelineFn`), статус конвейера, лента событий лида, настройки конвейера (`savePipelineSettingsFn`: `qualifyMinScore` 50–99, `rejectMaxScore` 0–70, `followUpDays` 1–14, `maxFollowUps` 0–5, `autoHunt/autoEmail/autoWhatsApp/autoInstagram`, `lostAfterDays` 7–90, `whatsappTemplateName`) |
| `/operator/journal` `operator._authed.journal.tsx` | 265 | **Общий журнал** по всем клиентам: `listFeedFn` с фильтрами (клиент, вид события, период через `rangeSince`), клиентский поиск поверх загруженной страницы, «Показать ещё» (смена фильтра начинает ленту заново), экспорт в CSV (`exportFeedCsvFn`), `summarize(payload)` — человекочитаемая строка из JSON события |

### 2.3. Онбординг нового клиента (`operator._authed.onboard.tsx` + `onboard.functions.ts` + `onboard.server.ts`)

**Форма** (разделы «Бот» / «Владелец» / «Модули»):

- Бот: Название, **Идентификатор** (`owner_slug`, только `[a-z0-9_-]`, плейсхолдер `aigul_shop`), **Токен от BotFather** (regex `^\d+:[A-Za-z0-9_-]{30,}$`) с кнопкой проверки → `verifyBotTokenFn` показывает `@username — first_name`, **Адрес деплоя** (URL или пусто), **Ниша** (`Select` по `VERTICAL_KEYS`).
- Владелец: Имя, Контакт (`+7 … / почта`), Telegram ID («Куда панель шлёт сообщения»), **Первый номер заказа** (`first_order_no`, для переноса из старой базы — иначе нумерация у покупателей поедет назад, «ловили на Print KZ»), Заметки.
- Чекбокс «Проставить вебхук сразу».
- Модули: чекбоксы, сгруппированные по `GROUP_ORDER = ["База","Оплата","Каталог","Instagram","Удержание","Сервис","Аналитика","Физические товары"]`. По умолчанию выбраны `BASE_MODULES` (все `available` с `price === null`). Пресеты **заменяют** выбор целиком: «Магазин» (как Print KZ и SALTANAT), «Магазин + VIP» (как Дидактика), «Магазин + Instagram» (как Развивашка), плюс кнопка «Как у ниши» → `presetForVertical()` = `BASE_MODULES ∪ verticalDef(key).suggestedModules`. Ниша **сама модули не включает** — осознанное решение (иначе тихая рассинхронизация).
- Итоговая сумма по платным модулям считается тут же.

**`onboardClient(input, actor)` — последовательность:**

1. `requireOperator()`.
2. Проверка занятости `owner_slug` (`SELECT id FROM bots WHERE owner_id=…`) → понятное «уже занят», а не сырая ошибка Postgres.
3. `verifyBotToken(bot_token)` — обращение к Telegram `getMe`.
4. Валидация модулей: неизвестные → ошибка; `status !== "available"` → «нельзя включить модули, которых ещё нет в коде».
5. Строится полный `Record<ModuleKey, boolean>` (все ключи реестра, не только выбранные).
6. `INSERT bots` — `bot_name`, `owner_id`, `status:"active"`, `modules`, `vertical`, `app_url`, `internal_secret` (`randomSecret()`), `owner_name`, `owner_contact`, `owner_telegram_id`, `notes`. **`bot_token` намеренно не заполняется: панель не хранит токенов Telegram.**
7. `INSERT order_counters {bot_id, last_no: first_order_no}` (MIGRATION-03, свой счётчик на арендатора). Ошибка → `warning`, не отказ.
8. `buildEnvBlockFor({botId, mode:"new", botToken, appUrlOverride})` — тот же модуль, что и кнопка в карточке существующего клиента.
9. Если `set_webhook` → `setTelegramWebhook(token, appUrl, webhookSecret)` — POST `api.telegram.org/bot<token>/setWebhook` на `${appUrl}/api/public/telegram/webhook` с тем же `secret_token`, что попал в блок (разойдись они — деплой начнёт отклонять апдейты 403), `drop_pending_updates: false`, таймаут 10 сек. Иначе warning «сделайте после того, как проект Vercel поднимется».
10. Если включён `vip` → warning: второй бот отсюда не настраивается, нужен `VIP_BOT_TOKEN` + кнопка «Проставить вебхук» в карточке.
11. `logEvent(botId, actor, "onboard", {...})` — **без токена и ключей**, журнал читается в панели.
12. Возврат: `{ botId, botUsername, tenantKeyExpiresAt, envBlock, webhook:{attempted,ok,detail}, warnings }`.

**Экран результата `OnboardDone`:** «Клиент подключён», «Переменные для проекта Vercel» (готовый блок для копирования), «Что дальше».

**`buildEnvBlockFor` (`src/lib/operator/env-block.server.ts`)** — режимы `"new"` (весь набор + свежие секреты) и `"running"` (только то, что не сломает работающий деплой; `omitted[]` перечисляет пропущенное; `webhookSecret: null`). Состав блока:

```
# ── Арендатор ──
BOT_ID=…
SUPABASE_TENANT_KEY=…      # mintTenantKey(botId, 5 лет), HS256 на SUPABASE_JWT_SECRET, role=tenant_bot
VERTICAL=…                 # печатается только если != digital; иначе комментарий-инструкция удалить старую
# ── Общая база ──
SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_PUBLISHABLE_KEY
VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY
# ── Приложение ──
PUBLIC_APP_URL=…
# ── Telegram (только mode="new") ──
TELEGRAM_BOT_TOKEN / TELEGRAM_WEBHOOK_SECRET=randomSecret(16)
# + VIP-блок, Zernio-блок (zernioApiKey/zernioProfileId), SMTP-блок (при instagram)
```

`panelSelfCheck()` проверяет на самой панели наличие `OPERATOR_SESSION_SECRET`, `SUPABASE_JWT_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PUBLISHABLE_KEY` и сверяет размер реестра модулей (`count`, `hasTelegramMiniApp`) — проверка, что сборка панели актуальна. Предупреждения при сборке блока: нет адреса деплоя; включён VIP без токена; включён Instagram без ключа Zernio; включён Instagram без SMTP («покупатель дойдёт до оплаты, а получить материалы не сможет»).

### 2.4. Серверный слой панели (`src/lib/operator/`)

| файл | размер | назначение |
|---|---|---|
| `guard.server.ts` | 4.6 КБ | сессия + `requireOperator` + `operatorRouteStatus` |
| `login-guard.server.ts` | 4.7 КБ | lockout/timing-safe/clientIp |
| `operator-auth.functions.ts` | 3.4 КБ | 3 серверные функции входа |
| `bots.functions.ts` | 13 КБ | **27** серверных функций |
| `bots.server.ts` | **49 КБ** | `listBots`, `getBot`, `setModule`, `setBotStatus`, `updateBotMeta`, `setArchived`, `listBotEvents`, `checkBotHealth`, `fetchBotAiUsage`, `resetBotAiUsage`, `fetchBotReceiptAuditInventory`, `scanBotReceipt`, `requestWebhookSetup`, `loadHealthAll`, `getHealthHistory`, `exportHealthHistoryCsv`, `checkReadiness`/`checkReadinessAll`, `listOwnerCandidates`, `listFeed`, `exportFeedCsv`, `loadStats`, `exportClientsCsv`, `loadStorageByKind` |
| `env-block.server.ts` | 17 КБ | `mintTenantKey`, `randomSecret`, `verifyBotToken`, `panelSelfCheck`, `buildEnvBlockFor` |
| `onboard.functions.ts` / `onboard.server.ts` | 2.3 / 9 КБ | онбординг |
| `invoices.functions.ts` / `invoices.server.ts` | 3.4 / 12.8 КБ | счета: `getPayoutRequisites`, `setPayoutRequisites`, `createInvoice`, `listInvoices`, `getInvoiceProofUrl`, `confirmInvoice`, `rejectInvoice`, `cancelInvoice` |
| `subscriptions.functions.ts` / `subscriptions.server.ts` | 4.4 / 14.8 КБ | `computeState` (чистая), `readPolicy`/`DEFAULT_POLICY`, `listPayments`, `getSubscription`, `addPayment`, `updatePayment`, `deletePayment`, `setPolicy`, `getRevenueSummary`, `getRevenueByMonth`, `exportPaymentsCsv` |
| `subscription-cron.server.ts` | 8.9 КБ | `sweepSubscriptions(now)` — просрочка → warn → suspend, идемпотентность через `payload->>sweep_marker` |
| `broadcast.functions.ts` / `broadcast.server.ts` | 0.8 / 5.3 КБ | `broadcastToOwners`, `listBroadcasts` |
| `leads.functions.ts` / `leads.server.ts` | 6.3 / **34 КБ** | лиды целиком |
| `leads-pipeline.ts` | 17.7 КБ | **чистые функции** конвейера: `parsePipelineSettings`, `decideAfterScore`, `nextActionForStage`, `shouldFollowUp`, `shouldMarkLost`, `isActionDue`, `normalizeHandle/Url/Phone`, `isDuplicate`, `pickOutreachChannel`, `whatsappHref/mailtoHref/instagramHref`, `matchInboundLead`, `shouldPromoteToReplied`, `pickZernioAccount`, `canAutoSendChannel`, `outreachBody`, `HUNT_QUERIES`, `huntQueryForDay`, `parseDuckDuckGoHtml`, `clampCandidate`, `parseExtractedLeads`, `searchHitsPromptBlock`, `ICP_EXTRACT_RULES` |
| `leads-ai.server.ts`, `leads-hunt.server.ts`, `leads-outreach.server.ts` | 1.6 / 5 / 6.2 КБ | ИИ-скоринг, автопоиск, отправка |
| `module-requests.functions.ts` | 2.8 КБ | `listPendingModuleRequestsFn`, `resolveModuleRequestFn` |
| `events.server.ts` | 2 КБ | `logEvent(botId, actor, kind, payload)`; `BotEventKind` — union из 12 значений, совпадающий с `CHECK` на `bot_events.kind` (MIGRATION-12/14). Неудачная запись **всегда** логируется, но действие не отменяет |
| `health-snapshot-cron.server.ts` | 3.2 КБ | `recordHealthSnapshots()` |
| `internal-client.server.ts` | 3.4 КБ | `callInternal()` — вызовы `/api/internal/*` на деплоях клиентов, таймауты 10 сек / 45 сек для аудита чеков |
| `format.ts` | 0.6 КБ | `formatBytes`, `daysSince` |
| `ai-usage-section.tsx`, `receipt-audit-section.tsx` | 4.2 / 17 КБ | **React-компоненты, живущие в `src/lib/`** (нарушение раскладки) |

**Таблицы, к которым ходит панель** (всё под `service_role`, мимо RLS):
`bots` (31 обращение), `sales_leads` (23), `subscription_payments` (9), `subscription_invoices` (7), `bot_events` (6), `operator_settings` (4), `bot_health_snapshots` (4), `operator_login_attempts` (3), `sales_lead_events` (2), `operator_broadcasts` (2), `module_requests` (2), `zernio_logs`, `order_counters`, `bot_users`, `app_settings`.
RPC: `operator_bot_stats`, `operator_storage_by_kind`.

---

## 3. Раскладка серверных функций

### 3.1. Инвентарь `*.functions.ts` (33 файла, 268 `createServerFn`)

| файл | `createServerFn` | гейт |
|---|---|---|
| `admin.functions.ts` | 4 | `assertTenantDeployment()` |
| `analytics.functions.ts` | 3 | requireAdmin |
| `blocked-users.functions.ts` | 4 | requireAdmin |
| `broadcast.functions.ts` | 9 | requireAdmin |
| `categories.functions.ts` | 6 | requireAdmin |
| `consultant/consultant.functions.ts` | 20 | requireAdmin |
| `consultant/story-tags.functions.ts` | 6 | **нет `requireAdmin`** (использует `BOT_ID` напрямую) |
| `delivery-zones.functions.ts` | 5 | requireAdmin |
| `export.functions.ts` | 3 | requireAdmin |
| `gift-certificates.functions.ts` | 4 | requireAdmin |
| `instagram.functions.ts` | **39** | requireAdmin |
| `modules/manager-chat.functions.ts` | 8 | `requireAdminWithModule("manager_chat")` |
| `modules/module-requests.functions.ts` | 3 | requireAdmin |
| `modules/modules.functions.ts` | 2 | **нет** (публичный runtime-контекст) |
| `orders.functions.ts` | 16 | requireAdmin |
| `payment-methods.functions.ts` | 4 | requireAdmin |
| `products.functions.ts` | 7 | requireAdmin |
| `promo-codes.functions.ts` | 4 | requireAdmin |
| `reset.functions.ts` | 2 | requireAdmin |
| `settings.functions.ts` | 12 | requireAdmin |
| `users-search.functions.ts` | 2 | requireAdmin |
| `vip-group-members.functions.ts` | 4 | requireAdmin (3 из 4) |
| `vip-subscriptions.functions.ts` | 15 | requireAdmin (13) |
| `vip-tariffs.functions.ts` | 6 | requireAdmin |
| `whatsapp.functions.ts` | 13 | requireAdmin |
| `operator/*` (8 файлов) | 77 | `requireOperator()` (кроме `operator-auth`, `leadsAiConfiguredFn`, `pipelineStatusFn`, `listLeadEventsFn` — **три функции лидов без `requireOperator`**) |

### 3.2. Канонический шаблон файла

```ts
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "./admin-session.server";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

export const listX = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const s = await db();
  const { data, error } = await s.from("x").select("*");
  if (error) throw new Error(error.message);
  return data;
});

export const saveX = createServerFn({ method: "POST" })
  .validator((d: unknown) => SaveInput.parse(d))
  .handler(async ({ data }) => { await requireAdmin(); … });
```

Правила, выдержанные почти везде:

1. **`db()` — локальный хелпер с динамическим `await import()`**. Причина зафиксирована в комментарии `client.server.ts`: «Route files and `*.functions.ts` ship to the client bundle» — статический импорт `.server.ts` из `.functions.ts` втянул бы серверный код в клиентский бандл. Тот же приём применён к `admin-login-guard.server`, `modules/require-module.server`, `app-origin.server`, `datetime` и т.д.
2. **Валидация — zod в `.validator()`**, схема объявляется рядом (`SaveInput`, `BotIdInput`, `IsoDate = /^\d{4}-\d{2}-\d{2}$/`, `.refine()` для «конец периода раньше начала»).
3. **Авторизация — первой строкой `.handler()`**, не в middleware. Глобальных `functionMiddleware` для панелей нет (сгенерированные `attachSupabaseAuth`/`requireSupabaseAuth` не подключены).
4. Ошибки — `throw new Error(error.message)`; на клиенте разбираются через `errorMessage(e)`.
5. Тяжёлые списки читаются постранично через `fetchAll()` из `csv.ts` (PostgREST молча обрывает на 1000 строк).
6. Возвращаемые значения — `{ ok: true as const }` для мутаций, чтобы тип был литеральным.

### 3.3. Как определяется арендатор

**Через переменную окружения деплоя, не через запрос.** Это и есть причина «один клиент = один деплой Vercel».

- Основной механизм — **неявный**: `supabaseAdmin` подписан `SUPABASE_TENANT_KEY` (JWT `role: tenant_bot` + claim `bot_id`), RLS из `MIGRATION-02` фильтрует каждый `SELECT/INSERT/UPDATE/DELETE`. Серверная функция **не пишет `WHERE bot_id = …`** — этого просто нет в `settings.functions.ts`, `products.functions.ts`, `orders.functions.ts` и т.д.
- **Явное** чтение `process.env.BOT_ID` — 51 место в 34 файлах (13 из них в тестах), из `*.functions.ts` только там, где RLS не работает:
  - `products.functions.ts:41`, `settings.functions.ts:99,186`, `broadcast.functions.ts:119` — **ключи Storage**: `${botId}/…`, потому что бакеты общие и `.storage` всегда идёт под service_role. Валидация чужих ключей — `isOwnTenantStorageKey()` (`tenant-storage-key.server.ts`, приводит `BOT_ID` к нижнему регистру).
  - `modules/module-requests.functions.ts` — `requireBotId()`, потому что `module_requests` читает и панель.
  - `reset.functions.ts:15`, `instagram.functions.ts:22`, `whatsapp.functions.ts:24`, `consultant/story-tags.functions.ts`.
  - `modules/modules.server.ts` — `SELECT … FROM bots WHERE id = BOT_ID`.
  - `admin-login-guard.server.ts:67` — `bot_id` в `admin_login_attempts`.
- `src/lib/tenant-router.server.ts` — **альтернативный, частично мёртвый** механизм: `resolveTenant({accountId, username, botId})` ищет арендатора по входящему событию Zernio в `bot_accounts`/`bots` (кеш 60 сек), с фоллбэком `defaultFallbackTenant()` из `BOT_ID`/`VERTICAL`. Файл начинается с `declare const process: any` и использует `as any` на таблицах — то есть таблица `bot_accounts` отсутствует в сгенерированных типах. Это заготовка мультиарендности в одном деплое, до конца не доведённая.
- Панель оператора арендатора не имеет вовсе: `service_role`, `botId` приходит параметром из UI и валидируется как `z.string().uuid()`.

### 3.4. Service role vs tenant key — сводка

| путь | клиент | RLS |
|---|---|---|
| `supabaseAdmin.from()/.rpc()` на клиентском деплое | `tenant_bot` (если задан `SUPABASE_TENANT_KEY`) | **да**, по `bot_id` |
| `supabaseAdmin.storage` | всегда `service_role` | нет — изоляция префиксом `BOT_ID/` вручную |
| `supabaseService.*` | `service_role` | нет |
| всё в `src/lib/operator/*` | `service_role` | нет |
| браузерный `supabase` (`client.ts`) | publishable key | обычные политики; в панелях не используется |

### 3.5. Ключевые вспомогательные server-модули

`orders.server.ts` (84 КБ), `bot.server.ts` (**321 КБ** — Telegram-бот целиком), `zernio-bot.server.ts` (254 КБ — Instagram/WhatsApp), `direct-purchase.server.ts` (95 КБ), `vip-bot.server.ts` (64 КБ), `mini-app-runtime.ts` (69 КБ), `broadcast.server.ts`, `fulfillment.server.ts`, `receipt-verify.server.ts`, `pricing.server.ts`, `smart-search.server.ts`, `manager-chat.server.ts`, `comment-dm-fallback.server.ts`, `webhook-ensure.server.ts`, `mail.server.ts`, `logger.server.ts`, `cron-auth.server.ts`, `internal/internal-api.server.ts` (20 КБ), `internal/diagnostics.server.ts` (26 КБ). Плюс `bot.server.ts.old` (657 КБ) в корне репозитория.

### 3.6. API-роуты (`src/routes/api/`, 40 файлов)

- `api/admin/` — `upload.ts`, `file/$.ts`.
- `api/cron/` (9) — `broadcast`, `cart-reminder`, `comment-dm-fallback`, `consultant-vtb`, `ensure-webhook`, `fulfillment-reminder`, `manager-chat-prune`, `misc-retention`, `zernio-logs-prune`, `zernio-retry`. Авторизация — `isCronAuthorized(request)` из `cron-auth.server.ts`: общий `CRON_SECRET`, `timingSafeEqual`, принимается и в `Authorization: Bearer …` (Vercel-native cron), и в query `?secret=` (внешний cron-job.org на Hobby-плане — «осознанный компромисс», параметр оседает в логах доступа).
- `api/operator-cron/` (4) — `health-snapshot`, `leads`, `retention`, `subscriptions`.
- `api/internal/` (7) — `ai-usage`, `diagnostics`, `health`, `notify-owner`, `receipt-audit`, `reload`, `set-webhook`. Авторизация — `authenticateInternalRequest` (`internal/internal-api.server.ts`) по `internal_secret` строки `bots`; вызывается панелью через `callInternal()`.
- `api/public/` — `telegram/webhook`, `telegram/webhook-vip`, `telegram/ensure-webhook`, `zernio/webhook`, `robokassa/{result,success,fail}`, `mini-app/{cart,checkout,library,orders,proof,search}`, `shop/handoff`, `img/$`, `vip/cron`.
- `api/operator/zernio-webhook.ts`.
- `vite.config.ts` задаёт для Vercel `maxDuration`: `/_serverFn/**` 60 сек, `/api/cron/comment-dm-fallback` 120 сек, остальные перечисленные — 60 сек.

---

## 4. Тесты

### 4.1. Конфигурация и моки

**`vitest.config.ts` (весь файл, 19 строк):**

```ts
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
```

- Отдельный конфиг **намеренно**, не `vite.config.ts`: там плагины TanStack Start и Nitro, которые собирают приложение целиком.
- **`setupFiles` нет. `globalSetup` нет. Файлов-хелперов для тестов нет.** Никакого общего окружения, никакой общей фабрики моков.
- `environment: "node"` — **ни одного теста на React-компоненты**: `jsdom`/`@testing-library` не установлены. `include` ограничен `*.test.ts`, `.tsx` не подхватывается.
- `testTimeout: 30_000` — ради интеграционных тестов, ходящих в настоящую базу.
- Скрипты: `npm test` = `vitest run`, `npm run test:watch` = `vitest`.

**Моки** — только локальные, `vi.mock(...)` внутри самого файла, 26 файлов из 106:

- Мок Supabase — рукописный объект с цепочкой `from().select().eq().single()`, свой в каждом файле (пример из `env-block.test.ts` бросает «неожиданная таблица в моке», если запрошена не та таблица).
- Мок `./guard.server` / `admin-session.server` — подмена `requireOperator`/`requireAdmin` на `vi.fn(async () => {})`.
- Мок сети — `vi.stubGlobal`/подмена `fetch` (`receipt-verify` 18 мест, `zernio-base-url` 4, `pricing` 2, `smart-search` 3, `currency` 6).
- Интеграционные тесты **не мокают ничего**, а собирают настоящий клиент из env и гейтятся `describe.skipIf(!ready)`.

### 4.2. Полный список тестовых файлов и количество тестов

Подсчёт по запрошенному шаблону `grep -c "it(\|test("`. **106 файлов, 1086 тестов.**

**`src/` (17 файлов, 214 тестов) — тесты рядом с кодом:**

| файл | тестов | первый `describe` |
|---|---|---|
| `src/lib/comment-dm-fallback.test.ts` | 29 | `commentMatchesAutomation` |
| `src/lib/consultant/bovi-features.test.ts` | 7 | `BOVI Consultant Features` |
| `src/lib/cron-auth.test.ts` | 7 | `isCronAuthorized` |
| `src/lib/csv.test.ts` | 14 | `cell — экранирование значения` |
| `src/lib/error-message.test.ts` | 9 | `errorMessage` |
| `src/lib/internal/internal-api.test.ts` | 8 | `authenticateInternalRequest` |
| `src/lib/logger.test.ts` | 9 | `truncate` |
| `src/lib/manager-chat.test.ts` | 6 | `handleManagerChatInbound` |
| `src/lib/modules/registry.test.ts` | 2 | `module registry — every sold module has a server-side gate` |
| `src/lib/modules/require-module.test.ts` | 8 | `requireModule` |
| `src/lib/operator/env-block.test.ts` | 7 | `buildEnvBlockFor` |
| `src/lib/operator/leads-pipeline.test.ts` | 46 | `parsePipelineSettings` |
| `src/lib/operator/subscription-cron.test.ts` | 9 | `sweepSubscriptions` |
| `src/lib/operator/subscriptions.test.ts` | 13 | `computeState — границы состояний` |
| `src/lib/tenant-storage-key.test.ts` | 5 | `isOwnTenantStorageKey` |
| `src/lib/verticals/vertical.test.ts` | 16 | `currentVertical — deploy-level discriminator` |
| `src/lib/vip-subscriptions.test.ts` | 9 | `activateVipSubscription` |

**`tests/` (89 файлов, 872 теста):**

| файл | тестов | | файл | тестов |
|---|---|---|---|---|
| `admin-order-notify.test.ts` | 6 | | `mini-app-auth.test.ts` | 4 |
| `ai-usage.test.ts` | 5 | | `mini-app-catalog.test.ts` | 13 |
| `analytics.test.ts` | 16 | | `mini-app-library.test.ts` | 5 |
| `bot-order-placement.test.ts` | 4 | | `mini-app-rate-limit.test.ts` | 5 |
| `bot-user-claim.test.ts` | 1 | | `mini-app-regressions.test.ts` | 28 |
| `broadcast-audience.test.ts` | 6 | | `mini-app-related.test.ts` | 4 |
| `broadcast-create.test.ts` | 3 | | `mini-app-text.test.ts` | 2 |
| `cart-reminder.test.ts` | 5 | | `mini-app-validation.test.ts` | 4 |
| `category-tree.test.ts` | 3 | | `misc-retention.test.ts` | 3 |
| `confectioner-admin.test.ts` | 16 | | `order-files-page.test.ts` | 8 |
| `consultant-1c-price.test.ts` | 8 | | `order-platform.test.ts` | 4 |
| `consultant-ask-manager.test.ts` | 4 | | `orders-pure.test.ts` | 11 |
| `consultant-broad-answer.test.ts` | 10 | | `payment-proof.test.ts` | 2 |
| `consultant-cache-cost.test.ts` | 16 | | `pricing.test.ts` | 20 |
| `consultant-catalog-match.test.ts` | 16 | | `product-materials.test.ts` | 25 |
| `consultant-dialogues.test.ts` | 33 | | `promo-codes.test.ts` | 4 |
| `consultant-discontinued.test.ts` | 13 | | `receipt-audit.test.ts` | 20 |
| `consultant-doc-text.test.ts` | 7 | | `receipt-ocr-auto.test.ts` | 6 |
| `consultant-finkaz-rate.test.ts` | 8 | | `receipt-verify.test.ts` | 51 |
| `consultant-knowledge-search.test.ts` | 4 | | `reviews-server.test.ts` | 4 |
| `consultant-manager-guard.test.ts` | 8 | | `reviews.test.ts` | 6 |
| `consultant-notify-recipients.test.ts` | 6 | | `robokassa.test.ts` | 11 |
| `consultant-run-insert.test.ts` | 3 | | `smart-search.test.ts` | 14 |
| `consultant-settings-write.test.ts` | 4 | | `telegram-init-data.test.ts` | 3 |
| `consultant-style-budget.test.ts` | 16 | | `telegram-webapp-init-data.test.ts` | 9 |
| `consultant-usage-stats.test.ts` | 4 | | `tenant-isolation.test.ts` | 7 |
| `consultant-vtb-rate.test.ts` | 12 | | `vip-flow.test.ts` | 24 |
| `consultant.test.ts` | **73** | | `web-storefront-handoff.test.ts` | 2 |
| `currency.test.ts` | 4 | | `whatsapp-activation.test.ts` | 13 |
| `datetime.test.ts` | 5 | | `whatsapp-broadcast-audience.test.ts` | 3 |
| `delivery-message.test.ts` | 4 | | `whatsapp-catalog.test.ts` | 14 |
| `delivery-zones.test.ts` | 5 | | `whatsapp-contact-exclusions.test.ts` | 3 |
| `direct-flow.test.ts` | **57** | | `zernio-account-disconnected.test.ts` | 4 |
| `direct-purchase.test.ts` | 14 | | `zernio-automation-body.test.ts` | 8 |
| `direct-receipt-download.test.ts` | 3 | | `zernio-base-url.test.ts` | 5 |
| `direct-reply.test.ts` | 2 | | `zernio-idempotency.test.ts` | 6 |
| `fulfillment-dates.test.ts` | 10 | | `zernio-inbox-order.test.ts` | 3 |
| `fulfillment-kind.test.ts` | 5 | | `zernio-inbox-shape.test.ts` | 2 |
| `fulfillment-reminder.test.ts` | 10 | | `zernio-logs-retention.test.ts` | 2 |
| `fulfillment.test.ts` | 18 | | `zernio-message.test.ts` | 17 |
| `gift-certificates.test.ts` | 5 | | `zernio-post-ids.test.ts` | 9 |
| `instagram-inbox-message.test.ts` | 1 | | `zernio-retry.test.ts` | 2 |
| `invoices-server.test.ts` | 11 | | `zernio-webhook.test.ts` | 13 |
| `loyalty.test.ts` | 7 | | | |
| `manual-order.test.ts` | 8 | | | |

### 4.3. Категоризация

**(A) Чистые функции, без моков и без базы — ~80 файлов, ~900 тестов. Основная масса.**
Примеры: `direct-flow` (57, разбор текста Direct), `consultant.test` (73), `receipt-verify` (51 — разбор чеков, но с подменой `fetch`), `leads-pipeline` (46), `product-materials` (25), `vip-flow` (24), `pricing` (20), `receipt-audit` (20), `zernio-message` (17), `analytics` (16), `confectioner-admin` (16), `csv` (14), `whatsapp-catalog` (14), `error-message` (9), `logger` (9), `tenant-storage-key` (5), `orders-pure` (11), `datetime` (5), `robokassa` (11, md5), `telegram-init-data` (3), `gift-certificates`/`promo-codes` (нормализация кодов).

**(B) С моками (`vi.mock`) — 26 файлов.**
Мокается Supabase-клиент и/или гейт авторизации, чтобы протестировать серверную логику без базы: `src/lib/operator/env-block.test.ts` (7), `subscription-cron.test.ts` (9), `internal/internal-api.test.ts` (8), `manager-chat.test.ts` (6), `modules/require-module.test.ts` (8), `vip-subscriptions.test.ts` (9, + подмена fetch), `tests/invoices-server.test.ts` (11, 5 моков), `pricing.test.ts` (9 моков), `mini-app-auth` (3), `mini-app-related` (3), `broadcast-audience`, `broadcast-create`, `consultant-run-insert`, `consultant-settings-write`, `consultant-notify-recipients` (2), `zernio-account-disconnected` (2), `direct-reply` (2), `reviews-server`, `whatsapp-broadcast-audience`, `zernio-retry`, `consultant-ask-manager`, `consultant-broad-answer`, `consultant-discontinued`, `mini-app-library`, `currency`, `receipt-verify`.

**(C) Интеграционные, требующие живой базы — 11 файлов, 64 теста под `describe.skipIf(!ready)`.**
`ready` собирается из env (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` [+ `SUPABASE_JWT_SECRET`, а в `tenant-isolation` ещё и `SUPABASE_PUBLISHABLE_KEY`]):

| файл | всего | под `skipIf` | вне |
|---|---|---|---|
| `tests/fulfillment.test.ts` | 18 | 18 | 0 |
| `tests/direct-purchase.test.ts` | 14 | 14 | 0 |
| `tests/tenant-isolation.test.ts` | 7 | 7 | 0 |
| `tests/delivery-zones.test.ts` | 5 | 5 | 0 |
| `tests/fulfillment-kind.test.ts` | 5 | 5 | 0 |
| `tests/bot-order-placement.test.ts` | 4 | 4 | 0 |
| `tests/fulfillment-reminder.test.ts` | 10 | 4 | 6 |
| `tests/misc-retention.test.ts` | 3 | 3 | 0 |
| `tests/zernio-logs-retention.test.ts` | 2 | 2 | 0 |
| `tests/zernio-retry.test.ts` | 2 | 2 | 0 |
| **Итого** | | **64** | |

(`src/lib/operator/env-block.test.ts` читает `SUPABASE_SERVICE_ROLE_KEY` из env, но полностью мокает Supabase — это категория B.)

**Чего тестов нет вообще:**
- ни одного теста на React-компоненты и страницы (нет jsdom, `include` не берёт `.tsx`);
- нет тестов на `admin-session.server.ts`, `admin-login-guard.server.ts`, `admin.functions.ts`, `control-plane.server.ts`, `guard.server.ts`, `login-guard.server.ts` — **вся аутентификация обеих панелей не покрыта**;
- нет тестов на `onboard.server.ts` (сам онбординг), `bots.server.ts`, `leads.server.ts`, `broadcast.server.ts` панели;
- по `ANALYSIS.md §«Тестов на эту часть нет»` (строки 737–746): «код, который трогает деньги и базу (`createOrderFromCart`, `handlePurchaseFlow`, вся приёмка чека и автовыдача в `zernio-bot.server.ts`), тестами не покрыт вовсе». Часть этого закрыта позже (`direct-purchase`, `fulfillment`), но только интеграционными, которые в CI скипаются.

### 4.4. «19 тестов падают исторически» — что это на самом деле

Фраза есть **ровно в одном месте — `CLAUDE.md:28`**:

```
npm test            # 19 тестов падают исторически, см. ANALYSIS.md
```

Она появилась одним коммитом вместе с самим файлом `CLAUDE.md` (`a0c63d9 docs: record that work goes straight to master`).

**В `ANALYSIS.md` (111 КБ) такого раздела нет.** Полный поиск по `\b19\b` даёт четыре попадания, ни одно не про тесты:
- строка 19 — описание проекта («React 19»);
- строка 510 — `comment.received | 19 088 | 69,2 %` (таблица событий Zernio);
- строка 677 — заголовок «Пятое обследование: магазин в Instagram Direct (19 коммитов после четвёртого раунда)»;
- строка 873 — «Первые попытки применить `MIGRATION-18/19/20` через Management API».

Что про состояние тестов в `ANALYSIS.md` действительно написано:
- строка 445: «**`tsc` — 0. Сборка проходит. Тесты 44 из 44.**» — снимок на момент первого обследования;
- строка 1395: «`vitest run` (**153 пройдено / 21 пропущено** — те же пропуски, что и раньше, без доступа к живой базе из этой сессии)» — и там же прямо сказано, что доступ к живой базе «заблокировал защитный классификатор среды».

**Вывод для переписывания:** отсылка в `CLAUDE.md` — висячая. Наиболее правдоподобное объяснение числа 19 — это **пропущенные (skipped), а не упавшие** тесты, унаследованные от старого, гораздо меньшего состава набора: единственный класс тестов, который систематически «не зелёный» без секретов, — интеграционные `describe.skipIf(!ready)`. На нынешнем составе их 64. Проверить эмпирически в этой сессии нельзя: `node_modules` в рабочей копии отсутствует, установка зависимостей — изменение состояния, которого я избегал. **Рекомендация: в v2 не воспроизводить эту схему — либо поднимать тестовую базу в CI (тогда 0 пропусков), либо переводить эти 64 теста на мок Supabase (категория B), чтобы «зелёный» означал «зелёный».**

---

## 5. UI-стек

### 5.1. Tailwind и тема

- **Tailwind CSS 4.2.1** (`tailwindcss` + `@tailwindcss/vite` в `dependencies`). **Нет `tailwind.config.js`** — конфигурация CSS-first.
- `src/styles.css` (169 строк) — единственный CSS-файл проекта:
  - `@import "tailwindcss" source(none);` + `@source "../src";` + `@import "tw-animate-css";`
  - `@custom-variant dark (&:is(.dark *));`
  - `@theme inline { … }` — маппинг дизайн-токенов в утилиты: радиусы `--radius-sm…4xl` от `--radius`, цвета `--color-{background,foreground,card,popover,primary,secondary,muted,accent,destructive,border,input,ring,ring-offset-background,chart-1..5,sidebar,sidebar-*}`.
  - `:root` (светлая) и `.dark` (тёмная) — **все значения в `oklch`** (обязательное правило, записано в комментарии файла).
  - Отдельная палитра `--donut-1 … --donut-8` в **hex**, с обоснованием: `--chart-1..5` не проходит валидатор дальтонизма на соседних парах, а три средних тона держат контраст ниже 3:1 к белому — поэтому у сегментов donut всегда есть текстовая подпись, не только цвет.
  - `@layer base` — `* { border-color: var(--color-border) }`, `body { background/color }`.
- **Переключателя тем в интерфейсе нет.** Класс `.dark` никто не ставит: тёмная тема определена, но недостижима. Единственный `dark:`-зависимый код — токены.

### 5.2. `src/components-ui/` — 48 файлов

shadcn/ui, стиль **new-york**, base color **slate**, `cssVariables: true`, иконки **lucide** (`components.json`). Важно: `components.json` указывает алиас `"ui": "@/components/ui"`, а реальная папка — `src/components-ui/` — алиасы разошлись с раскладкой.

**Реально используемые (22 файла):**

| компонент | импортов | компонент | импортов |
|---|---|---|---|
| `button` | 40 | `card` | 6 |
| `input` | 28 | `switch` | 3 |
| `label` | 26 | `dialog` | 3 |
| `textarea` | 17 | `table` | 2 |
| `badge` | 14 | `dropdown-menu` | 2 |
| `select` | 11 | `chart` | 2 |
| `checkbox` | 10 | `storage-donut` | 2 |
| `tabs` | 7 | `emoji-insert-bar` | 2 |
| `tooltip`, `toggle`, `sonner`, `skeleton`, `sheet`, `separator` | по 1 | | |

**Неиспользуемые (26 файлов, мёртвый вес):** `accordion`, `alert`, `alert-dialog`, `aspect-ratio`, `avatar`, `breadcrumb`, `calendar`, `carousel`, `collapsible`, `command`, `context-menu`, `drawer`, `form`, `hover-card`, `input-otp`, `menubar`, `navigation-menu`, `pagination`, `popover`, `progress`, `radio-group`, `resizable`, `scroll-area`, `sidebar` (24 КБ!), `slider`, `toggle-group`. Вместе с ними тянутся ~28 пакетов `@radix-ui/*`, `cmdk`, `embla-carousel-react`, `input-otp`, `react-day-picker`, `react-resizable-panels`, `vaul`.

**Не-shadcn, собственные:**
- `storage-donut.tsx` (5.2 КБ) — `StorageDonut`, `DonutLegendRow`, `buildDonutSegments`. Recharts `PieChart/Pie/Cell` поверх `ChartContainer`. Комментарий фиксирует, почему палитра `--donut-*`, а не `--chart-*`, и почему подписи обязательны.
- `emoji-insert-bar.tsx` (1.4 КБ) — панель быстрых эмодзи (`📚 📖 📝 ✏️ 📐 🔢 🧮 🎓 👶 🧒 🗓️ 📅 🌸 🍂 ❄️ 🎄 ⭐ ✅ 💡 …`) для полей рассылки/описаний.
- `sonner.tsx` — обёртка `Toaster` с классами под тему.
- `chart.tsx` (10.5 КБ) — стандартная shadcn-обёртка над recharts.

### 5.3. Общие клиентские утилиты

- `src/lib/utils.ts` — `cn()` = `twMerge(clsx(...))`.
- `src/lib/error-message.ts` — `errorMessage(e: unknown)`: `Error.message` → `obj.message` → `obj.error` → `JSON.stringify` → `String(e)`. Отдельные ветки добавлены потому, что `createServerFn` иногда отклоняется не настоящим `Error`, и `String(e)` давал `[object Object]`.
- `src/lib/confirm-toast.ts` — `confirmToast(message, {confirmLabel, cancelLabel}): Promise<boolean>` через sonner (`duration: 20000`, `action`/`cancel`/`onDismiss`/`onAutoClose`). Замена `window.confirm()`. `ANALYSIS.md` (разделы «Отдельно: `alert()` и `confirm()` во всей админке» и §1123) фиксирует, что нативные диалоги были массовой проблемой; в панели оператора замена проведена, в клиентской админке — частично.
- `src/lib/error-page.ts`, `src/lib/error-capture.ts`.
- `src/hooks/` — единственный файл `use-mobile.tsx` (от shadcn sidebar, фактически не нужен).

### 5.4. Общий layout — чего нет

Общего layout-компонента на два интерфейса **нет**. Есть два независимых `<header>` + `<main>`, написанных руками:
- `AdminLayout` в `src/routes/admin.tsx` — `max-w-7xl`, `min-h-[3.5rem]`, `flex-wrap`, группы-дропдауны, селектор языка;
- `OperatorLayout` в `src/routes/operator._authed.tsx` — `max-w-6xl`, `h-14`, плоский ряд ссылок, без языка.

Общее между ними — только `bg-muted/30`, `border-b bg-card`, локальный `NavLink` (продублирован в трёх файлах: `admin.tsx`, `operator._authed.tsx`, `admin.vip.tsx`), и `Button variant="ghost" size="sm"` для выхода. `components-ui/sidebar.tsx` (24 КБ) не используется вовсе.

### 5.5. Остальной стек (из `package.json`)

React 19.2, `@tanstack/react-router` 1.168, `@tanstack/react-start` 1.167, `@tanstack/router-plugin`, `@tanstack/react-query` 5.83, `@supabase/supabase-js` 2.108, `zod` **3.24** (не 4), `recharts` 2.15, `sonner` 2.0, `lucide-react` 0.575, `react-hook-form` 7.71 + `@hookform/resolvers` (подключены, но `components-ui/form.tsx` не используется — формы написаны на `useState`), `date-fns` 4.1, `xlsx` 0.18, `unpdf` 1.8, `mammoth` 1.12 (Word для базы знаний консультанта), `nodemailer` 9, `@vercel/functions`, `class-variance-authority`, `clsx`, `tailwind-merge`.
Dev: Vite **8.0.16**, `nitro` 3.0.260603-beta, Vitest **4.1.10**, TypeScript 5.8, ESLint 9 + `typescript-eslint` 8 + `eslint-plugin-prettier`, Prettier 3.7, `patch-package` (есть папка `patches/`).

---

## 6. `scripts/` и скрипты `package.json`

### 6.1. `package.json` → `scripts`

| скрипт | команда | что делает / подводные камни |
|---|---|---|
| `postinstall` | `patch-package` | применяет патчи из `patches/` после установки |
| `dev` | `vite dev` | dev-сервер на порту 3000 (`vite.config.ts`) |
| `build` | `npm run typecheck && vite build` | **Ловушка, задокументированная в `CLAUDE.md`:** генератор маршрутов TanStack переписывает `src/routeTree.gen.ts` и заодно «чинит» путь в мёртвом `src/routes/admin.instagram.old.tsx` с `/admin/instagram` (дубль живой страницы) на `/admin/instagram/old`, превращая 4000-строчный мёртвый файл в настоящий маршрут админки. После сборки эти два файла коммитить нельзя. Лечится удалением мёртвого файла |
| `build:dev` | `vite build --mode development` | сборка без минификации |
| `preview` | `vite preview` | локальный просмотр сборки |
| `lint` | `eslint .` | **красный**: ~2100–2300 замечаний `prettier/prettier`; из-за него CI не доходит до typecheck/build/test, «результаты сборки в CI не видны» (`CLAUDE.md`) |
| `format` | `prettier --write .` | `.prettierrc` + `.prettierignore` в корне |
| `test` | `vitest run` | см. §4 |
| `test:watch` | `vitest` | |
| `typecheck` | `tsc --noEmit` | «должен быть зелёным всегда» |
| `knowledge` | `node scripts/collect-knowledge.mjs` | см. ниже |

### 6.2. `scripts/` — 9 файлов

| файл | язык | назначение |
|---|---|---|
| `apply-migration.mjs` (4.3 КБ) | Node | Применяет SQL-миграцию на боевой Supabase **через Management API** (`https://api.supabase.com/v1`), потому что DDL через Data API/service_role не выполняется. Env: `SUPABASE_ACCESS_TOKEN` (PAT `sbp_…`), `SUPABASE_PROJECT_REF` или вывод ref из `SUPABASE_URL`. Использование: `node scripts/apply-migration.mjs MIGRATION-56-web-cart-handoff.sql`, режим `--check <table>` |
| `collect-knowledge.mjs` (5.7 КБ) | Node | **Собирает `docs/v2/inherited-knowledge.md`** из двух источников: имён всех проверок в `*.test.ts` (каждое — требование, которое кто-то нарушил в проде) и коммитов вида `fix` (каждый — поломка, которую увидел покупатель или продавец). Отрезает трейлеры `Co-Authored-By:`, `Claude-Session:`, `🤖`. Явно назван «ТЗ для переписывания»: «архитектуру можно придумать заново, а вот что Zernio с `sortOrder asc` отдаёт самые старые сто сообщений — нельзя». Запуск: `npm run knowledge` |
| `dump-consultant-state.mjs` (7.1 КБ) | Node, `#!` | **Только чтение.** Срез состояния ИИ-консультанта из боевой базы, когда база недоступна из сессии агента. Ключи не печатает, значения статей/товаров целиком не печатает — только заголовки, размеры и итоги. Читает из `app_settings`: `consultant_knowledge_json`, `consultant_catalog_json`, `consultant_catalog_meta`, `consultant_vtb_buy_rate`, `consultant_tasks_json`, `consultant_store_address` и др. Флаг `--json` |
| `mint-tenant-key.mjs` (2.4 КБ) | Node, `#!` | **Выпускает ключ арендатора.** `SUPABASE_JWT_SECRET=… node scripts/mint-tenant-key.mjs <bot_id> [years=5]`. Токен несёт `role: tenant_bot` и `bot_id`; PostgREST переключается на эту роль, RLS из `MIGRATION-02` фильтрует всё по claim. Идёт в `SUPABASE_TENANT_KEY` **рядом**, а не вместо `SUPABASE_SERVICE_ROLE_KEY` (шлюз принимает в `apikey` только собственные ключи проекта, роль резолвится из `Authorization`). Удаление переменной откатывает деплой на неограниченный service_role — обратимость выкатки. Та же логика продублирована в `env-block.server.ts:mintTenantKey()` |
| `push-to-frogflow.sh` (612 Б, `+x`) | bash | `git push` в `https://github.com/FrogFlow/frogflow`. Токен из `FROGFLOW_GITHUB_TOKEN` или `GITHUB_TOKEN`, ветка по умолчанию — текущая. `set -euo pipefail` |
| `set-bot-description.mjs` (2.1 КБ) | Node, `#!` | Ставит тексты профиля Telegram-бота (оферта + политика в «Что умеет этот бот?» — требование Robokassa). Читает `.env.local` своим мини-парсером, `TELEGRAM_BOT_TOKEN`, база — `PUBLIC_APP_URL` (с захардкоженным фоллбэком `https://tg-bot-ashen-one.vercel.app`) |
| `set-webhook.mjs` (2.2 КБ) | Node, `#!` | Одноразовая установка вебхука магазинного бота на `PUBLIC_APP_URL`. Тот же мини-парсер `.env.local`. **Своего адреса по умолчанию намеренно нет**: молчаливая подстановка чужого URL увела бы вебхук на другой деплой — отсутствие переменной здесь ошибка |
| `sync-db-types.mjs` (6.4 КБ) | Node, `#!` | Досинхронизирует `src/integrations-supabase/types.ts` с живой базой: **добавляет только недостающие колонки**, не перегенерируя файл целиком, чтобы не потерять выверенные вручную блоки `Relationships`, на которых держатся типизированные embed-запросы. `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/sync-db-types.mjs`. Следствие: часть таблиц (`admin_login_attempts`, `manager_chat_state`, …) вписана в `types.ts` **вручную**, потому что их миграции готовы, но ещё не применены к живой базе |
| `vtb-relay.php` (3.5 КБ) | PHP | Ставится на `bovi.kz` (WordPress, Алматы). ВТБ Казахстан отвечает только на запросы с казахстанских адресов, а деплой консультанта стоит за границей. Файл проксирует ответ ВТБ (`https://online-api.vtb.kz/api/exchange-rate/by-currencyMob/`), таймаут 8 сек, кеш последнего удачного ответа 900 сек. Адрес прописывается в `CONSULTANT_VTB_RELAY_URL` |

### 6.3. Прочая инфраструктура репозитория

- **71 файл `MIGRATION-NN-*.sql`** в корне (00…70) + `MIGRATION-README.md` (23 КБ) + семь `PATCH-*.sql` + `COMPLETE-SETUP.sql`, `setup-database.sql`, `setup-rls-policies.sql`, `setup-storage.sql`, `reset-orders-sequence.sql`, `add-payment-methods.sql`, `add-delivered-language-tracking.sql`. Миграции применяются вручную/через `apply-migration.mjs`, автоматического раннера нет.
- Документация в корне: `ANALYSIS.md` (111 КБ, семь «обследований»), `CONTROL-PLANE-PLAN.md` (44 КБ), `DEPLOYMENT.md` (41 КБ), `CONSOLIDATION-PLAN.md`, `MERGE-MAP.md`, `MINI-APP.md`, `WEBHOOK.md`, `README.md`, `CLAUDE.md`; `docs/v2/README.md` + `docs/v2/inherited-knowledge.md`, `docs/bovi-consultant-spec.md`.
- Мусор в корне: `bot.server.ts.old` (657 КБ), `diff.txt` (126 КБ), `patch.py`, папка `fixtures/`.
- `vercel.json`, `.github/` (workflow), `eslint.config.js`, `tsconfig.json`.

### 6.4. Замеры из `docs/v2/README.md` (полезны как отправная точка переписывания)

| | |
|---|---|
| строк кода | 107 520 в 370 файлах |
| из них в 15 самых больших файлах | 41 964 (39 %) |
| `bot.server.ts` (Telegram) | 6 927 |
| `zernio-bot.server.ts` (Instagram/WhatsApp) | 4 893 |
| **общих функций между этими двумя** | **0** |
| чтений `process.env.BOT_ID` | 51 в 34 файлах (13 — в тестах) |
| проверок (тестов) | 1 074 в 105 файлах |
| правок по факту поломки у клиента | 51 |
| ошибок `npm run lint` | 2 307, из них чинятся `--fix` 2 244 |

В проде на момент решения о переписывании: 8 активных магазинов, 11 105 пользователей ботов, 879 заказов за 30 дней, 708 товаров, 507 VIP-подписок.

Шесть правил переписывания оттуда же (их стоит держать в спецификации v2): база не трогается (та же схема и RLS); v1 и v2 работают одновременно; переезд по одному клиенту, начиная с самого маленького; знание (`inherited-knowledge.md`) переносится первым, код вторым; v1 остаётся рабочим всё время; готовность меряется зелёными `lint`/`typecheck`/`test` **без исключений**.

---

## 7. Сводка дефектов, которые спецификация v2 должна закрыть

1. **Гейт модулей на сервере существует, но применён к одному модулю из 25 доступных** — `requireAdminWithModule` вызывается только для `manager_chat`. Остальные платные разделы защищены только `beforeLoad` в клиентском роутере, который обходится прямым POST на `/_serverFn`.
2. **Три серверные функции панели оператора без `requireOperator()`**: `leadsAiConfiguredFn`, `pipelineStatusFn`, `listLeadEventsFn` (`src/lib/operator/leads.functions.ts`).
3. **`consultant/story-tags.functions.ts` — 6 серверных функций без `requireAdmin()`**.
4. **Локализация вкопана в маршруты**: общий словарь `i18n.ts` покрывает навигацию и кнопки, а всё содержательное лежит в локальных `copy: Record<Locale, {…}>` внутри `admin.settings.tsx` (~110 ключей ×4), `admin.orders.tsx` (~80 ×4), `admin.index.tsx` и т.д. Плюс полный дубль словаря в `login.tsx`.
5. **Язык не переживает SSR**: первый рендер всегда `ru`, `<html lang="en">`, чтение `localStorage` в `useEffect`.
6. **Тёмная тема определена в токенах, но недостижима** — класс `.dark` никто не ставит.
7. **26 из 48 компонентов `components-ui` не используются**, тянут ~28 зависимостей Radix и соседей.
8. **Ни одного теста на UI и ни одного на аутентификацию обеих панелей.**
9. **64 интеграционных теста скипаются без секретов базы** — «зелёный прогон» не означает зелёный.
10. **`CLAUDE.md` ссылается на несуществующий раздел `ANALYSIS.md`** про 19 падающих тестов.
11. **Мёртвый маршрут воскресает при каждой сборке** (`admin.instagram.old.tsx` → `/admin/instagram/old`, 218 КБ).
12. **`npm run lint` красный (~2300 замечаний)** и блокирует CI до typecheck/build/test.
13. **Storage не покрыт RLS**: изоляция арендаторов держится на ручном префиксе `${BOT_ID}/` и на `isOwnTenantStorageKey()` в отдельных местах.
14. **Арендатор — переменная окружения деплоя**, поэтому один клиент = один проект Vercel; `tenant-router.server.ts` (резолв по запросу) написан наполовину, с `as any` на таблице `bot_accounts`, которой нет в типах.
15. **React-компоненты живут в `src/lib/`** (`operator/ai-usage-section.tsx`, `operator/receipt-audit-section.tsx`), а `components.json` указывает на несуществующий алиас `@/components/ui`.
16. **Файлы-гиганты**: `bot.server.ts` 321 КБ, `zernio-bot.server.ts` 254 КБ, `admin.instagram.tsx` 4664 строки, `admin.orders.tsx` 1905, `operator._authed.$botId.tsx` 1792, `admin.consultant.tsx` 1702, `admin.settings.tsx` 1502, `operator._authed.index.tsx` 1440.
