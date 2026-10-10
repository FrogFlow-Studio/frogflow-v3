import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  deliverPendingTwoStepDm,
  handleCommentReceived,
  type AutomationApi,
} from "./automations.server";
import type { SendResult } from "./api.server";
import { secondStepAsText, secondStepFailureText } from "./second-step-text";

/**
 * Старая переписка (AATeach 10.10, 24 случая): второе сообщение с кнопками
 * Instagram не принял, журнал писал «Проверьте подключение Instagram», и
 * никто из 24 покупателей не ответил.
 */
const BOT = "22222222-2222-2222-2222-222222222222";
const BUTTONS = [
  { type: "url", title: "Открыть бота", url: "https://t.me/seller_bot" },
  { type: "postback", title: "Купить", payload: "PROD:p-1" },
];

function setup(first: SendResult) {
  const db = fakeDb({ unique: { zernio_logs: [["bot_id", "event_id"]] } });
  db.tables.app_settings = [
    {
      bot_id: BOT,
      key: "ig_comment_automations_meta",
      value: JSON.stringify({
        rule1: {
          twoStepDm: true,
          secondDmMessage: "Для получения материалов нажмите кнопку ниже 👇",
          secondDmButtons: BUTTONS,
        },
      }),
    },
  ];
  // Покупатель писал в Direct давно — переписка уже есть.
  db.tables.bot_users = [
    { bot_id: BOT, platform: "instagram", username: "anya", zernio_conversation_id: "conv-1" },
  ];
  db.tables.zernio_logs = [];
  const ctx = {
    tenant: {
      id: BOT,
      settings: {
        default_locale: "ru",
        zernio: { profile_id: "p-1", accounts: [{ id: "acc-1", platform: "instagram" }] },
      },
      modules: { instagram: true },
    },
    db,
  } as unknown as TenantContext;
  const sent: Array<{ text: string; buttons?: unknown }> = [];
  // Пока переписка «старая», отправка с кнопками получает ответ Instagram `first`.
  const instagram = { old: true };
  const inbox = vi.fn(
    async (_c: string, _a: string, text: string, opts?: { buttons?: unknown }) => {
      sent.push({ text, buttons: opts?.buttons });
      if (opts?.buttons && instagram.old) return first;
      return { ok: true };
    },
  );
  const api = {
    list: async () => [
      { id: "rule1", name: "Хочу", accountId: "acc-1", keywords: ["хочу"], dmMessage: "Привет!" },
    ],
    inbox,
  } as unknown as AutomationApi;
  const comment = () =>
    handleCommentReceived(
      ctx,
      {
        account: { id: "acc-1" },
        comment: { id: "c-1", text: "Хочу", author: { id: "u-1", username: "anya" } },
      },
      api,
      { delayMs: 0 },
    );
  const log = () => db.tables.zernio_logs!.find((l) => l.event_id === "two-step-dm:c-1")!;
  return { ctx, api, db, sent, comment, log, instagram };
}

const REJECTED: SendResult = {
  ok: false,
  error: "Не удалось отправить сообщение. Проверьте подключение Instagram и повторите попытку.",
  failure: { status: 400, platformCode: 100 },
};

describe("второе сообщение в старую переписку", () => {
  it("Instagram отказал (400) — тот же выбор уходит текстом, журнал пишет правду, ответ покупателя приносит кнопки", async () => {
    const t = setup(REJECTED);
    expect((await t.comment()).note).toBe("в очередь pending @anya");
    expect(t.sent).toHaveLength(2);
    expect(t.sent[1]!.buttons).toBeUndefined();
    expect(t.sent[1]!.text).toContain("Открыть бота: https://t.me/seller_bot");
    expect(t.sent[1]!.text).toContain("Чтобы купить, ответьте на это сообщение «+».");
    // Текст правила зовёт нажать кнопку — без кнопки его не шлём.
    expect(t.sent[1]!.text).not.toContain("нажмите кнопку");
    const row = t.log();
    expect(row.status).toBe("pending");
    expect(row.error_message).toContain("не принял кнопки в старой переписке (код Meta 100)");
    expect(row.error_message).not.toContain("Проверьте подключение");
    expect((row.payload as { textSentAt?: string }).textSentAt).toBeTruthy();

    // Покупатель ответил — окно открыто, второе сообщение с кнопками уходит из очереди.
    t.instagram.old = false;
    // created_at ставит база (default now()), база в памяти — нет.
    row.created_at = new Date().toISOString();
    const delivered = await deliverPendingTwoStepDm(
      t.ctx,
      { accountId: "acc-1", conversationId: "conv-1", username: "anya" },
      t.api,
    );
    expect(delivered).toBe(true);
    expect(t.sent).toHaveLength(3);
    expect(t.sent[2]!.buttons).toEqual(BUTTONS);
    expect(t.log().status).toBe("processed");
  });

  it("повтор вебхука комментария — текст второй раз не уходит", async () => {
    const t = setup(REJECTED);
    await t.comment();
    await t.comment();
    // Две попытки с кнопками и один текст.
    expect(t.sent.filter((s) => s.buttons === undefined)).toHaveLength(1);
    expect((t.log().payload as { textSentAt?: string }).textSentAt).toBeTruthy();
    expect(t.log().error_message).toContain("тот же выбор ушёл текстом");
  });

  it("окно 24 часа закрыто — текстом не пробуем (тоже не пройдёт), журнал так и пишет", async () => {
    const t = setup({
      ok: false,
      error: "x",
      failure: { status: 400, platformCode: 10, platformSubcode: 2018278 },
    });
    await t.comment();
    expect(t.sent).toHaveLength(1);
    expect(t.log().error_message).toContain("не писал в Direct больше суток");
  });

  it("ответа нет (таймаут) — сообщение могло уйти: текстом не дублируем", async () => {
    const t = setup({ ok: false, error: "x", failure: { status: null } });
    await t.comment();
    expect(t.sent).toHaveLength(1);
    expect(t.log().error_message).toContain("могло дойти");
  });
});

describe("второе сообщение текстом — на языке магазина", () => {
  it.each(["ru", "kk", "en", "uz"] as const)("%s: ссылка адресом и «+» вместо кнопки", (l) => {
    const text = secondStepAsText(l, "Держите материалы", BUTTONS as never);
    expect(text).toContain("Держите материалы");
    expect(text).toContain("https://t.me/seller_bot");
    expect(text).toContain("«+»".replace("«+»", l === "en" ? "“+”" : "«+»"));
  });
  it("без точного кода — без скобок; отказ и после текста — честно", () => {
    expect(secondStepFailureText({ status: 403 }, "failed")).toBe(
      "Instagram не принял сообщение в старой переписке ни с кнопками, ни текстом (HTTP 403). Второе сообщение с кнопками уйдёт, как только покупатель ответит в Direct.",
    );
  });
});
