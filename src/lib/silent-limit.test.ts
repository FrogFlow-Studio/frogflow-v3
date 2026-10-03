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

const NEXT = "следующая партия: папка трека А/В, правится там";
const SHOWN = "последние N на экране: список не обязан быть полным";
const BATCH = "пачка за запуск: остальное в следующий; обработанные из выборки уходят";

const ALLOWED: Record<string, string[]> = {
  "src/app/admin/audit.server.ts": [`${SHOWN} (журнал действий команды)`],
  "src/app/admin/admin.functions.ts": [
    `${NEXT} (разделы товаров в настройках, 500)`,
    `${NEXT} (подбор товара в счёт, INVOICE_PAGE)`,
  ],
  "src/app/operator/ai-topup.server.ts": [`${SHOWN} (открытые счета пополнения ИИ — их единицы)`],
  "src/app/operator/plans.server.ts": [`${SHOWN} (открытые счета клиента)`],
  "src/app/operator/billing.server.ts": [
    `${SHOWN} (платежи клиента)`,
    `${SHOWN} (счета оператора)`,
    "проверка существования: нужен лишь факт, что открытый счёт есть",
  ],
  "src/app/operator/operator.server.ts": [
    "последнее событие по каналам: свежие 300 записей хватает для «когда было последнее»",
    `${SHOWN} (события клиента)`,
    `${SHOWN} (события платформы)`,
    `${SHOWN} (очередь заявок на модули — их единицы)`,
    `${SHOWN} (рассылки оператора)`,
  ],
  "src/channels/zernio/dispatch.server.ts": [
    `${BATCH} (зависшие «повтор» → заново)`,
    `${BATCH} (необработанные вебхуки)`,
  ],
  "src/channels/zernio/message-failed.server.ts": [
    `${SHOWN} (последние доставленные заказы покупателя)`,
  ],
  "src/channels/zernio/automations.server.ts": [`${SHOWN} (отправки по правилам)`],
  "src/channels/zernio/posts.server.ts": [`${SHOWN} (последние публикации)`],
  "src/core/catalog/picker.ts": [NEXT],
  "src/core/catalog/catalog.ts": [NEXT, NEXT],
  "src/core/catalog/subscription.ts": [NEXT, NEXT, NEXT],
  "src/core/upsell/upsell.ts": ["подборка: берём самые популярные, остальные не нужны"],
  "src/core/ai/balance.ts": [`${SHOWN} (журнал ИИ-баланса)`],
  "src/core/similar/similar.ts": [`${BATCH} (курсор по id: следующий запуск продолжает)`],
  "src/core/notify/digest.ts": [`${BATCH} (очередь дайджеста)`],
  "src/core/consultant/engine.server.ts": [
    "потолок каталога в подсказке модели: больше не помещается в запрос",
  ],
  "src/core/retention/retention.ts": Array<string>(11).fill(
    "уборка пачками BATCH по порядку времени: остальное в следующий запуск",
  ),
  "src/core/orders/admin.ts": [
    `${SHOWN} (заказы в админке, есть фильтр и поиск)`,
    `${SHOWN} (покупатели в админке, есть поиск)`,
  ],
  "src/core/orders/balance.ts": ["счёт попыток: достаточно RK_ATTEMPTS, дальше всё равно отказ"],
  "src/core/orders/orders.ts": [`${SHOWN} (последние заказы покупателя)`],
  "src/core/orders/events.ts": [`${SHOWN} (история одного заказа — десятки записей)`],
  "src/core/vip/vip.ts": [`${SHOWN} (подписки в админке, есть фильтр)`],
  "src/core/pipeline/board.ts": [
    `${SHOWN} (открытые заказы на доске)`,
    `${SHOWN} (закрытые за окно на доске)`,
  ],
  "src/core/reviews/admin.ts": [`${SHOWN} (отзывы в админке)`],
  "src/core/reviews/reviews.ts": [`${SHOWN} (последние отзывы к товару)`],
  "src/core/customers/card.ts": [
    `${SHOWN} (последние обращения в карточке)`,
    `${SHOWN} (последние сообщения в карточке)`,
  ],
  "src/core/search/smart.server.ts": [
    "потолок кандидатов для модели: больше не помещается в запрос",
  ],
  "src/core/chat/chat.ts": [`${NEXT} (чат с менеджером)`, `${NEXT} (чат с менеджером)`],
  "src/core/waitlist/waitlist.ts": ["постраничный обход: страница PAGE, курсор по user_key"],
  "src/core/billing/invoice-check.server.ts": [
    "проверка существования: нужен лишь факт, что подтверждение есть",
  ],
  "src/core/billing/invoices.ts": [`${SHOWN} (открытые счета владельца)`],
  "src/core/storefront/catalog.ts": [NEXT],
  "src/core/storefront/web-expire.ts": [NEXT],
  "src/core/storefront/share.server.ts": [NEXT],
  "src/core/storefront/sitemap.ts": [NEXT],
  "src/core/push/admin-push.ts": ["подписок не больше MAX_DEVICES (20), лимит 100 — с запасом"],
  "src/core/outbox/outbox.ts": [
    `${BATCH} (очередь исходящих)`,
    `${SHOWN} (страница «Не доставлено»)`,
  ],
  "src/core/helpdesk/tickets.ts": [`${SHOWN} (обращения в админке, есть фильтр)`],
  "src/core/broadcasts/broadcasts.ts": [
    "активных рассылок на канале единицы: ACTIVE_SCAN с запасом",
    "активных рассылок на канале единицы: ACTIVE_SCAN с запасом",
    `${BATCH} (получатели рассылки, BATCH_SIZE)`,
    `${SHOWN} (список рассылок)`,
    "активных рассылок на канале единицы: ACTIVE_SCAN с запасом",
  ],
  "src/routes/api/v1.$.ts": [
    "заказы по курсору `before` и `limit` из запроса: клиент API листает сам",
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
