import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { setEnvForTests } from "@/config/env";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";
import type { ZernioTransport } from "./api.server";
import { ZernioApiError } from "./errors";
import type { ZernioInboxMessage } from "./inbox-types";
import { MAX_AGE_MS, WEBHOOK_GRACE_MS, missedIncoming } from "./inbox-poll";

/**
 * Опрос ящика Zernio (перенос v1 inbox-poll): решение «отвечать ли» и
 * настоящий путь до ответа — dispatch → handle-message с меткой сообщения.
 * Подменены только модель консультанта и уведомления продавцу.
 */

const notifyAdminsHtml = vi.fn(async () => 1);
vi.mock("@/channels/telegram/notify", () => ({ notifyAdminsHtml }));
vi.mock("@/core/instagram/direct-bot-settings", () => ({
  loadDirectBotSettings: vi.fn(async () => ({ enabled: true, ignoreExcluded: false })),
}));
const runConsultant = vi.fn(async () => {
  // Модель думает: за это время успевает прийти второе событие о том же сообщении.
  await new Promise((r) => setTimeout(r, 5));
  return {
    reply: "Есть, 9 000 ₸.",
    handoff: null,
    usage: { inputTokens: 1, outputTokens: 1, usd: 0 },
  };
});
vi.mock("@/core/consultant/engine.server", () => ({
  consultantEnabled: async () => true,
  isPaused: () => false,
  pauseConsultant: vi.fn(async (_c: unknown, c: unknown) => c),
  runConsultant,
}));

const { pollTenantInbox, runInboxPollFor } = await import("./inbox-poll.server");
const { dispatchZernioEvent } = await import("./dispatch.server");

const NOW = Date.parse("2026-10-08T10:00:00Z");
const ago = (ms: number, base = NOW) => new Date(base - ms).toISOString();
const msg = (direction: "incoming" | "outgoing", at: string, text = "Сколько стоит?") =>
  ({ id: `m-${direction}-${at}`, direction, message: text, createdAt: at }) as ZernioInboxMessage;
const calm = { paused: false };

describe("отвечать ли на последнее входящее", () => {
  it("входящее 2 минуты назад, ответа нет — отвечаем", () => {
    const v = missedIncoming([msg("incoming", ago(120_000))], calm, NOW);
    expect(v.answer).toBe(true);
  });

  it("моложе 90 секунд — ждём вебхук (живой случай v1 23.09: два разных ответа)", () => {
    const v = missedIncoming([msg("incoming", ago(WEBHOOK_GRACE_MS - 1_000))], calm, NOW);
    expect(v).toEqual({ answer: false, why: "grace" });
  });

  it("старше 15 минут — не отвечаем на давнее", () => {
    const v = missedIncoming([msg("incoming", ago(MAX_AGE_MS + 1_000))], calm, NOW);
    expect(v).toEqual({ answer: false, why: "too_old" });
  });

  it("исходящее (бот или менеджер) новее входящего — уже ответили", () => {
    const v = missedIncoming(
      [msg("incoming", ago(180_000)), msg("outgoing", ago(170_000), "Здравствуйте!")],
      calm,
      NOW,
    );
    expect(v).toEqual({ answer: false, why: "answered" });
  });

  it("исходящее раньше входящего не мешает ответу", () => {
    const v = missedIncoming(
      [msg("outgoing", ago(300_000), "Здравствуйте!"), msg("incoming", ago(180_000))],
      calm,
      NOW,
    );
    expect(v.answer).toBe(true);
  });

  it("бот ответил позже (в памяти), хотя в ленте Zernio этого ещё нет — не отвечаем", () => {
    const v = missedIncoming(
      [msg("incoming", ago(180_000))],
      { paused: false, lastReplyAt: ago(170_000) },
      NOW,
    );
    expect(v).toEqual({ answer: false, why: "answered" });
  });

  it("диалог на паузе — молчим", () => {
    const v = missedIncoming([msg("incoming", ago(120_000))], { paused: true }, NOW);
    expect(v).toEqual({ answer: false, why: "paused" });
  });

  it("сообщение до возврата диалога боту (сброс) — не отвечаем", () => {
    const v = missedIncoming(
      [msg("incoming", ago(180_000))],
      { paused: false, resumedAt: ago(100_000) },
      NOW,
    );
    expect(v).toEqual({ answer: false, why: "before_resume" });
  });

  it("без времени или без входящих — не отвечаем", () => {
    expect(missedIncoming([{ direction: "incoming", message: "?" }], calm, NOW)).toEqual({
      answer: false,
      why: "no_time",
    });
    expect(missedIncoming([msg("outgoing", ago(120_000))], calm, NOW)).toEqual({
      answer: false,
      why: "no_incoming",
    });
  });

  it("голосовое или фото без текста — отдаём обработчику (он попросит написать или посмотрит фото)", () => {
    const voice = {
      ...msg("incoming", ago(120_000), ""),
      attachments: [{ type: "audio", url: "https://cdn.test/a" }],
    };
    expect(missedIncoming([voice], calm, NOW).answer).toBe(true);
  });
});

