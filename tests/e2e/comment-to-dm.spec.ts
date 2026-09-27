import { createHmac } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import * as F from "./fixtures.ts";

/**
 * Comment-to-DM — главный источник заказов Education Bot (45 %). Покупатель
 * пишет ключевое слово под постом, Zernio по правилу отвечает первым
 * сообщением без кнопок с просьбой ответить «+» (Instagram прячет кнопки от
 * неподписчиков и не даёт писать первым). Покупатель отвечает «+» в Direct —
 * v2 отдаёт второе сообщение с кнопками, дальше обычная покупка в Direct.
 * API Zernio и база — подставные (pg-stub.ts).
 */

type ZSent = { method: string; path: string; body: Record<string, unknown> };
type Rule = { id: string; dmMessage: string; buttons?: unknown[] };

let seq = Math.floor(Math.random() * 1e9) * 1000;

async function webhook(request: APIRequestContext, payload: Record<string, unknown>) {
  const raw = JSON.stringify({
    id: `evt-${++seq}`,
    timestamp: new Date().toISOString(),
    ...payload,
  });
  const sig = createHmac("sha256", F.ZERNIO_WEBHOOK_SECRET).update(raw).digest("hex");
  const res = await request.post("/api/zernio/webhook", {
    headers: { "content-type": "application/json", "x-zernio-signature": sig },
    data: raw,
  });
  expect(res.status()).toBe(200);
}

const account = { id: F.IG_ACCOUNT, profileId: F.IG_PROFILE, platform: "instagram" };
const username = (buyer: string) => `buyer_${buyer}`;

/** Комментарий покупателя под постом. */
const comment = (request: APIRequestContext, buyer: string, text: string) =>
  webhook(request, {
    event: "comment.received",
    account,
    post: { id: "post-1", platformPostId: "ig-post-1" },
    comment: {
      id: `c-${buyer}-${++seq}`,
      text,
      postId: "post-1",
      platformPostId: "ig-post-1",
      author: { id: `ig-${buyer}`, username: username(buyer) },
    },
  });

/** Сообщение покупателя в Direct (текст или нажатие кнопки). */
const dm = (
  request: APIRequestContext,
  buyer: string,
  text: string | null,
  postbackPayload?: string,
) =>
  webhook(request, {
    event: "message.received",
    message: {
      id: `mid-${++seq}`,
      conversationId: `conv-${buyer}`,
      platform: "instagram",
      direction: "incoming",
      text,
      sender: { id: `ig-${buyer}`, name: "Покупатель", username: username(buyer) },
      sentAt: new Date().toISOString(),
    },
    conversation: { id: `conv-${buyer}`, participantId: `ig-${buyer}` },
    account,
    ...(postbackPayload ? { metadata: { postbackPayload } } : {}),
  });

async function zernio(request: APIRequestContext): Promise<ZSent[]> {
  return (await (await request.get(`${F.STUB}/__e2e/zernio`)).json()) as ZSent[];
}

async function out(request: APIRequestContext, buyer: string): Promise<ZSent[]> {
  return (await zernio(request)).filter(
    (s) => s.method === "POST" && s.path.endsWith(`/inbox/conversations/conv-${buyer}/messages`),
  );
}

const text = (s: ZSent) => String(s.body.message ?? "");
const payloads = (s: ZSent) =>
  ((s.body.buttons ?? []) as Array<{ payload?: string }>).map((b) => b.payload);

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

async function table<T = Record<string, unknown>>(request: APIRequestContext, name: string) {
  return (await (await request.get(`${F.STUB}/__e2e/tables/${name}`)).json()) as T[];
}

type Log = { event_id: string; event_type: string; status: string; payload: { username?: string } };

/** Второй шаг покупателя ждёт в очереди: Instagram не даёт написать первым. */
async function pendingFor(request: APIRequestContext, buyer: string) {
  return (await table<Log>(request, "zernio_logs")).filter(
    (l) => l.event_id.startsWith("two-step-dm:") && l.payload?.username === username(buyer),
  );
}

const buyerOf = (tag: string, info: { parallelIndex: number; project: { name: string } }) =>
  `${tag}${info.parallelIndex}${info.project.name.length}${Date.now()}`;

