import { createHash, createHmac } from "node:crypto";
import { expect, test, type APIRequestContext, type TestInfo } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * Денежный путь целиком на собранном приложении: покупатель оформляет заказ
 * в Telegram-боте и платит (чеком или через Robokassa), продавец подтверждает
 * в админке, файлы уходят покупателю; оператор выставляет магазину счёт за
 * подписку и отмечает его оплаченным. База и Telegram — подставные
 * (pg-stub.ts, seed.ts): тест читает, что приложение записало и отправило.
 */

type Sent = { method: string; token: string; body: Record<string, unknown> };
type Button = { text: string; callback_data?: string; url?: string };

/** Покупатель у каждого проекта (desktop/phone) свой: оба идут в одну базу. */
function buyerOf(info: TestInfo, n: number): number {
  return 610_000_000 + info.parallelIndex * 1000 + info.project.name.length * 100 + n;
}

// Свой диапазон у каждого процесса: повтор update_id бот честно пропускает.
let updateId = Math.floor(Math.random() * 1e9) * 1000;

async function tg(request: APIRequestContext, update: Record<string, unknown>) {
  const secret = createHmac("sha256", F.WEBHOOK_SECRET)
    .update(`telegram:${F.SHOP_ID}`)
    .digest("hex");
  const res = await request.post(`/api/telegram/${F.SHOP_ID}`, {
    headers: { "x-telegram-bot-api-secret-token": secret },
    data: { update_id: ++updateId, ...update },
  });
  expect(res.status()).toBe(200);
}

const chat = (id: number) => ({ id, type: "private", first_name: "Покупатель" });
const from = (id: number) => ({ id, is_bot: false, first_name: "Покупатель", language_code: "ru" });

const say = (request: APIRequestContext, buyer: number, message: Record<string, unknown>) =>
  tg(request, {
    message: {
      message_id: ++updateId,
      date: Math.floor(Date.now() / 1000),
      chat: chat(buyer),
      from: from(buyer),
      ...message,
    },
  });

const press = (request: APIRequestContext, buyer: number, data: string) =>
  tg(request, {
    callback_query: {
      id: `cb${++updateId}`,
      from: from(buyer),
      chat_instance: "e2e",
      data,
      message: { message_id: 1, date: Math.floor(Date.now() / 1000), chat: chat(buyer) },
    },
  });

async function sent(request: APIRequestContext, chatId: number): Promise<Sent[]> {
  const all = (await (await request.get(`${F.STUB}/__e2e/telegram`)).json()) as Sent[];
  return all.filter((s) => Number(s.body.chat_id) === chatId);
}

function buttons(s: Sent): Button[] {
  const raw = s.body.reply_markup;
  const markup = (typeof raw === "string" ? JSON.parse(raw) : raw) as
    { inline_keyboard?: Button[][] } | undefined;
  return markup?.inline_keyboard?.flat() ?? [];
}

