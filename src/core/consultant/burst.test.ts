import { afterEach, describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { updateStateSection, type Customer } from "@/core/customers/customers";
import {
  BURST,
  commitTurn,
  isStaleIncoming,
  joinTurn,
  releaseUnanswered,
  type JoinedTurn,
} from "./burst";

/**
 * Один ход консультанта на диалог (BOVI 08.10): гонки на настоящей условной
 * записи состояния (claimStateSection по rev) в базе в памяти.
 */

const DEFAULTS = { ...BURST };
afterEach(() => Object.assign(BURST, DEFAULTS));

function setup(consultant: Record<string, unknown> = {}) {
  BURST.pollMs = 2;
  const db = fakeDb();
  db.tables.bot_users = [
    { id: "u1", user_key: "ig_1", telegram_id: -1, state: { mode: "idle", consultant } },
  ];
  const ctx = { tenant: { id: "b" }, db } as unknown as TenantContext;
  // Снимок покупателя до обработки — устаревший: всё читается из базы.
  const customer = { userKey: "ig_1", state: {} } as unknown as Customer;
  const current = () =>
    (db.tables.bot_users![0]!.state as { consultant: Record<string, unknown> }).consultant;
  return { ctx, customer, current };
}

type Lead = Extract<JoinedTurn, { lead: true }>;
const asLead = (j: JoinedTurn): Lead => {
  if (!j.lead) throw new Error(`ожидался ход, а не ${j.why}`);
  return j;
};
const close = (ctx: TenantContext, t: Lead, reply: string) =>
  commitTurn(ctx, t.customer, { turnId: t.turnId, items: t.items, reply, historyTurns: 16 });

describe("один ход консультанта на диалог", () => {
  it("гонка: три сообщения одновременно — ход один; второе и третье ждут и уходят одним следующим ходом", async () => {
    const { ctx, customer, current } = setup();
    const texts = ["Здравствуйте", "Есть полотенца?", "А белые?"];
    const done: Array<JoinedTurn | undefined> = [];
    const all = texts.map((text, i) =>
      joinTurn(ctx, customer, { id: `m${i + 1}`, text }).then((j) => (done[i] = j)),
    );
    // Пока первый ход думает, остальные только ждут: аренда занята.
    await new Promise((r) => setTimeout(r, 20));
    const settled = done.filter(Boolean);
    expect(settled, "ход взяло одно сообщение").toHaveLength(1);
    const first = asLead(settled[0]!);
    expect(first.items).toHaveLength(1);
    expect(current().turn).toMatchObject({ id: first.turnId });
    expect((current().inbox as Array<{ id: string }>).map((i) => i.id).sort()).toEqual([
      "m1",
      "m2",
      "m3",
    ]);
    await close(ctx, first, "Здравствуйте! Подскажу.");

    // Следующий ход берёт одно из ждущих; третье ждёт, пока этот ход не закроется.
    await new Promise((r) => setTimeout(r, 20));
    const leads = done.filter((j) => j && j !== first);
    expect(leads, "следующий ход — один").toHaveLength(1);
    const second = asLead(leads[0]!);
    const [firstText] = first.items.map((i) => i.text);
    expect(second.items.map((i) => i.text)).toEqual(texts.filter((t) => t !== firstText));
    // Второй ход видит первый ответ в истории.
    expect(second.customer.state.consultant?.recent).toEqual([
      { role: "customer", text: firstText },
      { role: "assistant", text: "Здравствуйте! Подскажу." },
    ]);
    await close(ctx, second, "Да, белые есть.");
    // Третье сообщение ушло во второй ход: отдельного ответа нет.
    const results = await Promise.all(all);
    expect(results.filter((j) => !j.lead)).toEqual([{ lead: false, why: "folded" }]);

    const recent = current().recent as Array<{ role: string; text: string }>;
    expect(recent.map((t) => t.role)).toEqual([
      "customer",
      "assistant",
      "customer",
      "customer",
      "assistant",
    ]);
    // Все три реплики в истории, каждая один раз.
    expect(
      recent
        .filter((t) => t.role === "customer")
        .map((t) => t.text)
        .sort(),
    ).toEqual([...texts].sort());
    expect(current().inbox).toBeUndefined();
    expect(current().turn).toBeUndefined();
  });

  it("функция умерла посреди хода — аренда истекает, ожидающий отвечает и за брошенное", async () => {
    const { ctx, customer, current } = setup();
    BURST.leaseMs = 40;
    const dead = asLead(await joinTurn(ctx, customer, { id: "m1", text: "Есть полотенца?" }));
    const started = Date.now();
    const next = asLead(await joinTurn(ctx, customer, { id: "m2", text: "Алло?" }));
    expect(Date.now() - started, "ждал до конца аренды").toBeGreaterThanOrEqual(30);
    expect(next.turnId).not.toBe(dead.turnId);
    expect(next.items.map((i) => i.id)).toEqual(["m1", "m2"]);
    // Умерший ход проснулся и закрывается: чужую аренду не снимает, своё сообщение не задваивает.
    await close(ctx, dead, "поздний ответ");
    expect(current().turn).toMatchObject({ id: next.turnId });
    expect((current().inbox as Array<{ id: string }>).map((i) => i.id)).toEqual(["m2"]);
  });

  it("брошенная аренда в базе уже просрочена — ход берётся сразу, вместе с брошенным сообщением", async () => {
    const { ctx, customer } = setup({
      turn: { id: "old", until: new Date(Date.now() - 1000).toISOString() },
      inbox: [{ id: "m0", text: "Есть полотенца?", at: new Date().toISOString() }],
    });
    const t = asLead(await joinTurn(ctx, customer, { id: "m1", text: "Ау" }));
    expect(t.items.map((i) => i.text)).toEqual(["Есть полотенца?", "Ау"]);
  });

  it("сообщение с фото соседа ход не берёт: картинки есть только у его функции", async () => {
    const { ctx, customer } = setup({
      inbox: [{ id: "p1", text: "", at: new Date().toISOString(), own: true }],
    });
    const t = asLead(await joinTurn(ctx, customer, { id: "m1", text: "Сколько стоит?" }));
    expect(t.items.map((i) => i.id)).toEqual(["m1"]);
  });

  it("повтор доставки того же сообщения в очередь второй раз не встаёт", async () => {
    const { ctx, customer, current } = setup({
      turn: { id: "busy", until: new Date(Date.now() + 60_000).toISOString() },
    });
    BURST.waitMs = 10;
    await joinTurn(ctx, customer, { id: "m1", text: "Есть полотенца?" });
    await joinTurn(ctx, customer, { id: "m1", text: "Есть полотенца?" });
    expect(current().inbox).toHaveLength(1);
  });

  it("не дождались чужого хода — busy с id сообщения; releaseUnanswered переносит его в историю", async () => {
    const { ctx, customer, current } = setup({
      turn: { id: "busy", until: new Date(Date.now() + 60_000).toISOString() },
    });
    BURST.waitMs = 10;
    expect(await joinTurn(ctx, customer, { id: "m1", text: "Есть полотенца?" })).toEqual({
      lead: false,
      why: "busy",
      ownId: "m1",
    });
    expect((current().inbox as Array<{ id: string }>).map((i) => i.id)).toEqual(["m1"]);
    expect(await releaseUnanswered(ctx, customer, { id: "m1", text: "Есть полотенца?" }, 16)).toBe(
      true,
    );
    expect(current().inbox).toBeUndefined();
    expect(current().recent).toEqual([{ role: "customer", text: "Есть полотенца?" }]);
    // Второй раз (или чужой ход уже забрал сообщение) — ничего не пишет.
    expect(await releaseUnanswered(ctx, customer, { id: "m1", text: "Есть полотенца?" }, 16)).toBe(
      false,
    );
    expect(current().recent).toHaveLength(1);
  });

  it("закрытие хода дописывает к свежей истории: запись соседа за время хода не затирается", async () => {
    const { ctx, customer, current } = setup({
      recent: [{ role: "customer", text: "Здравствуйте" }],
    });
    const t = asLead(await joinTurn(ctx, customer, { id: "m1", text: "Есть полотенца?" }));
    // Пока модель думала, напоминание (consultant-jobs) дописало свою реплику.
    await updateStateSection(ctx, customer, "consultant", (cur) => ({
      ...cur,
      recent: [...(cur.recent as unknown[]), { role: "assistant", text: "Напоминание" }],
    }));
    await commitTurn(ctx, t.customer, {
      turnId: t.turnId,
      items: t.items,
      reply: "Есть.",
      historyTurns: 16,
      patch: (cur) => ({ ...cur, last_reply_at: "2026-10-08T10:00:00Z" }),
    });
    expect(current().recent).toEqual([
      { role: "customer", text: "Здравствуйте" },
      { role: "assistant", text: "Напоминание" },
      { role: "customer", text: "Есть полотенца?" },
      { role: "assistant", text: "Есть." },
    ]);
    expect(current().last_reply_at).toBe("2026-10-08T10:00:00Z");
  });
});

describe("сообщение, доставленное с опозданием", () => {
  const now = Date.parse("2026-10-08T12:00:00Z");
  it("старше 15 минут — устарело; свежее и без времени — нет", () => {
    expect(isStaleIncoming("2026-10-08T11:44:00Z", now)).toBe(true);
    expect(isStaleIncoming("2026-10-08T11:50:00Z", now)).toBe(false);
    expect(isStaleIncoming(null, now)).toBe(false);
    expect(isStaleIncoming("не дата", now)).toBe(false);
  });
});
