import { createHmac } from "node:crypto";
import { expect, test, type APIRequestContext, type TestInfo } from "@playwright/test";
import * as F from "./fixtures.ts";

/**
 * VIP-подписка целиком на собранном приложении (DID 02, Развивашка): новый
 * покупатель берёт «первый вход», присылает чек, продавец подтверждает —
 * покупатель получает одноразовую ссылку и входит в группу; продление
 * стыкуется к оплаченному сроку без новой ссылки; по истечении крон
 * исключает из группы. База и Telegram — подставные (pg-stub.ts, seed/vip.ts).
 */

type Sent = { method: string; token: string; body: Record<string, unknown> };
type Button = { text: string; callback_data?: string };
type Sub = {
  id: string;
  telegram_id: number;
  tariff_id: string;
  status: string;
  expires_at: string;
  group_invite_link: string | null;
  payment_proof_path: string | null;
};

/** Покупатель у каждого проекта (desktop/phone) свой: оба идут в одну базу. */
function buyerOf(info: TestInfo): number {
  return 620_000_000 + info.parallelIndex * 1000 + info.project.name.length * 100;
}

let updateId = Math.floor(Math.random() * 1e9) * 1000;

async function vipUpdate(request: APIRequestContext, update: Record<string, unknown>) {
  const secret = createHmac("sha256", F.WEBHOOK_SECRET)
    .update(`telegram:${F.VIP_SHOP_ID}:vip`)
    .digest("hex");
  const res = await request.post(`/api/telegram/${F.VIP_SHOP_ID}/vip`, {
    headers: { "x-telegram-bot-api-secret-token": secret },
    data: { update_id: ++updateId, ...update },
  });
  expect(res.status()).toBe(200);
}

const chat = (id: number) => ({ id, type: "private", first_name: "Покупатель" });
const from = (id: number) => ({ id, is_bot: false, first_name: "Покупатель", language_code: "ru" });

const say = (request: APIRequestContext, who: number, message: Record<string, unknown>) =>
  vipUpdate(request, {
    message: {
      message_id: ++updateId,
      date: Math.floor(Date.now() / 1000),
      chat: chat(who),
      from: from(who),
      ...message,
    },
  });

const press = (request: APIRequestContext, who: number, data: string) =>
  vipUpdate(request, {
    callback_query: {
      id: `cb${++updateId}`,
      from: from(who),
      chat_instance: "e2e",
      data,
      message: { message_id: 1, date: Math.floor(Date.now() / 1000), chat: chat(who) },
    },
  });

/** Что VIP-бот отправил в чат `chatId` (только токеном VIP-бота). */
async function sent(request: APIRequestContext, chatId: number): Promise<Sent[]> {
  const all = (await (await request.get(`${F.STUB}/__e2e/telegram`)).json()) as Sent[];
  return all.filter((s) => s.token === F.VIP_TOKEN && Number(s.body.chat_id) === chatId);
}

function buttons(s: Sent): Button[] {
  const raw = s.body.reply_markup;
  const markup = (typeof raw === "string" ? JSON.parse(raw) : raw) as
    { inline_keyboard?: Button[][] } | undefined;
  return markup?.inline_keyboard?.flat() ?? [];
}

const text = (s: Sent) => String(s.body.text ?? s.body.caption ?? "");

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

async function subsOf(request: APIRequestContext, buyer: number): Promise<Sub[]> {
  const all = (await (
    await request.get(`${F.STUB}/__e2e/tables/vip_subscriptions`)
  ).json()) as Sub[];
  return all.filter((s) => Number(s.telegram_id) === buyer);
}

/** Заявка с чеком: выбрать тариф, прислать фото, продавец нажимает «Подтвердить». */
async function payAndConfirm(
  request: APIRequestContext,
  buyer: number,
  tariffId: string,
  price: number,
): Promise<Sub> {
  let n = (await sent(request, buyer)).length;
  await press(request, buyer, `buy_tariff:${tariffId}`);
  const pay = await waitSent(request, buyer, n, (s) => text(s).includes("Kaspi Gold"));
  expect(text(pay)).toContain(`${price} KZT`);

  n = (await sent(request, buyer)).length;
  await say(request, buyer, {
    photo: [
      {
        file_id: `vip-proof-${buyer}-${tariffId}`,
        file_unique_id: `v${buyer}`,
        width: 1,
        height: 1,
      },
    ],
  });
  await waitSent(request, buyer, n, (s) => /чек/i.test(text(s)));

  const pending = (await subsOf(request, buyer)).find((s) => s.status === "pending_payment")!;
  expect(pending.tariff_id).toBe(tariffId);
  // Чек у продавца с кнопками именно этой заявки.
  await waitSent(request, F.VIP_SELLER_TG, 0, (s) =>
    buttons(s).some((b) => b.callback_data === `vip_confirm:${pending.id}`),
  );
  await expect
    .poll(
      async () =>
        (await subsOf(request, buyer)).find((s) => s.id === pending.id)?.payment_proof_path,
    )
    .toBeTruthy();

  await press(request, F.VIP_SELLER_TG, `vip_confirm:${pending.id}`);
  await expect
    .poll(async () => (await subsOf(request, buyer)).find((s) => s.id === pending.id)?.status)
    .toBe("active");
  return (await subsOf(request, buyer)).find((s) => s.id === pending.id)!;
}

