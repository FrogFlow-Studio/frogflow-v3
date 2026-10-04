import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";
import { findZernioTenant } from "@/core/tenant/directory";
import {
  FLOOD_NOTE,
  admitZernioInbound,
  eventTooOld,
  intakeZernioEvent,
  unmatchedLogRow,
  type IntakeDeps,
  type UnmatchedZernioEvent,
} from "./intake.server";
import {
  claimZernioEvent,
  markZernioEventSending,
  retryStuckEvents,
  type DispatchOutcome,
} from "./dispatch.server";
import { beforeExternalEffect } from "@/lib/external-effects";
import type { ZernioWebhookMessagePayload } from "./message";

/**
 * Приём вебхука Zernio: ответ до обработки (Zernio ждёт не дольше 5 секунд),
 * одна обработка на событие при повторной доставке и гонке с добором, и
 * магазин по профилю после переподключения аккаунта (новый id аккаунта).
 */
const tenant = (id: string, zernio: Record<string, unknown>, servedBy = "v2") =>
  ({ id, name: id, settings: { served_by: servedBy, zernio } }) as unknown as Tenant;

const SHOP = tenant("shop", { profile_id: "prof-1", account_ids: ["acc-old"] });
const OTHER = tenant("other", { profile_id: "prof-2", account_ids: ["acc-other"] });
const V1 = tenant("v1shop", { profile_id: "prof-v1", account_ids: ["acc-v1"] }, "v1");

const event = (id: string, account: Record<string, string>): ZernioWebhookMessagePayload =>
  ({ id, event: "message.received", account }) as ZernioWebhookMessagePayload;

function setup(directory: Tenant[] = [SHOP, OTHER, V1]) {
  const db = fakeDb({ unique: { zernio_logs: [["event_id"]] } });
  db.tables.zernio_logs = [];
  const queued: Array<() => Promise<void>> = [];
  const dispatched: Array<{ eventId: string; tenant: string }> = [];
  const resynced: string[] = [];
  const verdicts: Array<"ok" | "limited" | "limited_notify"> = [];
  const flooded: string[] = [];
  const deps: IntakeDeps = {
    resolve: async (a, p) => findZernioTenant(directory, a, p),
    tenantContext: (t) => ({ tenant: t, db }) as unknown as TenantContext,
    background: async (task) => {
      queued.push(task);
    },
    claim: (ctx, id) => claimZernioEvent(ctx, id, new Date(), "webhook"),
    dispatch: async (ctx, eventId): Promise<DispatchOutcome> => {
      dispatched.push({ eventId, tenant: ctx.tenant.id });
      return { status: "processed", note: "ок" };
    },
    settle: async (ctx, eventId, r) => {
      await ctx.db
        .from("zernio_logs")
        .update({ status: r.status, error_message: r.note })
        .eq("event_id", eventId);
    },
    markSending: (ctx, id) => markZernioEventSending(ctx, id),
    admit: async () => verdicts.shift() ?? "ok",
    notifyFlood: async (_ctx, p) => {
      flooded.push(p.id ?? "");
    },
    resync: async (t) => {
      resynced.push(t.id);
      return tenant(t.id, { profile_id: "prof-1", account_ids: ["acc-old", "acc-new"] });
    },
  };
  const row = (id: string) => db.tables.zernio_logs!.find((r) => r.event_id === id);
  const drain = async () => {
    while (queued.length) await queued.shift()!();
  };
  return { db, deps, queued, dispatched, resynced, row, drain, verdicts, flooded };
}