test("комментарий → «+» в Direct → второе сообщение с кнопками → заказ", async ({
  request,
}, info) => {
  const buyer = buyerOf("31", info);

  // Первый ответ шлёт сам Zernio по своему правилу: без кнопок, с просьбой ответить «+».
  const rules = (await (await request.get(`${F.STUB}/zernio/v1/comment-automations`)).json()) as {
    automations: Rule[];
  };
  const first = rules.automations.find((r) => r.id === F.RULE_V2)!;
  expect(first.buttons ?? []).toEqual([]);
  expect(first.dmMessage).toContain("Ответьте «+»");

  await comment(request, buyer, "Хочу прописи!");
  await expect
    .poll(async () => (await pendingFor(request, buyer)).map((l) => l.status), {
      timeout: 15_000,
    })
    .toEqual(["pending"]);
  // Писать первым v2 не пытался: диалога с покупателем ещё нет.
  expect(await out(request, buyer)).toHaveLength(0);

  // «+» в Direct — второе сообщение с кнопкой каталога, «+» дальше не разбирается.
  await dm(request, buyer, "+");
  const second = await waitOut(request, buyer, 0, (s) => text(s).includes("Вот каталог"));
  expect(payloads(second)).toEqual(["CATALOG"]);
  expect(second.body.accountId).toBe(F.IG_ACCOUNT);
  await expect
    .poll(async () => (await pendingFor(request, buyer)).map((l) => l.status))
    .toEqual(["processed"]);
  await new Promise((r) => setTimeout(r, 500));
  expect(await out(request, buyer)).toHaveLength(1);

  // Кнопка каталога → товар в корзину → оформление → заказ из Instagram.
  let n = (await out(request, buyer)).length;
  await dm(request, buyer, null, "CATALOG");
  await waitOut(request, buyer, n, (s) => text(s).includes(`1. ${F.PRODUCT_NAME}`));
  n = (await out(request, buyer)).length;
  await dm(request, buyer, null, `BUY:${F.PRODUCT_ID}`);
  await waitOut(request, buyer, n, (s) => payloads(s).includes("CHECKOUT"));
  n = (await out(request, buyer)).length;
  await dm(request, buyer, null, "CHECKOUT");
  await waitOut(request, buyer, n, (s) => text(s).includes("Выберите страну оплаты"));
  n = (await out(request, buyer)).length;
  await dm(request, buyer, "1");
  await waitOut(request, buyer, n, (s) => payloads(s).includes("PAY:manual"));

  const orders = (
    await table<{ user_key: string; platform: string; status: string; total: number }>(
      request,
      "orders",
    )
  ).filter((o) => o.user_key === `ig_ig-${buyer}`);
  expect(orders).toEqual([
    expect.objectContaining({
      platform: "instagram",
      status: "awaiting_payment",
      total: F.PRODUCT_PRICE,
    }),
  ]);
});

test("два быстрых «+» — второе сообщение уходит один раз", async ({ request }, info) => {
  const buyer = buyerOf("32", info);
  await comment(request, buyer, "хочу");
  await expect
    .poll(async () => (await pendingFor(request, buyer)).map((l) => l.status), {
      timeout: 15_000,
    })
    .toEqual(["pending"]);

  await Promise.all([dm(request, buyer, "+"), dm(request, buyer, "+")]);
  await waitOut(request, buyer, 0, (s) => text(s).includes("Вот каталог"));
  await expect
    .poll(async () => (await pendingFor(request, buyer)).map((l) => l.status))
    .toEqual(["processed"]);
  // Второй вебхук успевает отработать; второе сообщение одно, и ничего сверх него.
  await new Promise((r) => setTimeout(r, 1500));
  const sent = await out(request, buyer);
  expect(sent.filter((s) => text(s).includes("Вот каталог"))).toHaveLength(1);
  expect(sent).toHaveLength(1);
});

test("правило старого формата v1: кнопки уходят во второй шаг, у Zernio первое сообщение просит «+»", async ({
  request,
}, info) => {
  const buyer = buyerOf("33", info);
  await comment(request, buyer, "Прописи есть?");
  await expect
    .poll(async () => (await pendingFor(request, buyer)).map((l) => l.status), {
      timeout: 15_000,
    })
    .toEqual(["pending"]);

  // Правило у Zernio переписано: кнопок нет, в конце — просьба ответить «+».
  const patch = (await zernio(request)).find(
    (s) => s.method === "PATCH" && s.path.includes(`/comment-automations/${F.RULE_V1}`),
  );
  expect(patch?.body).toEqual({
    buttons: [],
    dmMessage: "Держите каталог\n\nОтветьте «+» в этот чат, и я пришлю ссылку 👇",
  });

  await dm(request, buyer, "+");
  const second = await waitOut(request, buyer, 0, (s) => payloads(s).includes("CATALOG"));
  expect(second.body.accountId).toBe(F.IG_ACCOUNT);
});