const BOT = "bot-1";
let db: FakeDb;
let tenant: Tenant;
let ctx: TenantContext;
let sent: string[];
let inbox: ZernioInboxMessage[];
let transport: ZernioTransport;

function deps(over: Partial<import("./inbox-poll.server").InboxPollDeps> = {}) {
  return {
    listConversations: vi.fn(async () => [
      { id: "conv-1", participantId: "777", updatedTime: inbox.at(-1)?.createdAt },
    ]),
    transport,
    dispatch: dispatchZernioEvent,
    consultantEnabled: async () => true,
    page: 50,
    ...over,
  };
}

const webhookFor = (m: ZernioInboxMessage) =>
  ({
    id: "evt-webhook-1",
    event: "message.received",
    message: {
      id: m.id,
      conversationId: "conv-1",
      platform: "instagram",
      direction: "incoming",
      text: m.message,
      sender: { id: "777" },
      sentAt: m.createdAt,
    },
    account: { accountId: "acc-1", platform: "instagram" },
  }) as never;

/** Как intake.server: строка журнала received до обработки. */
async function webhook(m: ZernioInboxMessage) {
  await db.from("zernio_logs").insert({
    bot_id: BOT,
    event_id: "evt-webhook-1",
    event_type: "message.received",
    status: "received",
    payload: {},
  });
  return dispatchZernioEvent(ctx, "evt-webhook-1", webhookFor(m), transport);
}

const replies = () => sent.filter((t) => t === "Есть, 9 000 ₸.");

beforeEach(() => {
  setEnvForTests({});
  db = fakeDb({
    unique: {
      zernio_logs: [["event_id"]],
      consultant_message_runs: [["bot_id", "message_id"]],
      bot_users: [["bot_id", "user_key"]],
    },
  });
  db.tables.bot_users = [];
  db.tables.zernio_logs = [];
  db.tables.consultant_message_runs = [];
  db.tables.app_settings = [];
  db.tables.blocked_users = [];
  tenant = {
    id: BOT,
    name: "BOVI",
    status: "active",
    vertical: "consultant",
    modules: { instagram: true },
    settings: {
      served_by: "v2",
      zernio: {
        profile_id: "p",
        account_ids: ["acc-1"],
        accounts: [{ id: "acc-1", platform: "instagram" }],
      },
    },
  } as unknown as Tenant;
  ctx = {
    tenant,
    db,
    timezone: "Asia/Almaty",
    appUrl: "https://app.test",
  } as unknown as TenantContext;
  sent = [];
  inbox = [msg("incoming", new Date(Date.now() - 120_000).toISOString())];
  transport = {
    send: vi.fn(async (_c: string, _a: string, text: string) => {
      sent.push(text);
      return { ok: true };
    }),
    tail: vi.fn(async () => inbox),
  } as unknown as ZernioTransport;
  runConsultant.mockClear();
  notifyAdminsHtml.mockClear();
});
afterEach(() => setEnvForTests(undefined));