describe("приём вебхука Zernio", () => {
  it("отвечает 200 до обработки: строка журнала received, обработка — в фоне", async () => {
    const s = setup();
    const r = await intakeZernioEvent(event("e1", { accountId: "acc-old" }), s.deps);
    expect(r.status).toBe(200);
    expect(s.dispatched).toEqual([]);
    expect(s.row("e1")).toMatchObject({ bot_id: "shop", status: "received" });
    await s.drain();
    expect(s.dispatched).toEqual([{ eventId: "e1", tenant: "shop" }]);
    expect(s.row("e1")).toMatchObject({ status: "processed", error_message: "ок" });
  });

  it("ссылка заказа, которую покупатель вставил в переписку, в журнал полностью не попадает", async () => {
    const s = setup();
    const link = `https://shop.test/s/x/order/9?t=${"a1".repeat(16)}`;
    const p = {
      ...event("e-link", { accountId: "acc-old" }),
      message: { text: `вот мой заказ ${link}` },
    } as unknown as ZernioWebhookMessagePayload;
    expect((await intakeZernioEvent(p, s.deps)).status).toBe(200);
    const stored = JSON.stringify(s.row("e-link")!.payload);
    expect(stored).not.toContain("a1".repeat(16));
    expect(stored).toContain("/order/9?t=***");
    expect(stored).toContain("вот мой заказ");
  });

  it("повторная доставка того же события — 200 без второй обработки", async () => {
    const s = setup();
    await intakeZernioEvent(event("e1", { accountId: "acc-old" }), s.deps);
    const again = await intakeZernioEvent(event("e1", { accountId: "acc-old" }), s.deps);
    expect(again.status).toBe(200);
    expect(s.queued).toHaveLength(1);
    await s.drain();
    expect(s.dispatched).toHaveLength(1);
  });

  it("фон и добор не обрабатывают событие дважды, кто бы ни забрал строку первым", async () => {
    // Добор успел раньше фона: фон видит, что строка уже забрана, и молчит.
    const a = setup();
    await intakeZernioEvent(event("e1", { accountId: "acc-old" }), a.deps);
    a.row("e1")!.created_at = new Date(Date.now() - 5 * 60_000).toISOString();
    const ctx = a.deps.tenantContext(SHOP);
    await retryStuckEvents(ctx, new Date(), async (c, id) => a.deps.dispatch(c, id, event(id, {})));
    await a.drain();
    expect(a.dispatched).toHaveLength(1);

    // Фон раньше добора: добор не находит строк received.
    const b = setup();
    await intakeZernioEvent(event("e2", { accountId: "acc-old" }), b.deps);
    b.row("e2")!.created_at = new Date(Date.now() - 5 * 60_000).toISOString();
    const task = b.queued.shift()!;
    const bg = task();
    const cron = retryStuckEvents(b.deps.tenantContext(SHOP), new Date(), async (c, id) =>
      b.deps.dispatch(c, id, event(id, {})),
    );
    await Promise.all([bg, cron]);
    expect(b.dispatched).toHaveLength(1);
  });

  it("аккаунт переподключён (новый id): магазин находится по профилю, id записывается сразу", async () => {
    const s = setup();
    const r = await intakeZernioEvent(
      event("e1", { accountId: "acc-new", profileId: "prof-1" }),
      s.deps,
    );
    expect(r.status).toBe(200);
    expect(s.row("e1")).toMatchObject({ bot_id: "shop" });
    await s.drain();
    expect(s.resynced).toEqual(["shop"]);
    expect(s.dispatched).toEqual([{ eventId: "e1", tenant: "shop" }]);
  });

  it("неизвестный аккаунт и профиль, клиент v1 — 202 без записи и обработки", async () => {
    const s = setup();
    for (const e of [
      event("e1", { accountId: "acc-x", profileId: "prof-x" }),
      event("e2", { accountId: "acc-v1" }),
      event("e3", { accountId: "acc-new", profileId: "prof-v1" }),
    ])
      expect((await intakeZernioEvent(e, s.deps)).status).toBe(202);
    expect(s.db.tables.zernio_logs).toEqual([]);
    expect(s.queued).toEqual([]);
  });
});

