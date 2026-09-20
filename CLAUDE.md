# Работа с этим репозиторием

FrogFlow v2 — переписывание платформы из `FrogFlow/frogflow` (v1). Один
деплой на всех клиентов. Прежде чем что-то делать, прочитать
`docs/ARCHITECTURE.md` и `docs/ROADMAP.md`.

## Правила

1. **Схема базы не меняется.** v1 и v2 работают на одной базе одновременно,
   клиенты переезжают по одному. Всё новое про клиента — в `bots.settings`
   (jsonb), типизировано в `src/core/tenant/types.ts`.
2. **`process.env` читается только в `src/config/env.ts`.** ESLint это
   проверяет. Окружение описывает платформу; всё про клиента приходит через
   `TenantContext`.
3. **Ядро не знает канала.** `src/core/*` принимает `ctx: TenantContext`
   первым аргументом и не импортирует `src/channels/*`. Адаптер разбирает
   входящее и рисует ответ, бизнес-правила — в ядре, один раз.
4. **Домен ходит в базу через `ctx.db`** (роль арендатора). `serviceDb()` —
   только справочник арендаторов, кроны по всем клиентам, оператор, Storage.
5. **Перенос — по описи.** Перед переносом функции найти её проверки и
   поломки в `docs/inherited-knowledge.md`; сначала тесты, потом код.
6. **Перед пушем — `npm run check`** (lint, typecheck, test) зелёный без
   исключений. `npm run build` перегенерирует `src/routeTree.gen.ts` — его
   коммитим вместе с маршрутами.

## Веб-часть

`src/app/*` — код панелей: `auth/` (сессия, пароли, гварды), `ui/`
(компоненты без зависимостей), `operator/` и `admin/` (серверные функции в
`*.functions.ts`, реализация в `*.server.ts`). Каждая серверная функция
начинается с `requireOperator()` или `requireAdmin()`: маршрутный гейт —
только UX. Страницы в `src/routes/{operator,admin}._authed.*.tsx`.

Ловушка dev-сервера: запросы `<img>` (Sec-Fetch-Dest: image) Nitro в dev
считает статикой Vite и не отдаёт приложению, поэтому картинки из
`/api/img/*` в `npm run dev` показывают 404. В продакшен-сборке всё работает;
проверять так: `NITRO_PRESET=node-server npx vite build && node .output/server/index.mjs`.

## Тесты на живой базе

`tests/integration/*` ходят в настоящую Supabase под ключами из `.env`
(файл в `.gitignore`, шаблон — `.env.example`) и пропускают себя без них.
Пишут они только на демо-клиента «Демо-тестер» и убирают за собой.

## Проверки

```bash
npm run check       # lint + typecheck + test
npm run build       # typecheck + vite build (Nitro, Vercel preset)
```
