import { createHmac } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * Покупка в WhatsApp на собранном приложении: событие приходит подписанным
 * вебхуком Zernio, шаги — списками WhatsApp (выбор языка, каталог, страна),
 * кнопки карточки и корзины — кнопками. Покупатель сначала присылает архив
 * вместо чека — бот просит фото или PDF, заказ ждёт оплаты; потом фото чека
 * почти на 5 МБ (предел фото WhatsApp) — чек принят. Продавец подтверждает в
 * админке, материалы уходят в WhatsApp. Zernio и база — подставные
 * (pg-stub.ts).
 */

type ZSent = { method: string; path: string; body: Record<string, unknown> };

let seq = Math.floor(Math.random() * 1e9) * 1000;

async function wa(
  request: APIRequestContext,
  buyer: string,
  message: Record<string, unknown>,
  root: Record<string, unknown> = {},
) {
  const payload = {
    id: `evt-${++seq}`,
    event: "message.received",
    message: {
      id: `wamid-${seq}`,
      conversationId: `conv-${buyer}`,
      platform: "whatsapp",
      direction: "incoming",
      sender: { id: buyer, name: "Покупатель", phoneNumber: `+${buyer}` },
      sentAt: new Date().toISOString(),
      ...message,
    },
    conversation: { id: `conv-${buyer}`, participantId: buyer },
    account: { id: F.WA_ACCOUNT, profileId: F.IG_PROFILE, platform: "whatsapp" },
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
  wa(request, buyer, { text });
/** Выбор строки списка или нажатие кнопки: id — в metadata корня события. */
const tap = (request: APIRequestContext, buyer: string, id: string) =>
  wa(
    request,
    buyer,
    { text: null },
    {
      metadata: {
        interactiveType:
          id.startsWith("STEP:") || id.startsWith("PROD:") ? "list_reply" : "button_reply",
        interactiveId: id,
      },
    },
  );
/** Вложение покупателя: приложение скачивает его у Zernio. */
const attach = (request: APIRequestContext, buyer: string, type: string, url: string) =>
  wa(request, buyer, { text: null, attachments: [{ type, url }] });

async function out(request: APIRequestContext, buyer: string): Promise<ZSent[]> {
  const all = (await (await request.get(`${F.STUB}/__e2e/zernio`)).json()) as ZSent[];
  return all.filter(
    (s) => s.method === "POST" && s.path.endsWith(`/inbox/conversations/conv-${buyer}/messages`),
  );
}

const text = (s: ZSent) => String(s.body.message ?? "");
/** Все id кнопок и строк списка в сообщении. */
function choices(s: ZSent): string[] {
  const buttons = ((s.body.buttons ?? []) as Array<{ payload?: string }>).map((b) => b.payload);
  const sections =
    (s.body.interactive as { action?: { sections?: Array<{ rows: Array<{ id: string }> }> } })
      ?.action?.sections ?? [];
  return [...buttons, ...sections.flatMap((x) => x.rows.map((r) => r.id))].filter(
    (x): x is string => Boolean(x),
  );
}
const offers = (id: string) => (s: ZSent) => choices(s).includes(id);

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

type Order = {
  id: number;
  status: string;
  total: number;
  display_no: number;
  platform: string;
  user_key: string;
  payment_proof_path: string | null;
};

async function orders(request: APIRequestContext) {
  return (await (await request.get(`${F.STUB}/__e2e/tables/orders`)).json()) as Order[];
}
const orderOf = async (request: APIRequestContext, id: number) =>
  (await orders(request)).find((o) => o.id === id)!;

test("покупка в WhatsApp: списки, архив вместо чека отклонён, фото почти 5 МБ принято, материалы в WhatsApp", async ({
  page,
  request,
}, info) => {
  test.slow();
  const buyer = `77${info.parallelIndex}${info.project.name.length}${String(Date.now()).slice(-8)}`;

  // Слово-вызов — каталог списком (строка товара PROD:<id>); язык сам не
  // спрашивается, единственная страна оплаты ставится сама.
  await step(request, buyer, () => say(request, buyer, "каталог"), offers(`PROD:${F.PRODUCT_ID}`));

  // Карточка с фото (в пределах 5 МБ WhatsApp) и кнопкой «В корзину».
  const card = await step(
    request,
    buyer,
    () => tap(request, buyer, `PROD:${F.PRODUCT_ID}`),
    offers(`BUY:${F.PRODUCT_ID}`),
  );
  expect(text(card)).toContain(F.PRODUCT_NAME);
  expect(String(card.body.attachmentUrl)).toContain(`/api/img/${F.SHOP_ID}/`);

  await step(request, buyer, () => tap(request, buyer, `BUY:${F.PRODUCT_ID}`), offers("CHECKOUT"));
  // Страна уже известна — оформление сразу к оплате.
  const placed = await step(
    request,
    buyer,
    () => tap(request, buyer, "CHECKOUT"),
    offers("PAY:manual"),
  );
  expect(text(placed)).toContain(`К оплате: ${F.PRODUCT_PRICE} ₸`);

  const mine = (await orders(request)).filter((o) => o.user_key === `wa_${buyer}`);
  expect(mine).toHaveLength(1);
  const id = mine[0]!.id;
  const no = mine[0]!.display_no;
  expect(mine[0]).toMatchObject({ platform: "whatsapp", status: "awaiting_payment" });

  await step(
    request,
    buyer,
    () => tap(request, buyer, "PAY:manual"),
    (s) => text(s).includes("Kaspi Gold"),
  );

  // Архив вместо чека: не принят, заказ по-прежнему ждёт оплаты.
  await step(
    request,
    buyer,
    () => attach(request, buyer, "file", `${F.STUB}/zernio/media/receipt-${buyer}.zip`),
    (s) => text(s).includes("Чек нужен фотографией или PDF"),
  );
  expect(await orderOf(request, id)).toMatchObject({
    status: "awaiting_payment",
    payment_proof_path: null,
  });

  // Фото чека почти 5 МБ — принято и лежит в хранилище приложения.
  const size = 5 * 1024 * 1024 - 64 * 1024;
  await step(
    request,
    buyer,
    () =>
      attach(request, buyer, "image", `${F.STUB}/zernio/media/receipt-${buyer}.jpg?bytes=${size}`),
    (s) => text(s).includes(`Чек по заказу #${no} получен`),
  );
  await expect.poll(async () => (await orderOf(request, id)).status).toBe("awaiting_confirmation");
  const proof = (await orderOf(request, id)).payment_proof_path;
  expect(proof).toMatch(new RegExp(`^${F.SHOP_ID}/order-${id}/.+\\.jpg$`));

  // Продавец подтверждает в админке — материалы уходят в WhatsApp.
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto(`/admin/orders/${id}`);
  await page.getByRole("button", { name: "✅ Подтвердить и выдать" }).click();
  await expect(page.getByText(`Заказ #${no} выдан: 1 поз.`)).toBeVisible();

  // Файл из хранилища уходит в WhatsApp документом с именем (#177), не ссылкой в тексте.
  const delivered = await waitOut(
    request,
    buyer,
    0,
    (s) => s.body.attachmentType === "file" && String(s.body.attachmentUrl).includes("propisi.pdf"),
  );
  expect(delivered.body.accountId).toBe(F.WA_ACCOUNT);
  expect(String(delivered.body.attachmentName)).toMatch(/\.pdf$/);
  await waitOut(request, buyer, 0, (s) => text(s).includes("Файлы — выше"));
  await expect
    .poll(async () => (await orderOf(request, id)).status, { timeout: 15_000 })
    .toBe("delivered");
  expect(errors).toEqual([]);
});
