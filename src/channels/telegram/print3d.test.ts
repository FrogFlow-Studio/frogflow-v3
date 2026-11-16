import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TelegramApi } from "./api";
import { print3dPrivateMessage, print3dWorkReply, runPrint3dReadyFor } from "./print3d";
import type { TelegramMessage } from "./types";

/**
 * Студия 3D-печати (3D simple): клиент пишет номер с чека — карточка ему и в
 * рабочую группу, один раз; мастер отвечает свайпом — ответ клиенту;
 * «готово» в таблице — одно сообщение клиенту, если продавец включил.
 * Таблица — настоящая CSV-выгрузка через downloadSheet (подменён только fetch).
 */
const T = "11111111-2222-3333-4444-555555555555";
const GROUP = "-1001234567890";
const SHEET =
  "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=0";

let csv = "";
function sheet(rows: string[]) {
  csv = ["Номер,Имя,Телефон,Заказ,Срок,Сумма,Фото,Статус", ...rows].join("\n");
}

beforeEach(() => {
  sheet([
    "1234,Иван,+7 701 111 22 33,Кронштейн PETG,20.11,8000,https://drive.google.com/file/d/AbCdEfGhIjKlMn/view,в работе",
    "1235,Мария,87012223344,Корпус,21.11,12000,,в работе",
  ]);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(csv, { status: 200, headers: { "content-type": "text/csv; charset=utf-8" } }),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());

type Call = { method: string; payload: Record<string, unknown> };

function studio(opts: { ready?: boolean } = {}) {
  const db: FakeDb = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [
    { bot_id: T, key: "admin_chat_id", value: GROUP },
    { bot_id: T, key: "print3d_sheet_url", value: SHEET },
    ...(opts.ready ? [{ bot_id: T, key: "print3d_ready_notify", value: "true" }] : []),
  ];
  const ctx = {
    tenant: { id: T, vertical: "print3d", settings: {}, modules: {}, ownerTelegramId: null },
    db,
  } as unknown as TenantContext;
  const calls: Call[] = [];
  const api: TelegramApi = {
    call: async (method: string, payload?: unknown) => {
      calls.push({ method, payload: payload as Record<string, unknown> });
      return { ok: true, result: { message_id: calls.length } } as never;
    },
  } as unknown as TelegramApi;
  return { ctx, db, api, calls };
}

let mid = 100;
function dm(from: number, text: string): TelegramMessage {
  return {
    message_id: ++mid,
    chat: { id: from, type: "private" },
    from: { id: from, first_name: "Иван", username: "ivan" } as TelegramMessage["from"],
    text,
  };
}

const to = (calls: Call[], chat: string | number) =>
  calls.filter((c) => String(c.payload.chat_id) === String(chat));
const body = (c: Call) => String(c.payload.text ?? c.payload.caption ?? "");

describe("студия 3D-печати: клиент пишет номер с чека", () => {
  it("свежий номер: карточка с фото клиенту и в рабочую группу, привязка записана", async () => {
    const s = studio();
    expect(await print3dPrivateMessage(s.ctx, s.api, dm(555, "1234"), "ru", null)).toBe(true);
    const mine = to(s.calls, 555);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.method).toBe("sendPhoto");
    expect(mine[0]!.payload.photo).toBe(
      "https://drive.google.com/uc?export=download&id=AbCdEfGhIjKlMn",
    );
    expect(body(mine[0]!)).toContain("Заказ № 1234");
    expect(body(mine[0]!)).toContain("Кронштейн PETG");
    expect(body(mine[0]!)).not.toContain("701 111");
    const group = to(s.calls, GROUP);
    expect(group).toHaveLength(1);
    expect(body(group[0]!)).toContain("+7 701 111 22 33");
    expect(body(group[0]!)).toContain("#p3d555");
    const bind = s.db.tables.app_settings!.find((r) => r.key === "print3d_bind:1234");
    expect(JSON.parse(String(bind!.value))).toMatchObject({ platform: "telegram", id: "555" });
  });

  it("тот же номер ещё раз: карточку второй раз не шлём, сообщение уходит мастеру", async () => {
    const s = studio();
    await print3dPrivateMessage(s.ctx, s.api, dm(555, "1234"), "ru", null);
    s.calls.length = 0;
    await print3dPrivateMessage(s.ctx, s.api, dm(555, "1234 а когда готово?"), "ru", null);
    expect(to(s.calls, 555)).toHaveLength(0);
    const group = to(s.calls, GROUP);
    expect(group).toHaveLength(1);
    expect(body(group[0]!)).toContain("а когда готово?");
  });

  it("чужой номер (уже привязан к другому чату): карточки нет, мастеру предупреждение", async () => {
    const s = studio();
    await print3dPrivateMessage(s.ctx, s.api, dm(555, "1234"), "ru", null);
    s.calls.length = 0;
    await print3dPrivateMessage(s.ctx, s.api, dm(666, "1234"), "ru", null);
    const mine = to(s.calls, 666);
    expect(mine).toHaveLength(1);
    expect(body(mine[0]!)).toContain("уже привязан");
    expect(body(mine[0]!)).not.toContain("Кронштейн");
    expect(body(to(s.calls, GROUP)[0]!)).toContain("⚠️");
  });

  it("гонка: два чата одновременно шлют один номер — карточка уходит только одному", async () => {
    const s = studio();
    await Promise.all([
      print3dPrivateMessage(s.ctx, s.api, dm(555, "1234"), "ru", null),
      print3dPrivateMessage(s.ctx, s.api, dm(666, "1234"), "ru", null),
    ]);
    const cards = s.calls.filter(
      (c) => c.payload.chat_id !== GROUP && body(c).includes("Кронштейн"),
    );
    expect(cards).toHaveLength(1);
  });

  it("повтор вебхука одного сообщения — одна карточка", async () => {
    const s = studio();
    const msg = dm(555, "1234");
    await Promise.all([
      print3dPrivateMessage(s.ctx, s.api, msg, "ru", null),
      print3dPrivateMessage(s.ctx, s.api, msg, "ru", null),
    ]);
    expect(to(s.calls, 555)).toHaveLength(1);
  });

  it("клиент поделился контактом — заказ находится по телефону", async () => {
    const s = studio();
    const msg = { ...dm(777, ""), text: undefined, contact: { phone_number: "+77012223344" } };
    await print3dPrivateMessage(s.ctx, s.api, msg, "kk", null);
    const mine = to(s.calls, 777);
    expect(mine).toHaveLength(1);
    expect(body(mine[0]!)).toContain("Тапсырыс № 1235");
  });

  it("«здравствуйте» без номера: один раз просим номер, сообщение — мастеру; второй раз бот молчит", async () => {
    const s = studio();
    await print3dPrivateMessage(s.ctx, s.api, dm(888, "Здравствуйте"), "ru", null);
    expect(to(s.calls, 888).map(body)).toEqual([expect.stringContaining("номер заказа")]);
    expect(body(to(s.calls, GROUP)[0]!)).toContain("заказ не найден");
    s.calls.length = 0;
    await print3dPrivateMessage(s.ctx, s.api, dm(888, "Алло?"), "ru", null);
    expect(to(s.calls, 888)).toHaveLength(0);
    expect(to(s.calls, GROUP)).toHaveLength(1);
  });

  it("таблица не читается: бот не выдумывает заказ, сообщение уходит мастеру", async () => {
    const s = studio();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("err", { status: 500 })),
    );
    await print3dPrivateMessage(s.ctx, s.api, dm(555, "1234"), "ru", null);
    expect(to(s.calls, 555).map(body).join()).not.toContain("Кронштейн");
    expect(to(s.calls, GROUP)).toHaveLength(1);
  });

  it("другая ниша — бот студии не вмешивается", async () => {
    const s = studio();
    (s.ctx.tenant as { vertical: string }).vertical = "digital";
    expect(await print3dPrivateMessage(s.ctx, s.api, dm(555, "1234"), "ru", null)).toBe(false);
    expect(s.calls).toHaveLength(0);
  });
});