/** Ждём сообщение боту `chatId`, после `after` уже отправленных, подходящее под условие. */
async function waitSent(
  request: APIRequestContext,
  chatId: number,
  after: number,
  match: (s: Sent) => boolean,
): Promise<Sent> {
  let hit: Sent | undefined;
  await expect
    .poll(
      async () => {
        hit = (await sent(request, chatId)).slice(after).find(match);
        return Boolean(hit);
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return hit!;
}

const text = (s: Sent) => String(s.body.text ?? s.body.caption ?? "");
const hasButton = (prefix: string) => (s: Sent) =>
  buttons(s).some((b) => b.callback_data?.startsWith(prefix) || b.url?.startsWith(prefix));

async function table<T = Record<string, unknown>>(request: APIRequestContext, name: string) {
  return (await (await request.get(`${F.STUB}/__e2e/tables/${name}`)).json()) as T[];
}

type Order = { id: number; status: string; total: number; display_no: number; telegram_id: number };

async function orderOf(request: APIRequestContext, id: number): Promise<Order> {
  return (await table<Order>(request, "orders")).find((o) => o.id === id)!;
}

/**
 * Покупатель от /start до оформленного заказа: каталог, «В корзину»,
 * страна оплаты, телефон. Robokassa у магазина настроена, поэтому бот
 * предлагает выбрать способ оплаты. Возвращает номер заказа в базе.
 */
async function placeOrder(request: APIRequestContext, buyer: number): Promise<number> {
  await say(request, buyer, { text: "/start" });
  let n = (await sent(request, buyer)).length;
  await say(request, buyer, { text: "📚 Каталог" });
  await waitSent(request, buyer, n, hasButton(`add:${F.PRODUCT_ID}`));

  n = (await sent(request, buyer)).length;
  await press(request, buyer, `add:${F.PRODUCT_ID}`);
  await waitSent(request, buyer, n, hasButton("cart:show"));

  n = (await sent(request, buyer)).length;
  await press(request, buyer, "checkout");
  await waitSent(request, buyer, n, hasButton("setcountry:KZ"));
  await press(request, buyer, "setcountry:KZ");

  n = (await sent(request, buyer)).length;
  await press(request, buyer, "checkout");
  await waitSent(request, buyer, n, (s) =>
    JSON.stringify(s.body.reply_markup ?? "").includes("request_contact"),
  );

  n = (await sent(request, buyer)).length;
  await say(request, buyer, {
    contact: { phone_number: "+77001234567", user_id: buyer, first_name: "Покупатель" },
  });
  const choose = await waitSent(request, buyer, n, hasButton("pay:manual:"));
  expect(text(choose)).toContain("оформлен");
  const id = Number(
    buttons(choose)
      .find((b) => b.callback_data?.startsWith("pay:manual:"))!
      .callback_data!.split(":")[2],
  );

  const order = await orderOf(request, id);
  expect(order).toMatchObject({
    status: "awaiting_payment",
    total: F.PRODUCT_PRICE,
    telegram_id: buyer,
  });
  return id;
}

/** Файл товара ушёл покупателю: документ по подписанной ссылке на наш PDF. */
async function expectDelivered(request: APIRequestContext, buyer: number, id: number) {
  await waitSent(
    request,
    buyer,
    0,
    (s) => s.method === "sendDocument" && String(s.body.document).includes("propisi.pdf"),
  );
  await expect
    .poll(async () => (await orderOf(request, id)).status, { timeout: 15_000 })
    .toBe("delivered");
}

test("покупатель платит чеком, продавец подтверждает в админке — файл у покупателя", async ({
  page,
  request,
}, info) => {
  const buyer = buyerOf(info, 1);
  const id = await placeOrder(request, buyer);
  const no = (await orderOf(request, id)).display_no;

  let n = (await sent(request, buyer)).length;
  await press(request, buyer, `pay:manual:${id}`);
  const howTo = await waitSent(request, buyer, n, (s) => text(s).includes("Kaspi Gold"));
  expect(text(howTo)).toContain("1");

  // Фото чека: бот скачивает его через getFile, кладёт в Storage и ждёт продавца.
  n = (await sent(request, buyer)).length;
  const sellerBefore = (await sent(request, F.SELLER_TG)).length;
  await say(request, buyer, {
    photo: [{ file_id: `proof-${buyer}`, file_unique_id: `u${buyer}`, width: 1, height: 1 }],
  });
  await waitSent(request, buyer, n, (s) => text(s).includes(`Чек по заказу #${no} получен`));
  await waitSent(request, F.SELLER_TG, sellerBefore, hasButton(`confirm:${id}`));
  await expect.poll(async () => (await orderOf(request, id)).status).toBe("awaiting_confirmation");

  // Продавец подтверждает в веб-админке.
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto(`/admin/orders/${id}`);
  await page.getByRole("button", { name: "✅ Подтвердить и выдать" }).click();
  await expect(page.getByText(`Заказ #${no} выдан: 1 поз.`)).toBeVisible();

  await expectDelivered(request, buyer, id);
  expect(errors).toEqual([]);
});

test("покупатель платит через Robokassa — заказ оплачен и выдан сам", async ({ request }, info) => {
  const buyer = buyerOf(info, 2);
  const id = await placeOrder(request, buyer);

  const n = (await sent(request, buyer)).length;
  await press(request, buyer, `pay:rk:${id}`);
  const link = await waitSent(request, buyer, n, hasButton("https://auth.robokassa.kz/"));
  const url = new URL(buttons(link).find((b) => b.url)!.url!);
  expect(url.searchParams.get("InvId")).toBe(String(id));
  const outSum = url.searchParams.get("OutSum")!;
  expect(Number(outSum)).toBe(F.PRODUCT_PRICE);

  // Подделанная подпись не проходит и заказ не трогает.
  const bad = await request.post(`/api/robokassa/${F.SHOP_ID}/result`, {
    form: { OutSum: outSum, InvId: String(id), SignatureValue: "0".repeat(32), Shp_bot: F.SHOP_ID },
  });
  expect(bad.status()).toBe(400);
  expect((await orderOf(request, id)).status).toBe("awaiting_payment");

  // Ответ Robokassa: MD5(OutSum:InvId:Пароль2:Shp_bot=…).
  const sign = createHash("md5")
    .update(`${outSum}:${id}:${F.ROBOKASSA.pass2}:Shp_bot=${F.SHOP_ID}`)
    .digest("hex");
  const ok = await request.post(`/api/robokassa/${F.SHOP_ID}/result`, {
    form: { OutSum: outSum, InvId: String(id), SignatureValue: sign, Shp_bot: F.SHOP_ID },
  });
  expect(ok.status()).toBe(200);
  expect(await ok.text()).toBe(`OK${id}`);

  await expectDelivered(request, buyer, id);
});

test("оператор выставляет счёт за подписку и отмечает оплату — срок подписки продлён", async ({
  page,
  request,
}, info) => {
  const errors = await watch(page);
  const note = `E2E подписка ${info.project.name} ${Date.now()}`;
  await page.goto("/operator/login");
  await page.locator('input[name="username"]').fill(F.OPERATOR_LOGIN);
  await page.locator('input[name="password"]').fill(F.OPERATOR_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/operator$/);

  const ownerBefore = (await sent(request, F.SELLER_TG)).length;
  await page.goto(`/operator/clients/${F.SHOP_ID}`);
  const form = page.locator("form", { hasText: "Выставить счёт владельцу" });
  await form.locator('input[name="amount"]').fill("9900");
  await form.locator('input[name="note"]').fill(note);
  await form.getByRole("button", { name: "Выставить", exact: true }).click();
  await expect(page.getByText("Счёт выставлен и отправлен владельцу")).toBeVisible();
  // Владелец получил счёт в своём боте.
  await waitSent(
    request,
    F.SELLER_TG,
    ownerBefore,
    (s) => text(s).includes("9900") || text(s).includes("9 900"),
  );

  // «Оплачен» спрашивает начало и конец периода — берём предложенные.
  page.on("dialog", (d) => void d.accept(d.defaultValue()));
  const row = page.locator("tr", { hasText: note });
  await row.getByRole("button", { name: "Оплачен" }).click();
  await expect(page.getByText(/Счёт оплачен, подписка до/)).toBeVisible();
  await expect(row).toContainText("оплачен");

  const invoice = (await table(request, "subscription_invoices")).find((i) => i.note === note)!;
  expect(invoice.status).toBe("paid");
  const bot = (await table(request, "bots")).find((b) => b.id === F.SHOP_ID)!;
  expect(String(bot.subscription_expires_at) > new Date().toISOString().slice(0, 10)).toBe(true);
  expect(errors).toEqual([]);
});