describe("брошенная обработка: повтор только без отправленного", () => {
  const later = () => new Date(Date.now() + 11 * 60_000);
  const redo = async (s: ReturnType<typeof setup>) => {
    const again: string[] = [];
    const r = await retryStuckEvents(s.deps.tenantContext(SHOP), later(), async (_c, id) => {
      again.push(id);
      return { status: "processed", note: null };
    });
    return { r, again };
  };

  it("фон умер до первой отправки — добор повторяет событие", async () => {
    const s = setup();
    s.deps.dispatch = async () => {
      throw new Error("функция умерла");
    };
    await intakeZernioEvent(event("e1", { accountId: "acc-old" }), s.deps);
    s.row("e1")!.created_at = new Date(Date.now() - 5 * 60_000).toISOString();
    await s.drain().catch(() => {});
    expect(s.row("e1")!.error_message).toMatch(/^обработка начата /);
    const { r, again } = await redo(s);
    expect(r).toMatchObject({ requeued: 1, processed: 1 });
    expect(again).toEqual(["e1"]);
  });

  it("фон умер после начала отправки (ответ консультанта ушёл) — добор не повторяет", async () => {
    const s = setup();
    const sent: string[] = [];
    s.deps.dispatch = async () => {
      await beforeExternalEffect();
      sent.push("ответ консультанта");
      await beforeExternalEffect(); // вторая отправка отметку не переписывает
      throw new Error("функция умерла");
    };
    await intakeZernioEvent(event("e1", { accountId: "acc-old" }), s.deps);
    s.row("e1")!.created_at = new Date(Date.now() - 5 * 60_000).toISOString();
    await s.drain().catch(() => {});
    expect(sent).toHaveLength(1);
    expect(s.row("e1")!.error_message).toMatch(/^отправка начата /);
    const { r, again } = await redo(s);
    expect(r).toMatchObject({ requeued: 0, abandoned: 1 });
    expect(again).toEqual([]);
    expect(s.row("e1")).toMatchObject({
      status: "failed",
      error_message: expect.stringMatching(/не повторяем/),
    });
  });

  it("вне обработки события отметка ничего не делает", async () => {
    await expect(beforeExternalEffect()).resolves.toBeUndefined();
  });
});

describe("магазин события Zernio", () => {
  it("аккаунт другого клиента профилем не перехватывается; записанный у двух — ничей", () => {
    // Аккаунт записан у «other», хотя пришёл с профилем «shop».
    expect(findZernioTenant([SHOP, OTHER], "acc-other", "prof-1")).toMatchObject({
      tenant: { id: "other" },
      via: "account",
    });
    const twin = tenant("twin", { profile_id: "prof-3", account_ids: ["acc-other"] });
    expect(findZernioTenant([SHOP, OTHER, twin], "acc-other", "prof-1")).toBeNull();
    expect(findZernioTenant([SHOP], "ACC-OLD", null)).toMatchObject({ via: "account" });
    expect(findZernioTenant([SHOP], "acc-new", "prof-1")).toMatchObject({ via: "profile" });
    expect(findZernioTenant([SHOP], "acc-new", null)).toBeNull();
  });
});

describe("лимит частоты входящих", () => {
  it("сверх лимита — строка ignored «частые сообщения», без обработки; добор её не берёт", async () => {
    const s = setup();
    s.verdicts.push("limited_notify", "limited");
    await intakeZernioEvent(event("f1", { accountId: "acc-old" }), s.deps);
    await intakeZernioEvent(event("f2", { accountId: "acc-old" }), s.deps);
    await s.drain();
    expect(s.row("f1")).toMatchObject({ status: "ignored", error_message: FLOOD_NOTE });
    expect(s.row("f2")).toMatchObject({ status: "ignored", error_message: FLOOD_NOTE });
    expect(s.dispatched).toEqual([]);
    // Продавцу — одно уведомление, на первое событие сверх лимита.
    expect(s.flooded).toEqual(["f1"]);
    await intakeZernioEvent(event("f3", { accountId: "acc-old" }), s.deps);
    await s.drain();
    expect(s.dispatched).toEqual([{ eventId: "f3", tenant: "shop" }]);
  });

  it("комментарии и прочие события лимит входящих не считает", async () => {
    const s = setup();
    s.verdicts.push("limited");
    const comment = { ...event("c1", { accountId: "acc-old" }), event: "comment.received" };
    await intakeZernioEvent(comment as ZernioWebhookMessagePayload, s.deps);
    await s.drain();
    expect(s.dispatched).toEqual([{ eventId: "c1", tenant: "shop" }]);
    expect(s.verdicts).toEqual(["limited"]);
  });
});