describe("студия 3D-печати: мастер отвечает свайпом в рабочей группе", () => {
  it("ответ на сообщение с меткой клиента копируется клиенту", async () => {
    const s = studio();
    const reply: TelegramMessage = {
      message_id: 9,
      chat: { id: Number(GROUP), type: "supergroup" },
      from: { id: 42, first_name: "Мастер" } as TelegramMessage["from"],
      text: "Будет готово завтра к обеду",
      reply_to_message: { text: "💬 Иван · заказ № 1234\nОтветьте… #p3d555" },
    };
    expect(await print3dWorkReply(s.ctx, s.api, reply)).toBe(true);
    const copy = s.calls.find((c) => c.method === "copyMessage")!;
    expect(copy.payload).toMatchObject({
      chat_id: "555",
      from_chat_id: Number(GROUP),
      message_id: 9,
    });
    expect(body(to(s.calls, GROUP)[0]!)).toContain("Отправлено");
  });

  it("чужой чат (не рабочая группа) с той же меткой — не пересылается", async () => {
    const s = studio();
    const reply: TelegramMessage = {
      message_id: 9,
      chat: { id: -100999, type: "supergroup" },
      from: { id: 42, first_name: "Кто-то" } as TelegramMessage["from"],
      text: "привет",
      reply_to_message: { text: "#p3d555" },
    };
    expect(await print3dWorkReply(s.ctx, s.api, reply)).toBe(false);
    expect(s.calls).toHaveLength(0);
  });
});

