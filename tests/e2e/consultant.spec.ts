import { createHmac } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import * as F from "./fixtures.ts";

/**
 * ИИ-консультант в Instagram Direct на собранном приложении: покупатель
 * задаёт вопрос — консультант отвечает словами модели; просит менеджера —
 * короткий ответ покупателю, уведомление продавцу в Telegram, дальше
 * консультант в этом диалоге молчит. Модель, Zernio и Telegram подставные
 * (pg-stub.ts): тест читает, что приложение спросило и отправило.
 */

type ZSent = { method: string; path: string; body: Record<string, unknown> };
type Asked = {
  model: string;
  system: { text: string }[];
  messages: unknown[];
  tools: { name: string }[];
};

let seq = Math.floor(Math.random() * 1e9) * 1000 + 500;

async function say(request: APIRequestContext, buyer: string, text: string) {
  const payload = {
    id: `evt-c-${++seq}`,
    event: "message.received",
    message: {
      id: `mid-c-${seq}`,
      conversationId: `conv-c-${buyer}`,
      platform: "instagram",
      direction: "incoming",
      sender: { id: buyer, name: "Айгерим", username: `buyer_${buyer}` },
      sentAt: new Date().toISOString(),
      text,
    },
    conversation: { id: `conv-c-${buyer}`, participantId: buyer },
    account: { id: F.CONS_IG_ACCOUNT, profileId: F.CONS_IG_PROFILE, platform: "instagram" },
    timestamp: new Date().toISOString(),
  };
  const raw = JSON.stringify(payload);
  const sig = createHmac("sha256", F.ZERNIO_WEBHOOK_SECRET).update(raw).digest("hex");
  const res = await request.post("/api/zernio/webhook", {
    headers: { "content-type": "application/json", "x-zernio-signature": sig },
    data: raw,
  });
  expect(res.status()).toBe(200);
}

/** Ответы покупателю в Direct через API Zernio. */
async function replies(request: APIRequestContext, buyer: string): Promise<string[]> {
  const all = (await (await request.get(`${F.STUB}/__e2e/zernio`)).json()) as ZSent[];
  return all
    .filter(
      (s) =>
        s.method === "POST" && s.path.endsWith(`/inbox/conversations/conv-c-${buyer}/messages`),
    )
    .map((s) => String(s.body.message ?? ""));
}

/**
 * Что консультант спросил у модели в этом диалоге: оба проекта (desktop и
 * phone) идут в одну заглушку, поэтому в каждом вопросе — метка покупателя.
 */
async function asked(request: APIRequestContext, buyer: string): Promise<Asked[]> {
  const all = (await (await request.get(`${F.STUB}/__e2e/anthropic`)).json()) as Asked[];
  return all.filter((a) => JSON.stringify(a.messages).includes(`№${buyer}`));
}

/** Сообщения продавцу консультанта от его бота. */
async function toSeller(request: APIRequestContext): Promise<string[]> {
  const all = (await (await request.get(`${F.STUB}/__e2e/telegram`)).json()) as Array<{
    method: string;
    token: string;
    body: Record<string, unknown>;
  }>;
  return all
    .filter(
      (s) =>
        s.method === "sendMessage" &&
        s.token === F.CONS_BOT_TOKEN &&
        Number(s.body.chat_id) === F.CONS_SELLER_TG,
    )
    .map((s) => String(s.body.text ?? ""));
}

test("консультант в Direct: отвечает на вопрос, передаёт менеджеру, продавцу приходит уведомление", async ({
  request,
}, info) => {
  const buyer = `27${info.parallelIndex}${info.project.name.length}${Date.now()}`;

  // Вопрос — ответ модели уходит покупателю в Direct.
  await say(request, buyer, `Здравствуйте! Из чего ваши полотенца? №${buyer}`);
  await expect.poll(() => replies(request, buyer), { timeout: 15_000 }).toEqual([F.CONS_ANSWER]);
  const first = await asked(request, buyer);
  expect(first).toHaveLength(1);
  expect(first[0]!.system.map((s) => s.text).join("\n")).toContain(F.CONS_NAME);
  expect(JSON.stringify(first[0]!.messages)).toContain("Из чего ваши полотенца?");
  expect(first[0]!.tools.map((t) => t.name)).toContain("handoff_to_manager");

  // Просьба позвать человека — передача менеджеру, продавцу уведомление.
  const sellerBefore = (await toSeller(request)).length;
  await say(request, buyer, `Позовите менеджера, хочу оптом №${buyer}`);
  await expect
    .poll(async () => (await replies(request, buyer)).length, { timeout: 15_000 })
    .toBe(2);
  expect((await replies(request, buyer))[1]).toContain("менеджеру");
  // Модель видит прошлый ответ: история диалога идёт в запросе.
  const second = (await asked(request, buyer))[1]!;
  expect(JSON.stringify(second.messages)).toContain(F.CONS_ANSWER);
  await expect
    .poll(async () => (await toSeller(request)).slice(sellerBefore), { timeout: 15_000 })
    .toHaveLength(1);
  const notice = (await toSeller(request)).slice(sellerBefore)[0]!;
  expect(notice).toContain("Клиент ждёт менеджера");
  expect(notice).toContain(F.CONS_HANDOFF_SUMMARY);
  expect(notice).toContain("Instagram");

  // После передачи консультант в диалоге молчит: модель не спрашивается, ответа нет.
  await say(request, buyer, `А когда ответят? №${buyer}`);
  await new Promise((r) => setTimeout(r, 1500));
  expect(await asked(request, buyer)).toHaveLength(2);
  expect(await replies(request, buyer)).toHaveLength(2);
});