test("VIP: первый вход по чеку → ссылка в группу → продление без ссылки → исключение по сроку", async ({
  request,
}, info) => {
  const buyer = buyerOf(info);
  const DAY = 86_400_000;

  // Новый покупатель видит «первый вход», а не общий список тарифов.
  await say(request, buyer, { text: "/start" });
  const offer = await waitSent(request, buyer, 0, (s) =>
    buttons(s).some((b) => b.callback_data === `buy_tariff:${F.VIP_ENTRY_ID}`),
  );
  expect(text(offer)).toContain("Первый вход");

  // Оплата «первого входа»: подписка на 30 дней, одноразовая ссылка в группу.
  let n = (await sent(request, buyer)).length;
  const first = await payAndConfirm(request, buyer, F.VIP_ENTRY_ID, F.VIP_ENTRY_PRICE);
  const firstUntil = new Date(first.expires_at).getTime();
  expect(Math.abs(firstUntil - (Date.now() + 30 * DAY))).toBeLessThan(DAY);
  expect(first.group_invite_link).toMatch(/^https:\/\/t\.me\/\+e2e/);
  const welcome = await waitSent(request, buyer, n, (s) =>
    text(s).includes("Добро пожаловать в VIP"),
  );
  expect(text(welcome)).toContain(first.group_invite_link!);
  await waitSent(request, F.VIP_SELLER_TG, 0, (s) => text(s).includes("Подписка подтверждена"));

  // Покупатель вошёл в группу по ссылке.
  await request.post(`${F.STUB}/__e2e/telegram/join`, {
    data: { chat_id: F.VIP_GROUP, user_id: buyer },
  });

  // Статус: подписка активна.
  n = (await sent(request, buyer)).length;
  await say(request, buyer, { text: "/status" });
  await waitSent(request, buyer, n, (s) => text(s).includes("Первый вход"));

  // Продление: «первый вход» больше не предлагается, только тариф продления.
  n = (await sent(request, buyer)).length;
  await say(request, buyer, { text: "🔄 Продлить" });
  const renewList = await waitSent(request, buyer, n, (s) => buttons(s).length > 0);
  const offered = buttons(renewList).map((b) => b.callback_data);
  expect(offered).toContain(`buy_tariff:${F.VIP_RENEW_ID}`);
  expect(offered).not.toContain(`buy_tariff:${F.VIP_ENTRY_ID}`);

  n = (await sent(request, buyer)).length;
  const second = await payAndConfirm(request, buyer, F.VIP_RENEW_ID, F.VIP_RENEW_PRICE);
  // Срок стыкуется к оплаченному, а не считается от «сейчас»; в группе — без ссылки.
  expect(Math.abs(new Date(second.expires_at).getTime() - (firstUntil + 30 * DAY))).toBeLessThan(
    60_000,
  );
  expect(second.group_invite_link).toBeNull();
  const renewed = await waitSent(request, buyer, n, (s) => text(s).includes("Доступ продлён"));
  expect(text(renewed)).toContain("новая ссылка не нужна");
  const subs = await subsOf(request, buyer);
  expect(subs.find((s) => s.id === first.id)?.status).toBe("expired");
  expect(subs.filter((s) => s.status === "active")).toHaveLength(1);

  // Срок вышел: крон исключает из группы и пишет покупателю.
  await request.patch(`${F.STUB}/__e2e/tables/vip_subscriptions/${second.id}`, {
    data: { expires_at: new Date(Date.now() - 60_000).toISOString() },
  });
  n = (await sent(request, buyer)).length;
  const cron = await request.get("/api/cron/vip", {
    headers: { authorization: "Bearer e2e-cron-secret-0000" },
  });
  expect(cron.status()).toBe(200);
  await waitSent(request, buyer, n, (s) => text(s).includes("подписка истекла"));
  const all = (await (await request.get(`${F.STUB}/__e2e/telegram`)).json()) as Sent[];
  expect(
    all.some(
      (s) =>
        s.method === "banChatMember" &&
        s.token === F.VIP_TOKEN &&
        String(s.body.chat_id) === F.VIP_GROUP &&
        Number(s.body.user_id) === buyer,
    ),
  ).toBe(true);
  expect((await subsOf(request, buyer)).find((s) => s.id === second.id)?.status).toBe("expired");

  // После окончания — только продление, «первый вход» снова не положен.
  n = (await sent(request, buyer)).length;
  await say(request, buyer, { text: "/start" });
  const again = await waitSent(request, buyer, n, (s) => buttons(s).length > 0);
  expect(buttons(again).map((b) => b.callback_data)).not.toContain(`buy_tariff:${F.VIP_ENTRY_ID}`);
});