describe("студия 3D-печати: «заказ готов» из таблицы", () => {
  async function bound(opts: { ready?: boolean }) {
    const s = studio(opts);
    await print3dPrivateMessage(s.ctx, s.api, dm(555, "1234"), "ru", null);
    sheet([
      "1234,Иван,+7 701 111 22 33,Кронштейн PETG,20.11,8000,,Готово",
      "1235,Мария,87012223344,Корпус,21.11,12000,,Готово",
    ]);
    s.calls.length = 0;
    return s;
  }
  const locale = async () => "ru" as const;

  it("включено: клиенту одно сообщение, группе отметка; заказ без привязки не трогаем", async () => {
    const s = await bound({ ready: true });
    expect(await runPrint3dReadyFor(s.ctx, s.api, locale)).toEqual({
      ok: true,
      sent: 1,
      failed: 0,
    });
    expect(to(s.calls, 555).map(body)).toEqual(["Ваш заказ № 1234 готов, можно забирать!"]);
    expect(body(to(s.calls, GROUP)[0]!)).toContain("1234");
    expect(s.db.tables.app_settings!.some((r) => r.key === "print3d_ready:1235")).toBe(false);
  });

  it("два крона одновременно и повторный запуск — клиенту всё равно одно сообщение", async () => {
    const s = await bound({ ready: true });
    await Promise.all([
      runPrint3dReadyFor(s.ctx, s.api, locale),
      runPrint3dReadyFor(s.ctx, s.api, locale),
    ]);
    await runPrint3dReadyFor(s.ctx, s.api, locale);
    expect(to(s.calls, 555)).toHaveLength(1);
  });

  it("выключено (по умолчанию) — бот ничего не пишет", async () => {
    const s = await bound({});
    expect(await runPrint3dReadyFor(s.ctx, s.api, locale)).toEqual({ skipped: "ready notify off" });
    expect(s.calls).toHaveLength(0);
  });

  it("отправка не прошла — повторно не шлём (могла дойти)", async () => {
    const s = await bound({ ready: true });
    const failing: TelegramApi = {
      call: async (method: string, payload?: unknown) => {
        s.calls.push({ method, payload: payload as Record<string, unknown> });
        return { ok: false, error_code: 502, description: "Bad Gateway" } as never;
      },
    } as unknown as TelegramApi;
    expect(await runPrint3dReadyFor(s.ctx, failing, locale)).toEqual({
      ok: true,
      sent: 0,
      failed: 1,
    });
    await runPrint3dReadyFor(s.ctx, s.api, locale);
    expect(to(s.calls, 555)).toHaveLength(1);
  });
});
