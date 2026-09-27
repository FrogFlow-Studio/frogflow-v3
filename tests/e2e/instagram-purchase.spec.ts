import { createHmac } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * Главный путь Education Bot целиком на собранном приложении: покупатель
 * пишет в Instagram Direct, событие приходит подписанным вебхуком Zernio,
 * бот ведёт каталог → корзину → заказ → оплату переводом, покупатель
 * присылает фото чека, продавец подтверждает в админке, материалы уходят
 * покупателю в Direct. API Zernio и база — подставные (pg-stub.ts), как
 * Telegram в money.spec.ts: тест читает, что приложение отправило и записало.
 */

type ZSent = { method: string; path: string; body: Record<string, unknown> };
type Button = { type: string; title: string; payload?: string; url?: string };

// Свой диапазон у каждого процесса: повтор id события приём честно пропускает.
let seq = Math.floor(Math.random() * 1e9) * 1000;

/** Входящее сообщение покупателя — событие Zernio с подписью вебхука. */
async function ig(
  request: APIRequestContext,
  buyer: string,
  message: Record<string, unknown>,
  root: Record<string, unknown> = {},
) {
  const payload = {
    id: `evt-${++seq}`,
    event: "message.received",
    message: {
      id: `mid-${seq}`,
      conversationId: `conv-${buyer}`,
      platform: "instagram",
      direction: "incoming",
      sender: { id: buyer, name: "Покупатель", username: `buyer_${buyer}` },
      sentAt: new Date().toISOString(),
      ...message,
    },
    conversation: { id: `conv-${buyer}`, participantId: buyer },
    account: { id: F.IG_ACCOUNT, profileId: F.IG_PROFILE, platform: "instagram" },
    timestamp: new Date().toISOString(),
    ...root,
  };
  const raw = JSON.stringify(payload);
  const sig = createHmac("sha256", F.ZERNIO_WEBHOOK_SECRET).update(raw).digest("hex");
  const res = await request.post("/api/zernio/webhook", {
    headers: { "content-type": "application/json", "x-zernio-signature": sig },
    data: raw,
  });
  expect(res.status()).toBe(200);
}

const say = (request: APIRequestContext, buyer: string, text: string) =>
  ig(request, buyer, { text });
/** Нажатие кнопки в Direct: у такого события текста нет, payload — в корне. */
const press = (request: APIRequestContext, buyer: string, payload: string) =>
  ig(request, buyer, { text: null }, { metadata: { postbackPayload: payload } });

/** Что приложение отправило покупателю через API Zernio. */
async function out(request: APIRequestContext, buyer: string): Promise<ZSent[]> {
  const all = (await (await request.get(`${F.STUB}/__e2e/zernio`)).json()) as ZSent[];
  return all.filter(
    (s) => s.method === "POST" && s.path.endsWith(`/inbox/conversations/conv-${buyer}/messages`),
  );
}

const text = (s: ZSent) => String(s.body.message ?? "");
const buttons = (s: ZSent) => (s.body.buttons ?? []) as Button[];
const hasPayload = (p: string) => (s: ZSent) => buttons(s).some((b) => b.payload === p);