describe("опрос отвечает на пропущенное тем же обработчиком", () => {
  it("вебхук не пришёл — один ответ, журнал помечен «опрос», ответ записан как source=poll", async () => {
    const r = await pollTenantInbox(ctx, deps());
    expect(r).toMatchObject({ answered: 1, checked: 1 });
    expect(replies()).toHaveLength(1);
    const log = db.tables.zernio_logs!.find((x) => String(x.event_id).startsWith("poll:"));
    expect(log).toMatchObject({ status: "processed", event_type: "message.received" });
    expect(String(log!.error_message)).toMatch(/^опрос/);
    expect(db.tables.consultant_message_runs![0]).toMatchObject({
      source: "poll",
      status: "replied",
    });
    // Покупатель записан с id собеседника из диалога, тем же ключом, что дал бы вебхук.
    expect(db.tables.bot_users![0]).toMatchObject({ user_key: "ig_777" });
  });

  it("поздний вебхук после ответа опроса — второго ответа нет", async () => {
    await pollTenantInbox(ctx, deps());
    const r = await webhook(inbox[0]!);
    expect(r.status).toBe("ignored");
    expect(r.note).toMatch(/уже обработано/);
    expect(replies()).toHaveLength(1);
  });

  it("вебхук успел первым — опрос видит метку и молчит", async () => {
    await webhook(inbox[0]!);
    // Лента Zernio ещё без ответа бота, память покупателя — тоже не помогла бы.
    db.tables.bot_users![0]!.state = {};
    await pollTenantInbox(ctx, deps());
    expect(replies()).toHaveLength(1);
  });

  it("гонка: опрос и поздний вебхук одновременно — ровно один ответ", async () => {
    const [poll, hook] = await Promise.all([pollTenantInbox(ctx, deps()), webhook(inbox[0]!)]);
    expect(replies()).toHaveLength(1);
    expect(runConsultant).toHaveBeenCalledTimes(1);
    const answeredByPoll = "answered" in poll && poll.answered === 1;
    expect(answeredByPoll !== (hook.status === "processed")).toBe(true);
  });

  it("два крона опроса одновременно — один ответ", async () => {
    await Promise.all([pollTenantInbox(ctx, deps()), pollTenantInbox(ctx, deps())]);
    expect(replies()).toHaveLength(1);
    expect(runConsultant).toHaveBeenCalledTimes(1);
  });

  it("повтор того же события вебхука (добор) метку своей считает и обрабатывает", async () => {
    const { claimZernioMessage } = await import("./message-claim.server");
    expect(await claimZernioMessage(ctx, "m-1", "evt-a", "conv-1")).toBe("won");
    expect(await claimZernioMessage(ctx, "m-1", "evt-a", "conv-1")).toBe("won");
    expect(await claimZernioMessage(ctx, "m-1", "poll:x", "conv-1")).toBe("lost");
  });

  it("моложе 90 секунд — опрос ждёт вебхук и ничего не шлёт", async () => {
    inbox = [msg("incoming", new Date(Date.now() - 30_000).toISOString())];
    const r = await pollTenantInbox(ctx, deps());
    expect(r).toMatchObject({ answered: 0, skipped: { grace: 1 } });
    expect(sent).toEqual([]);
  });
});

describe("кого и сколько опрашиваем", () => {
  it("клиент v1 и клиент с выключенным консультантом — не трогаем", async () => {
    tenant.settings.served_by = "v1";
    const d = deps();
    expect(await pollTenantInbox(ctx, d)).toEqual({ skipped: "not v2" });
    tenant.settings.served_by = "v2";
    expect(await pollTenantInbox(ctx, deps({ consultantEnabled: async () => false }))).toEqual({
      skipped: "consultant off",
    });
    expect(d.listConversations).not.toHaveBeenCalled();
  });

  it("WhatsApp-аккаунт без модуля whatsapp не опрашивается", async () => {
    tenant.settings.zernio!.accounts!.push({ id: "acc-2", platform: "whatsapp" });
    tenant.settings.zernio!.account_ids!.push("acc-2");
    const d = deps();
    await pollTenantInbox(ctx, d);
    expect(d.listConversations).toHaveBeenCalledTimes(1);
    expect(d.listConversations).toHaveBeenCalledWith("acc-1", "instagram");
  });

  it("диалогов больше предела — лишние посчитаны в over_cap, а не потеряны молча", async () => {
    const many = Array.from({ length: 13 }, (_, i) => ({
      id: `conv-${i}`,
      participantId: `${i}`,
      updatedTime: new Date(Date.now() - 60_000).toISOString(),
    }));
    inbox = [msg("outgoing", new Date(Date.now() - 60_000).toISOString())];
    const r = await pollTenantInbox(ctx, deps({ listConversations: async () => many }));
    expect(r).toMatchObject({ conversations: 13, checked: 10, over_cap: 3 });
  });

  it("429 Zernio — опрос клиента встаёт, остальные клиенты в этот запуск не трогаются", async () => {
    const limited = new ZernioApiError("Zernio API 429", { status: 429, retryAfterSec: 30 });
    const list = vi.fn(async () => {
      throw limited;
    });
    const second = { ...tenant, id: "bot-2" } as Tenant;
    const out = await runInboxPollFor([tenant, second], () => ctx, {
      deadline: Date.now() + 10_000,
      deps: deps({ listConversations: list }),
    });
    expect(out[BOT]).toMatchObject({ rateLimitedSec: 30 });
    expect(out["bot-2"]).toEqual({ skipped: "zernio rate limit, 30 s" });
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("сбой чтения переписки — в errors, без ответа", async () => {
    transport.tail = vi.fn(async () => {
      throw new Error("Zernio API: нет ответа (timeout)");
    });
    const r = await pollTenantInbox(ctx, deps());
    expect(r).toMatchObject({ answered: 0, checked: 0 });
    expect((r as { errors: string[] }).errors[0]).toMatch(/timeout/);
    expect(sent).toEqual([]);
  });
});
