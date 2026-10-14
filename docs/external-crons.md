# Частые кроны на cron-job.org

Vercel Hobby запускает кроны не чаще раза в сутки, поэтому в `vercel.json` остались только
суточные задачи (`retention`, `subscriptions`, `leads`). Остальные дёргает бесплатный
[cron-job.org](https://cron-job.org). Расписание — то же, что в `CRON_JOBS`
(`src/app/operator/cron-status.server.ts`); тест `platform-health.test.ts` следит, чтобы
суточные задачи в `vercel.json` совпадали с ним.

## Настройка задачи

cron-job.org → Create cronjob, для каждой строки таблицы:

- **URL:** `https://www.frogflow.tech/api/cron/<задача>`
- **Schedule:** Custom → выражение из таблицы, часовой пояс **UTC**
- **Advanced → Request method:** GET
- **Advanced → Headers:** `Authorization` = `Bearer <CRON_SECRET>` (то же значение, что в Vercel)
- **Advanced → Timeout:** максимальный (30 с); задача продолжает работу и после обрыва
  ожидания со стороны cron-job.org, итог виден на странице оператора «Кроны»
- **Notifications:** при сбое — на почту

| Задача | Расписание (UTC) |
|---|---|
| broadcast | `* * * * *` |
| inbox-poll | `* * * * *` |
| giveaways | `*/5 * * * *` |
| vip | `*/10 * * * *` |
| course-lives | `*/10 * * * *` |
| health | `*/15 * * * *` |
| comment-dm-fallback | `7,22,37,52 * * * *` |
| observer | `11,26,41,56 * * * *` |
| cart-reminder | `*/30 * * * *` |
| ensure-webhook | `0 * * * *` |
| fulfillment-reminder | `0 * * * *` |

Проверка: страница оператора «Кроны» — у каждой задачи свежий «последний запуск» без
ошибки. Ответ 401 в журнале cron-job.org — неверный заголовок `Authorization`.

На Pro-тарифе Vercel все задачи можно вернуть в `vercel.json` (раздел `crons`) и удалить
задачи в cron-job.org — тогда поправить и тест `platform-health.test.ts`.