/** Ждём ответ покупателю после `after` уже отправленных, подходящий под условие. */
async function waitOut(
  request: APIRequestContext,
  buyer: string,
  after: number,
  match: (s: ZSent) => boolean,
): Promise<ZSent> {
  let hit: ZSent | undefined;
  await expect
    .poll(
      async () => {
        hit = (await out(request, buyer)).slice(after).find(match);
        return Boolean(hit);
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return hit!;
}

/** Сказать и дождаться ответа, подходящего под условие. */
async function step(
  request: APIRequestContext,
  buyer: string,
  send: () => Promise<void>,
  match: (s: ZSent) => boolean,
): Promise<ZSent> {
  const n = (await out(request, buyer)).length;
  await send();
  return waitOut(request, buyer, n, match);
}

async function table<T = Record<string, unknown>>(request: APIRequestContext, name: string) {
  return (await (await request.get(`${F.STUB}/__e2e/tables/${name}`)).json()) as T[];
}

type Order = {
  id: number;
  status: string;
  total: number;
  display_no: number;
  platform: string;
  payment_proof_path: string | null;
};

async function orderOf(request: APIRequestContext, id: number): Promise<Order> {
  return (await table<Order>(request, "orders")).find((o) => o.id === id)!;
}

async function sellerTelegram(request: APIRequestContext) {
  const all = (await (await request.get(`${F.STUB}/__e2e/telegram`)).json()) as Array<{
    method: string;
    body: Record<string, unknown>;
  }>;
  return all.filter((s) => Number(s.body.chat_id) === F.SELLER_TG);
}

test("покупка в Instagram Direct: каталог, заказ, чек, подтверждение продавцом — материалы в Direct", async ({
  page,
  request,
}, info) => {
  // Длинный сценарий: десяток вебхуков и вход продавца — дольше обычных 30 с.
  test.slow();
  // Покупатель у каждого проекта (desktop/phone) свой: оба идут в одну базу.
  const buyer = `17${info.parallelIndex}${info.project.name.length}${Date.now()}`;

  // Первое сообщение нового покупателя — выбор языка, затем каталог.
  await step(
    request,
    buyer,
    () => say(request, buyer, "Здравствуйте"),
    (s) => text(s).includes("Выберите язык"),
  );
  const catalog = await step(
    request,
    buyer,
    () => say(request, buyer, "1"),
    (s) => text(s).includes(`1. ${F.PRODUCT_NAME}`),
  );
  expect(text(catalog)).toContain(`${F.PRODUCT_PRICE} ₸`);

  // Номер товара — карточка с фото и кнопкой «В корзину».
  const card = await step(
    request,
    buyer,
    () => say(request, buyer, "1"),
    hasPayload(`BUY:${F.PRODUCT_ID}`),
  );
  expect(text(card)).toContain(F.PRODUCT_NAME);
  expect(String(card.body.attachmentUrl)).toContain(`/api/img/${F.SHOP_ID}/`);

  await step(
    request,
    buyer,
    () => press(request, buyer, `BUY:${F.PRODUCT_ID}`),
    hasPayload("CHECKOUT"),
  );
  await step(
    request,
    buyer,
    () => press(request, buyer, "CHECKOUT"),
    (s) => text(s).includes("Выберите страну оплаты"),
  );
  const placed = await step(
    request,
    buyer,
    () => say(request, buyer, "1"),
    hasPayload("PAY:manual"),
  );
  expect(text(placed)).toContain(`К оплате: ${F.PRODUCT_PRICE} ₸`);

  const mine = (await table<Order & { user_key: string }>(request, "orders")).filter(
    (o) => o.user_key === `ig_${buyer}`,
  );
  expect(mine).toHaveLength(1);
  const id = mine[0]!.id;
  expect(mine[0]).toMatchObject({
    platform: "instagram",
    status: "awaiting_payment",
    total: F.PRODUCT_PRICE,
  });
  const no = mine[0]!.display_no;
  expect(text(placed)).toContain(`Заказ #${no} оформлен`);

  const howTo = await step(
    request,
    buyer,
    () => press(request, buyer, "PAY:manual"),
    (s) => text(s).includes("Kaspi Gold"),
  );
  expect(text(howTo)).toContain("пришлите сюда фото");

  // Фото чека: приложение скачивает вложение у Zernio, кладёт в Storage и ждёт продавца.
  const sellerBefore = (await sellerTelegram(request)).length;
  await step(
    request,
    buyer,
    () =>
      ig(request, buyer, {
        text: null,
        attachments: [{ type: "image", url: `${F.STUB}/zernio/media/receipt-${buyer}` }],
      }),
    (s) => text(s).includes(`Чек по заказу #${no} получен`),
  );
  await expect.poll(async () => (await orderOf(request, id)).status).toBe("awaiting_confirmation");
  // Чек лежит в Storage приложения, а не только ссылкой на CDN Instagram.
  const proof = (await orderOf(request, id)).payment_proof_path;
  expect(proof).toMatch(new RegExp(`^${F.SHOP_ID}/order-${id}/`));
  const stored = (await (await request.get(`${F.STUB}/__e2e/storage`)).json()) as string[];
  expect(stored).toContain(`payment-proofs/${proof}`);
  await expect
    .poll(async () =>
      (await sellerTelegram(request))
        .slice(sellerBefore)
        .some((s) => JSON.stringify(s.body.reply_markup ?? "").includes(`confirm:${id}`)),
    )
    .toBe(true);

  // Продавец подтверждает в веб-админке.
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto(`/admin/orders/${id}`);
  await page.getByRole("button", { name: "✅ Подтвердить и выдать" }).click();
  await expect(page.getByText(`Заказ #${no} выдан: 1 поз.`)).toBeVisible();

  // Материалы ушли покупателю в Direct: ссылка на файл товара.
  const delivered = await waitOut(request, buyer, 0, (s) => text(s).includes("propisi.pdf"));
  expect(delivered.body.accountId).toBe(F.IG_ACCOUNT);
  expect(text(delivered)).toContain("/storage/v1/object/sign/product-files/");
  await expect
    .poll(async () => (await orderOf(request, id)).status, { timeout: 15_000 })
    .toBe("delivered");
  expect(errors).toEqual([]);
});
