import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { settingsFromJson } from "@/core/tenant/directory";
import { SUPPORTED_LOCALES } from "@/core/i18n/locale";
import { TASKS_KEY, type ConsultantTask } from "./tasks";
import {
  dueForReminder,
  MORNING_SENT_KEY,
  renderMorningList,
  renderReminder,
  sendMorningTaskList,
  sendTaskReminders,
  TASK_REMINDERS_KEY,
  type NotifySeller,
} from "./task-reminders";

/**
 * Напоминания продавцу о задачах консультанта: через 2 ч — одно на задачу,
 * в 9:00 — список открытых; отметка до отправки, из двух кронов шлёт один.
 */
function ctxOf(tasks: ConsultantTask[], extra: Record<string, string> = {}) {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  const bot_id = "10000000-0000-0000-0000-000000000001";
  db.tables.app_settings = [
    {
      bot_id,
      key: TASKS_KEY,
      value: JSON.stringify(tasks),
      updated_at: "2026-10-10T00:00:00.000Z",
    },
    ...Object.entries(extra).map(([key, value]) => ({
      bot_id,
      key,
      value,
      updated_at: "2026-10-10T00:00:00.000Z",
    })),
  ];
  const ctx = {
    tenant: {
      id: bot_id,
      name: "BOVI",
      settings: settingsFromJson({ consultant_pricelist: { enabled: true } }),
      modules: {},
      vertical: "consultant",
    },
    db,
    appUrl: "https://app.test",
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  return { ctx, db };
}

const stored = (db: ReturnType<typeof fakeDb>) =>
  JSON.parse(
    String(db.tables.app_settings!.find((r) => r.key === TASKS_KEY)?.value ?? "[]"),
  ) as ConsultantTask[];

const task = (id: string, at: string, o: Partial<ConsultantTask> = {}): ConsultantTask => ({
  id,
  at,
  userKey: `ig:${id}`,
  reason: "wholesale",
  text: `Опт от 50 штук <${id}>`,
  done: false,
  name: `Покупатель ${id}`,
  link: `https://ig.me/m/${id}`,
  ...o,
});

function recorder() {
  const sent: Array<{ html: string; kind: string }> = [];
  const notify: NotifySeller = async (_ctx, html, kind) => {
    sent.push({ html, kind });
    return 1;
  };
  return { sent, notify };
}

// 12:00 в Алматы (UTC+5), рабочие часы консультанта по умолчанию 10–21.
const NOON = new Date("2026-10-10T07:00:00Z");

describe("напоминание через 2 часа", () => {
  it("открытая задача 2 ч — одно сообщение со ссылкой на диалог; свежая и сделанная — нет", async () => {
    const { ctx, db } = ctxOf([
      task("old", "2026-10-10T04:30:00.000Z"),
      task("fresh", "2026-10-10T06:00:00.000Z"),
      task("closed", "2026-10-10T03:00:00.000Z", { done: true }),
    ]);
    const { sent, notify } = recorder();
    expect(await sendTaskReminders(ctx, "ru", notify, NOON)).toEqual({ sent: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.kind).toBe("question");
    expect(sent[0]!.html).toContain("Покупатель old");
    expect(sent[0]!.html).toContain("Опт, ждёт 2 ч");
    expect(sent[0]!.html).toContain('href="https://ig.me/m/old"');
    expect(sent[0]!.html).toContain("&lt;old&gt;");
    expect(sent[0]!.html).toContain('href="https://app.test/admin/pricelist"');
    expect(sent[0]!.html).not.toContain("fresh");
    const byId = new Map(stored(db).map((t) => [t.id, t]));
    expect(byId.get("old")!.remindedAt).toBe(NOON.toISOString());
    expect(byId.get("fresh")!.remindedAt).toBeUndefined();

    // Следующий проход крона: о той же задаче второй раз не пишем.
    expect(await sendTaskReminders(ctx, "ru", notify, new Date(NOON.getTime() + 900_000))).toEqual({
      sent: 0,
    });
    expect(sent).toHaveLength(1);
  });

  it("два крона одновременно — одно напоминание", async () => {
    const { ctx } = ctxOf([task("a", "2026-10-10T04:00:00.000Z")]);
    const { sent, notify } = recorder();
    const res = await Promise.all([
      sendTaskReminders(ctx, "ru", notify, NOON),
      sendTaskReminders(ctx, "ru", notify, NOON),
    ]);
    expect(res.map((r) => r.sent).sort()).toEqual([0, 1]);
    expect(sent).toHaveLength(1);
  });

  it("несколько задач — одним сообщением; старше суток — только в утреннем списке", async () => {
    const { ctx } = ctxOf([
      task("a", "2026-10-10T04:00:00.000Z"),
      task("b", "2026-10-10T03:00:00.000Z"),
      task("ancient", "2026-10-08T03:00:00.000Z"),
    ]);
    const { sent, notify } = recorder();
    expect(await sendTaskReminders(ctx, "ru", notify, NOON)).toEqual({ sent: 2 });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.html).toContain("ждут ответа: 2");
    expect(sent[0]!.html).not.toContain("ancient");
  });

  it("ночью ждёт рабочих часов; выключено продавцом — молчит", async () => {
    const night = new Date("2026-10-09T20:00:00Z"); // 01:00 в Алматы
    const a = ctxOf([task("a", "2026-10-09T17:00:00.000Z")]);
    const r = recorder();
    expect(await sendTaskReminders(a.ctx, "ru", r.notify, night)).toEqual({
      sent: 0,
      skipped: "off_hours",
    });
    expect(stored(a.db)[0]!.remindedAt).toBeUndefined();

    const b = ctxOf([task("a", "2026-10-10T04:00:00.000Z")], { [TASK_REMINDERS_KEY]: "off" });
    expect(await sendTaskReminders(b.ctx, "ru", r.notify, NOON)).toEqual({
      sent: 0,
      skipped: "off",
    });
    expect(r.sent).toHaveLength(0);
  });

  it("dueForReminder: от 2 ч до суток, без отметки, давние первыми", () => {
    const list = [
      task("x", "2026-10-10T04:00:00.000Z"),
      task("y", "2026-10-10T03:00:00.000Z"),
      task("z", "2026-10-10T03:30:00.000Z", { remindedAt: "2026-10-10T05:30:00.000Z" }),
      task("w", "2026-10-10T05:30:00.000Z"),
    ];
    expect(dueForReminder(list, NOON).map((t) => t.id)).toEqual(["y", "x"]);
  });
});

describe("утренний список", () => {
  const MORNING = new Date("2026-10-10T04:05:00Z"); // 09:05 в Алматы

  it("до 9:00 не шлёт; после — все открытые один раз, и днём о них не напоминает", async () => {
    const { ctx, db } = ctxOf([
      task("a", "2026-10-09T08:00:00.000Z"),
      task("b", "2026-10-07T08:00:00.000Z"),
      task("c", "2026-10-09T09:00:00.000Z", { done: true }),
    ]);
    const { sent, notify } = recorder();
    expect(await sendMorningTaskList(ctx, "ru", notify, new Date("2026-10-10T03:55:00Z"))).toEqual({
      sent: 0,
      skipped: "early",
    });

    expect(await sendMorningTaskList(ctx, "ru", notify, MORNING)).toEqual({ sent: 2 });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.kind).toBe("digest");
    expect(sent[0]!.html).toContain("Не разобрано задач консультанта: 2");
    // Давние первыми.
    expect(sent[0]!.html.indexOf("Покупатель b")).toBeLessThan(
      sent[0]!.html.indexOf("Покупатель a"),
    );
    expect(sent[0]!.html).toContain("ждёт 2 дн");
    expect(db.tables.app_settings!.find((r) => r.key === MORNING_SENT_KEY)?.value).toBe(
      "2026-10-10",
    );

    expect(await sendMorningTaskList(ctx, "ru", notify, NOON)).toEqual({
      sent: 0,
      skipped: "already",
    });
    // Задача «a» открыта 23 ч — без утреннего списка напомнили бы в полдень.
    expect(await sendTaskReminders(ctx, "ru", notify, NOON)).toEqual({ sent: 0 });
    expect(sent).toHaveLength(1);
  });

  it("два крона в 9:00 — один список", async () => {
    const { ctx } = ctxOf([task("a", "2026-10-09T08:00:00.000Z")]);
    const { sent, notify } = recorder();
    await Promise.all([
      sendMorningTaskList(ctx, "ru", notify, MORNING),
      sendMorningTaskList(ctx, "ru", notify, MORNING),
    ]);
    expect(sent).toHaveLength(1);
  });

  it("открытых нет — день отмечен, сообщения нет", async () => {
    const { ctx, db } = ctxOf([task("c", "2026-10-09T09:00:00.000Z", { done: true })]);
    const { sent, notify } = recorder();
    expect(await sendMorningTaskList(ctx, "ru", notify, MORNING)).toEqual({
      sent: 0,
      skipped: "empty",
    });
    expect(sent).toHaveLength(0);
    expect(db.tables.app_settings!.find((r) => r.key === MORNING_SENT_KEY)?.value).toBe(
      "2026-10-10",
    );
  });

  it("сбой чтения списка — ошибка, день не отмечен", async () => {
    const { ctx, db } = ctxOf([task("a", "2026-10-09T08:00:00.000Z")]);
    // Чтение списка задач отказало (остальные ключи читаются как обычно).
    const failing = <T extends object>(q: T): T =>
      new Proxy(q, {
        get(target, prop, recv) {
          const v = Reflect.get(target, prop, recv) as unknown;
          if (typeof v !== "function") return v;
          return (...args: unknown[]) => {
            if (prop === "eq" && args[0] === "key" && args[1] === TASKS_KEY)
              return { maybeSingle: async () => ({ data: null, error: { message: "boom" } }) };
            const r = (v as (...a: unknown[]) => unknown).apply(target, args);
            return r && typeof r === "object" && !("then" in r && prop === "maybeSingle")
              ? failing(r)
              : r;
          };
        },
      });
    const broken = {
      ...ctx,
      db: { from: (t: string) => failing(ctx.db.from(t as "app_settings")) },
    } as unknown as TenantContext;
    const { sent, notify } = recorder();
    await expect(sendMorningTaskList(broken, "ru", notify, MORNING)).rejects.toThrow();
    expect(sent).toHaveLength(0);
    expect(db.tables.app_settings!.find((r) => r.key === MORNING_SENT_KEY)).toBeUndefined();
  });

  it("длинный список — 15 строк и число остальных", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      task(`t${String(i).padStart(2, "0")}`, new Date(Date.UTC(2026, 9, 9, i)).toISOString()),
    );
    const html = renderMorningList("ru", many, NOON, "https://app.test");
    expect(html).toContain("Не разобрано задач консультанта: 20");
    expect(html.match(/^• /gm)).toHaveLength(15);
    expect(html).toContain("…и ещё 5");
    expect(html.length).toBeLessThan(4096);
  });
});

describe("тексты", () => {
  it("на четырёх языках, без пустых строк", () => {
    const t = [task("a", "2026-10-10T04:00:00.000Z", { reason: "purchase" })];
    const seen = new Set<string>();
    for (const l of SUPPORTED_LOCALES) {
      const r = renderReminder(l, t, NOON, "https://app.test");
      const m = renderMorningList(l, t, NOON, "https://app.test");
      expect(r).not.toMatch(/undefined/);
      expect(m).not.toMatch(/undefined/);
      seen.add(r);
    }
    expect(seen.size).toBe(SUPPORTED_LOCALES.length);
  });
});
