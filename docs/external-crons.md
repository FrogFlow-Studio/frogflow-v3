# Частые кроны на cron-job.org

Запасной вариант на случай тарифа Vercel Hobby: он запускает кроны не чаще раза в сутки, и
деплой с частыми кронами в `vercel.json` не проходит. Тогда в `vercel.json` оставить только
суточные задачи (`retention`, `subscriptions`, `leads`), остальные дёргать с бесплатного
[cron-job.org](https://cron-job.org) по таблице ниже, и поправить тест
`platform-health.test.ts` (он сверяет `vercel.json` с `CRON_JOBS` в
`src/app/operator/cron-status.server.ts`). Так было сделано в #141 и откачено после
перехода на Pro.

## Настройка задачи

cron-job.org → Create cronjob, для каждой строки таблицы:

- **URL:** `https://www.frogflow.tech/api/cron/<задача>`
- **Schedule:** Custom → выражение из таблицы, часовой пояс **UTC**
- **Advanced → Request method:** GET
- **Advanced → Headers:** `Authorization` = `Bearer <CRON_SECRET>` (то же значение, что в Vercel)
- **Advanced → Timeout:** максимальный (30 с); задача продолжает работу и после обрыва
  ожидания со стороны cron-job.org, итог виден на странице оператора «Кроны»
- **Notifications:** при сбое — на почту

| Задача               | Расписание (UTC)      |
| -------------------- | --------------------- |
| broadcast            | `* * * * *`           |
| inbox-poll           | `* * * * *`           |
| giveaways            | `*/5 * * * *`         |
| vip                  | `*/10 * * * *`        |
| course-lives         | `*/10 * * * *`        |
| health               | `*/15 * * * *`        |
| comment-dm-fallback  | `7,22,37,52 * * * *`  |
| observer             | `11,26,41,56 * * * *` |
| cart-reminder        | `*/30 * * * *`        |
| ensure-webhook       | `0 * * * *`           |
| fulfillment-reminder | `0 * * * *`           |

Проверка: страница оператора «Кроны» — у каждой задачи свежий «последний запуск» без
ошибки. Ответ 401 в журнале cron-job.org — неверный заголовок `Authorization`.