describe("лимит входящих: что считается", () => {
  const msg = (direction: string, i: number) =>
    ({
      id: `m${i}`,
      event: "message.received",
      account: { accountId: "acc-old", platform: "instagram" },
      conversation: { id: "conv-1", participantId: "ig-buyer" },
      message: { id: `m${i}`, direction, text: "фото" },
    }) as unknown as ZernioWebhookMessagePayload;

  it("40 исходящих (бот, продавец из приложения) не тратят лимит покупателя", async () => {
    const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
    const ctx = {
      tenant: { id: "33333333-3333-3333-3333-333333333333" },
      db,
    } as unknown as TenantContext;
    for (let i = 0; i < 40; i++)
      expect(await admitZernioInbound(ctx, msg("outgoing", i))).toBe("ok");
    expect(await admitZernioInbound(ctx, msg("incoming", 99))).toBe("ok");
    // Считалось только входящее.
    const row = (db.tables.app_settings ?? []).find((r) =>
      String(r.key).startsWith("rate_limit:inbound:"),
    );
    expect(JSON.parse(String(row?.value)).c).toBe(1);
  });
});

describe("повтор старого события Zernio", () => {
  const now = Date.parse("2026-09-28T12:00:00Z");
  it("событие старше недели — не обрабатывается; свежее и без времени — да", () => {
    expect(eventTooOld({ timestamp: "2026-08-01T00:00:00Z" }, now)).toBe(true);
    expect(eventTooOld({ message: { sentAt: "2026-09-01T00:00:00Z" } } as never, now)).toBe(true);
    expect(eventTooOld({ timestamp: "2026-09-28T11:59:00Z" }, now)).toBe(false);
    expect(eventTooOld({}, now)).toBe(false);
    expect(eventTooOld({ timestamp: "мусор" }, now)).toBe(false);
  });
});

describe("событие без клиента v2 (Копилка русоведа, 04.10)", () => {
  const withText = (id: string, account: Record<string, string>) =>
    ({
      id,
      event: "message.received",
      account: { platform: "instagram", username: "kopilka", ...account },
      message: { text: "/start", sender: { username: "buyer" }, attachments: [] },
    }) as unknown as ZernioWebhookMessagePayload;

  it("неизвестный аккаунт и клиент на v1 — 202, но след для оператора остаётся", async () => {
    const s = setup();
    const seen: UnmatchedZernioEvent[] = [];
    s.deps.unmatched = async (e) => {
      seen.push(e);
    };
    expect((await intakeZernioEvent(withText("u1", { accountId: "acc-x" }), s.deps)).status).toBe(
      202,
    );
    expect((await intakeZernioEvent(withText("u2", { accountId: "acc-v1" }), s.deps)).status).toBe(
      202,
    );
    expect(seen.map((e) => [e.eventId, e.tenantName])).toEqual([
      ["u1", null],
      ["u2", "v1shop"],
    ]);
    // Ни обработки, ни строки журнала с id события — журнал v1 не задет.
    expect(s.dispatched).toEqual([]);
    expect(s.row("u1")).toBeUndefined();
  });

  it("строка журнала: свой event_id, без клиента, без полного payload, с причиной", () => {
    const e: UnmatchedZernioEvent = {
      eventId: "u1",
      event: "message.received",
      accountId: "acc-x",
      profileId: null,
      tenantName: null,
      payload: withText("u1", { accountId: "acc-x" }),
    };
    const row = unmatchedLogRow(e);
    expect(row).toMatchObject({
      bot_id: null,
      event_id: "v2-unmatched:u1",
      event_type: "v2_unmatched",
      status: "ignored",
      error_message: "аккаунт не привязан ни к одному клиенту v2",
    });
    expect(row.payload).toEqual({
      event: "message.received",
      accountId: "acc-x",
      profileId: null,
      platform: "instagram",
      account: "kopilka",
      sender: "buyer",
      text: "/start",
    });
    expect(unmatchedLogRow({ ...e, tenantName: "Копилка" }).error_message).toBe(
      "клиент «Копилка» не на v2 (served_by)",
    );
  });

  it("сбой записи следа не ломает приём", async () => {
    const s = setup();
    s.deps.unmatched = async () => {
      throw new Error("db down");
    };
    expect((await intakeZernioEvent(withText("u3", { accountId: "acc-x" }), s.deps)).status).toBe(
      202,
    );
  });
});
