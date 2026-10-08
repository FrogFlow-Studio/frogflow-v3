# FrogFlow v3

v3 — продолжение v2: код и история перенесены из `FrogFlow/frogflow-v2`
(master 53b1f6a, 03.10.2026). v2 заморожен (решение Якова 03.10): он работает
в проде, туда идут только срочные правки. Все новые работы — здесь. Срочную
правку v2 вливаем сюда обычным merge. Список работ — раздел «v3» в
`docs/ROADMAP.md`.

Платформа магазинов в Telegram, Instagram и WhatsApp. Один репозиторий — один
деплой: все клиенты обслуживаются одним приложением, арендатор определяется
из запроса. База данных общая с v1, схема не меняется.

- `docs/ARCHITECTURE.md` — как устроено и почему.
- `docs/ROADMAP.md` — что перенесено, что дальше, по фазам.
- `docs/MIGRATION.md` — как перевести клиента с v1 и откатить.
- `docs/BACKUP.md` — восстановление базы из бэкапа и проверка копии.
- `docs/inherited-knowledge.md` — опись проверок и поломок v1: ТЗ на перенос.
- `docs/db-schema.md`, `docs/v1-runtime-inventory.md`,
  `docs/v1-admin-inventory.md` — описи v1, от которых считаем.

## Запуск

```bash
npm install --legacy-peer-deps
cp .env.example .env            # заполнить
npm run dev                     # http://localhost:3000
npm run check                   # lint + typecheck + test — перед каждым пушем
```

## Устройство

```
src/config/env.ts      единственное место чтения process.env
src/core/              домен: канала не знает, арендатора получает параметром
src/channels/          адаптеры каналов: telegram/, zernio/ (фаза 4)
src/routes/api/        вебхуки, кроны, API оператора
scripts/onboard.mjs    подключить клиента к v3 одной командой
```

Ядро принимает `TenantContext` первым аргументом. Подключение к базе в нём —
под ролью арендатора (JWT подписывается на запрос), поэтому чужие строки
невидимы на уровне Postgres, а не по договорённости.
