# Публичный API магазина (`/api/v1`)

Модуль `public_api`. Ключ один на магазин: `Authorization: Bearer ffk_<id магазина>_<секрет>`
(или заголовок `x-api-key`). Создаёт владелец в «Настройках»; виден один раз. Магазин
прежней платформы (`served_by` ≠ `v2`) и выключенный модуль — 404, неверный ключ — 401,
больше 120 запросов в минуту — 429. Ответы — JSON, `cache-control: no-store`.

**Права ключа.** При выпуске владелец выбирает: «чтение и правка товаров» (`write`) или
«только чтение» (`read`). Ключ `read` отвечает 403 `read_only_key` на `PATCH`; его безопасно
отдать аналитике или отчётам. Ключи, выпущенные до появления прав, остаются `write`.
В базе лежит только отпечаток секрета (SHA-256): ключ виден один раз, при создании.

## Примеры

```bash
# последние 10 заказов
curl -H "Authorization: Bearer $FF_KEY" "https://<адрес платформы>/api/v1/orders?limit=10"

# следующая страница: before_id = next_before_id из прошлого ответа
curl -H "Authorization: Bearer $FF_KEY" "https://<адрес платформы>/api/v1/orders?limit=10&before_id=123"

# поставить остаток и скрыть товар (нужен ключ write)
curl -X PATCH -H "Authorization: Bearer $FF_KEY" -H "content-type: application/json" \
  -d '{"stock": 0, "active": false}' "https://<адрес платформы>/api/v1/products/<id товара>"
```

```js
// Node.js 18+: изменившиеся покупатели
const res = await fetch(`${base}/api/v1/customers?updated_since=2026-10-01T00:00:00Z`, {
  headers: { authorization: `Bearer ${process.env.FF_KEY}` },
  signal: AbortSignal.timeout(10_000),
});
if (!res.ok) throw new Error(`FrogFlow API: ${res.status}`);
const { customers, next_after } = await res.json();
```

| Запрос                                                          | Что                                      |
| --------------------------------------------------------------- | ---------------------------------------- |
| `GET /orders?status=&updated_since=&limit=&before_id=`          | заказы, новые сверху, до 100 на страницу |
| `GET /orders/<id>`                                              | один заказ                               |
| `GET /products`                                                 | товары                                   |
| `PATCH /products/<id>` `{"stock":5,"price":1000,"active":true}` | остаток, цена, активность                |
| `GET /customers?updated_since=&limit=&after=`                   | покупатели, только чтение                |

## Покупатели

```
curl -H "Authorization: Bearer ffk_…" "https://<домен>/api/v1/customers?updated_since=2026-10-01T00:00:00Z&limit=100"
```

Ответ:

```json
{
  "customers": [
    {
      "id": "tg:12345",
      "name": "Айгуль Н.",
      "username": "aigul",
      "phone": "+77001234567",
      "email": null,
      "points": 300,
      "channel": "telegram",
      "created_at": "2026-09-01T09:00:00Z",
      "updated_at": "2026-09-10T12:30:00Z"
    }
  ],
  "next_after": "tg:12345"
}
```

- `limit` — от 1 до 100 (по умолчанию 50). Выше или не число — `400 bad_query`.
- `updated_since` — дата ISO 8601; вернутся покупатели, изменённые не раньше неё
  (`updated_at` меняется при любой активности покупателя, не только при смене имени
  или баллов). Пусто — все.
- Порядок — по `id` покупателя (он уникален в магазине), **не** по дате: страницы не
  теряют и не повторяют строки, даже если покупатели меняются между запросами. Листайте,
  передавая `after=<next_after>`, пока `next_after` не станет `null`.
- Только чтение: баллы, телефон и почта отдаются как есть, изменить их через API нельзя.
  Состояние бота, токены и служебные поля не отдаются.
- Почта покупателя сайта не подтверждена продавцом, пока он сам её не проверил —
  не используйте её как доказательство личности.

## Последнее использование ключа

В «Настройках» рядом с ключом видно, когда им пользовались в последний раз и откуда
(адрес из `x-forwarded-for`, начало `User-Agent`). Отметка пишется только после
верного ключа, не чаще раза в минуту; новый ключ и отзыв её обнуляют. Это подсказка для
узнавания чужого использования, а не журнал каждого запроса.

## Вебхуки

События заказов приходят вебхуком (модуль `crm_integration`): журнал доставки и кнопка
«Проверить вебхук» — в той же странице настроек. Тело — JSON с `event` (`order.<вид>`),
`event_id`, `at`, `shop_id`, `order` и `details`; подпись — `X-FrogFlow-Signature:
sha256=<hex>` (HMAC-SHA256 тела секретом), вид события дублируется заголовком
`X-FrogFlow-Event`.

| Событие                 | Когда                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `order.placed`          | заказ создан                                                                                           |
| `order.proof`           | пришёл чек                                                                                             |
| `order.delivered`       | заказ выдан                                                                                            |
| `order.delivery_failed` | сбой выдачи                                                                                            |
| `order.rejected`        | заказ отклонён                                                                                         |
| `order.status`          | смена статуса                                                                                          |
| `order.payment`         | оплата получена                                                                                        |
| `order.refund`          | возврат                                                                                                |
| `order.courier`         | передан курьеру                                                                                        |
| `ping`                  | проверочное событие кнопки «Проверить вебхук»: только `event`, `event_id`, `at`, `shop_id`, без заказа |

Ответ 2xx (и 302 у Google Apps Script) — принято. Таймаут (10 секунд), обрыв после
соединения и ответ 5xx **сами не повторяются**: событие могло дойти. Повтор — вручную
кнопкой в журнале доставки, с тем же `event_id`: храните обработанные `event_id`, чтобы
отбросить дубль. Не ушедшее до соединения и ответ 4xx повторяются автоматически с
растущей паузой, пять раз.

### Как проверить подпись

Считайте HMAC-SHA256 от **сырого тела** запроса (до разбора JSON) секретом из настроек
вебхука и сравните с `X-FrogFlow-Signature` за постоянное время. Обработанные `event_id`
храните: по правилам выше событие могло прийти дважды.

```js
// Node.js (Express: express.raw({ type: "application/json" }))
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(rawBody, header, secret) {
  const want = Buffer.from("sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex"));
  const got = Buffer.from(header ?? "");
  return want.length === got.length && timingSafeEqual(want, got);
}
```

```python
# Python (Flask): raw = request.get_data()
import hmac, hashlib

def verify(raw: bytes, header: str, secret: str) -> bool:
    want = "sha256=" + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(want, header or "")
```

Пример тела события:

```json
{
  "event": "order.payment",
  "event_id": "5f0c2c7e-8b7a-4a52-9c3e-1d2f3a4b5c6d",
  "at": "2026-10-04T10:15:00.000Z",
  "shop_id": "b41a34cb-7944-441b-8f71-503184fc0f1f",
  "order": {
    "id": 42,
    "number": 42,
    "status": "paid",
    "total": 12000,
    "currency": "KZT",
    "channel": "telegram",
    "customer": "Анна",
    "items": [{ "name": "Прописи", "qty": 1, "price": 12000 }]
  },
  "details": { "amount": 12000 }
}
```
