import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Замок от возврата: `.limit(N)` с N > 1 тихо теряет строки, когда их больше
 * (см. «Без молчаливых обрезок» в CLAUDE.md). Где нужны все строки — `pageAll`/
 * `eachPage` из core/db/page или `count`. Здесь — осознанные места: файл → по
 * одной причине на каждое место, в порядке появления в файле. Число мест
 * проверяется, поэтому устаревшая запись тоже краснеет.
 */
export function countLimits(source: string): number {
  return [...source.matchAll(/\.limit\((?!1\))/g)].length;
}

const SHOWN = "последние N на экране: список не обязан быть полным";
const BATCH = "пачка за запуск: остальное в следующий; обработанные из выборки уходят";

const ALLOWED: Record<string, string[]> = {
  "src/app/admin/automsg-preview.server.ts": [
    "образец для предпросмотра: первые три товара каталога, а не весь список",
  ],
  "src/app/operator/zernio-inbox.server.ts": [
    "последние события клиента для оператора: ограничены параметром limit, это обзор",
    "последние события без клиента для оператора: ограничены параметром limit, это обзор",
  ],
  "src/app/admin/audit.server.ts": [`${SHOWN} (журнал действий команды)`],
  "src/app/admin/chat.functions.ts": [`${SHOWN} (подбор товара в счёт: поиск, INVOICE_PAGE)`],
  "src/core/postpay/decide.server.ts": [
    "контекст для модели ИИ после оплаты: последние HISTORY реплик, старые не нужны",
  ],
  "src/app/observer/observer.server.ts": [
    "контекст диалога для модели: последние HISTORY_PER_DIALOG реплик, старые не нужны",
  ],
  "src/app/operator/ai-topup.server.ts": [`${SHOWN} (открытые счета пополнения ИИ — их единицы)`],
  "src/app/operator/plans.server.ts": [`${SHOWN} (открытые счета клиента)`],
  "src/app/operator/subscription-sweep.server.ts": [
    "проверка существования: нужен лишь факт, что открытый счёт есть",
  ],
  "src/app/operator/client-events.server.ts": [
    `${SHOWN} (события клиента)`,
    `${SHOWN} (события платформы)`,
  ],
  "src/app/operator/owner-broadcasts.server.ts": [`${SHOWN} (рассылки оператора)`],
  "src/app/operator/owner-messages.server.ts": [
    `${SHOWN} (журнал сообщений владельцу: последние 30)`,
  ],
  "src/channels/zernio/dispatch.server.ts": [
    `${BATCH} (зависшие «повтор» → заново)`,
    `${BATCH} (необработанные вебхуки)`,
  ],
  "src/channels/zernio/automations.server.ts": [`${SHOWN} (отправки по правилам)`],
  "src/channels/zernio/posts.server.ts": [`${SHOWN} (последние публикации)`],
  "src/core/catalog/picker.ts": [`${SHOWN} (подбор товара: поиск, limit + число исключённых)`],
  "src/core/catalog/catalog.ts": [
    `${SHOWN} (результаты поиска по названию, limit от вызывающего)`,
    `${SHOWN} (результаты поиска по вариантам, по куску id; limit от вызывающего)`,
  ],
  "src/core/upsell/upsell.ts": ["подборка: берём самые популярные, остальные не нужны"],
  "src/core/ai/balance.ts": [`${SHOWN} (журнал ИИ-баланса)`],
  "src/core/similar/similar.ts": [`${BATCH} (курсор по id: следующий запуск продолжает)`],
  "src/core/consultant/engine.server.ts": [
    "потолок каталога в подсказке модели: больше не помещается в запрос",
  ],
  "src/core/retention/retention.ts": Array<string>(14).fill(
    "уборка пачками BATCH по порядку времени: остальное в следующий запуск",
  ),
  "src/core/orders/admin.ts": [
    `${SHOWN} (заказы в админке, есть фильтр и поиск)`,
    `${SHOWN} (покупатели в админке, есть поиск)`,
  ],
  "src/core/orders/balance.ts": ["счёт попыток: достаточно RK_ATTEMPTS, дальше всё равно отказ"],
  "src/core/orders/order-queries.ts": [`${SHOWN} (последние заказы покупателя)`],
  "src/core/pipeline/board.ts": [
    `${SHOWN} (открытые заказы на доске)`,
    `${SHOWN} (закрытые за окно на доске)`,
  ],
  "src/core/reviews/reviews.ts": [`${SHOWN} (последние отзывы к товару)`],
  "src/core/customers/panel.ts": [
    `${SHOWN} (последние 5 заказов в панели диалога; сумма — по всем)`,
  ],
  "src/core/customers/card.ts": [
    `${SHOWN} (последние обращения в карточке)`,
    `${SHOWN} (последние сообщения в карточке)`,
  ],
  "src/core/search/smart.server.ts": [
    "потолок кандидатов для модели: больше не помещается в запрос",
  ],
  "src/core/chat/search.ts": [
    "постраничный поиск: страница по курсору (created_at, id), «Показать ещё»",
  ],
  "src/core/chat/chat.ts": [
    "постраничный обход списка диалогов: страница по курсору (last_message_at, telegram_id)",
    "постраничный обход переписки: страница по курсору (created_at, id), «Показать раньше»",
  ],
  "src/core/waitlist/waitlist.ts": ["постраничный обход: страница PAGE, курсор по user_key"],
  "src/core/billing/invoices.ts": [`${SHOWN} (открытые счета владельца)`],
  "src/core/storefront/share.server.ts": [
    "обложка: хватает первых COVER_SCAN товаров порядка продавца",
  ],
  "src/core/storefront/sitemap.ts": [
    "потолок карты сайта: SITEMAP_MAX_PRODUCTS (протокол — до 50 000 адресов)",
  ],
  "src/core/push/admin-push.ts": ["подписок не больше MAX_DEVICES (20), лимит 100 — с запасом"],
  "src/core/outbox/outbox.ts": [
    `${BATCH} (очередь исходящих)`,
    `${SHOWN} (страница «Не доставлено»)`,
  ],
  "src/core/broadcasts/broadcast-batch.ts": [
    "активных рассылок на канале единицы: ACTIVE_SCAN с запасом",
    `${BATCH} (получатели рассылки, BATCH_SIZE)`,
  ],
  "src/core/broadcasts/broadcast-create.ts": [
    "активных рассылок на канале единицы: ACTIVE_SCAN с запасом",
  ],
  "src/core/broadcasts/broadcast-list.ts": [
    "активных рассылок на канале единицы: ACTIVE_SCAN с запасом",
  ],
  "src/routes/api/v1.$.ts": [
    "заказы по курсору `before` и `limit` из запроса: клиент API листает сам",
    "покупатели по курсору `after` (уникальный user_key) и `limit` из запроса: клиент API листает сам",
  ],
};

describe("молчаливые обрезки .limit(N) (Б28)", () => {
  const files = execSync("git ls-files 'src/*.ts' 'src/*.tsx'", { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter((f) => f && !/\.test\.tsx?$/.test(f));

  it("в src/ каждое `.limit(N)`, N > 1, записано с причиной", () => {
    const wrong: string[] = [];
    for (const f of files) {
      const n = countLimits(readFileSync(f, "utf8"));
      const expected = ALLOWED[f]?.length ?? 0;
      if (n !== expected) wrong.push(`${f}: найдено ${n}, в белом списке ${expected}`);
    }
    expect(
      wrong,
      "нужны все строки — pageAll/eachPage/count; осознанная обрезка — запись в ALLOWED с причиной",
    ).toEqual([]);
  });

  it("в белом списке нет несуществующих файлов", () => {
    expect(Object.keys(ALLOWED).filter((f) => !files.includes(f))).toEqual([]);
  });

  it("находит limit и не считает limit(1)", () => {
    expect(countLimits("q.limit(50).limit(1).limit(RECENT).limit(10)")).toBe(3);
  });
});
