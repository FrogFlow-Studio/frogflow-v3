import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { QueuedNotification, SendOutcome } from "../core/cases/cases";
import { openCase } from "../core/cases/cases";
import { pgliteV4, v4Db } from "../test/pg";
import { NOTIFY_TEXTS, notificationLine, runNotifications, type NotifyDeps } from "./notify";

/**
 * Уведомления v4 на настоящем Postgres: дело открылось → продавцу одно
 * сообщение на его языке со ссылкой на «Сегодня»; повторный прогон не шлёт;
 * «могло дойти» не повторяется; сводка — одним сообщением; некуда слать —
 * «не отправлено»; бюджет кончился — назад в очередь, без отправки.
 */

const A = "aaaaaaaa-0000-4000-8000-0000000000d5";
const B = "bbbbbbbb-0000-4000-8000-0000000000d6";
let pg: PGlite;
const svc = () => pgliteV4(pg);
let k = 0;

type Sent = { botId: string; audience: string; text: string };
function deps(
  opts: { outcome?: SendOutcome; lang?: "ru" | "kk"; noTarget?: boolean } = {},
): NotifyDeps & { sent: Sent[] } {
  const sent: Sent[] = [];
  return {
    sent,
    db: svc(),
    panelUrl: (bot) => `https://frogflow.tech/admin/v4-today?bot=${bot}`,
    resolve: async (n: QueuedNotification) =>
      opts.noTarget
        ? null
        : {
            lang: opts.lang ?? "ru",
            send: async (text) => {
              sent.push({ botId: n.botId, audience: n.audience, text });
              return opts.outcome ?? "sent";
            },
          },
  };
}
const status = async (bot: string) =>
  (
    await pg.query<{ kind: string; status: string }>(
      "select kind, status from v4.notifications where bot_id = $1 order by id",
      [bot],
    )
  ).rows;
async function channelDown(bot: string) {
  const r = await openCase(pgliteV4(pg, { botId: bot }), {
    botId: bot,
    kind: "channel_down",
    dedupeKey: `wa-${++k}`,
    by: "watch",
  });
  if (!r.ok) throw new Error(r.code);
}
async function clear() {
  await pg.query(
    "update v4.notifications set status = 'sent', sent_at = now() where status = 'queued'",
  );
}

beforeAll(async () => {
  pg = await v4Db();
  for (const bot of [A, B])
    await pg.query("insert into v4.shops (bot_id, base_currency) values ($1, 'KZT')", [bot]);
}, 60_000);
afterAll(async () => {
  await pg?.close();
});

describe("уведомления v4", () => {
  it("строки на 4 языках для всех видов дел; неизвестный вид — null", () => {
    for (const lang of ["ru", "kk", "en", "uz"] as const) {
      const n = (kind: string, params = {}): QueuedNotification => ({
        id: 1,
        botId: A,
        audience: "seller",
        kind,
        caseId: null,
        orderId: null,
        params,
      });
      expect(notificationLine(n("case_opened:receipt_review", { order_no: 274 }), lang)).toContain(
        "274",
      );
      expect(notificationLine(n("case_reminder:handoff"), lang)).toContain(
        NOTIFY_TEXTS.reminder[lang],
      );
      expect(notificationLine(n("handoff_returned"), lang)).toBe(NOTIFY_TEXTS.returned[lang]);
      expect(
        notificationLine(n("club_renew_reminder", { ends_at: "2026-12-01T00:00:00Z" }), lang),
      ).toMatch(/2026/);
      expect(notificationLine(n("nonsense"), lang)).toBeNull();
    }
  });

  it("дело открылось → одно сообщение продавцу на его языке со ссылкой; повтор ничего не шлёт", async () => {
    await clear();
    const before = (await status(A)).length;
    await channelDown(A);
    const d = deps({ lang: "kk" });
    const r = await runNotifications(d, "now");
    expect(r.sent).toBe(1);
    expect(d.sent).toHaveLength(1);
    expect(d.sent[0]!.text).toContain("Арна үнсіз");
    expect(d.sent[0]!.text).toContain(`v4-today?bot=${A}`);
    expect((await status(A)).slice(before)).toEqual([
      { kind: "case_opened:channel_down", status: "sent" },
    ]);
    const again = deps();
    await runNotifications(again, "now");
    expect(again.sent).toEqual([]);
  });

  it("«могло дойти» — отмечено «неизвестно», второй раз не шлём", async () => {
    await clear();
    await channelDown(A);
    const d = deps({ outcome: "unknown" });
    expect((await runNotifications(d, "now")).unknown).toBe(1);
    const again = deps();
    await runNotifications(again, "now");
    expect(again.sent).toEqual([]);
    expect((await status(A)).at(-1)!.status).toBe("unknown");
  });

  it("отправка бросила исключение — «неизвестно», не повторяем", async () => {
    await clear();
    await channelDown(B);
    const d = deps();
    d.resolve = async () => ({
      lang: "ru",
      send: async () => {
        throw new Error("ETIMEDOUT");
      },
    });
    expect((await runNotifications(d, "now")).unknown).toBe(1);
    expect((await status(B)).at(-1)!.status).toBe("unknown");
  });

  it("некуда слать (чат продавца не подключён) — «не отправлено»", async () => {
    await clear();
    await channelDown(A);
    expect((await runNotifications(deps({ noTarget: true }), "now")).failed).toBe(1);
    expect((await status(A)).at(-1)!.status).toBe("failed");
  });

  it("сводка: несколько уведомлений магазина — одно сообщение списком", async () => {
    await clear();
    for (const i of [1, 2, 3])
      await pg.query("select v4.notify($1, 'seller', 'digest', 'handoff_returned', $2)", [
        A,
        `dg-${i}`,
      ]);
    await pg.query("select v4.notify($1, 'seller', 'digest', 'handoff_returned', 'dg-b')", [B]);
    const d = deps();
    const r = await runNotifications(d, "digest");
    expect(r.sent).toBe(4);
    expect(d.sent.map((s) => s.botId).sort()).toEqual([A, B].sort());
    const toA = d.sent.find((s) => s.botId === A)!.text;
    expect(toA.split("\n").filter((l) => l.startsWith("• "))).toHaveLength(3);
    expect(toA).toContain("Сводка за ночь");
  });

  it("бюджет кончился — не отправленное возвращается в очередь и уходит в следующий раз", async () => {
    await clear();
    await channelDown(A);
    await channelDown(B);
    let t = 0;
    const d = deps();
    d.budgetMs = 30_000;
    d.perSendMs = 10_000;
    d.now = () => t;
    const send = d.resolve;
    d.resolve = async (n) => {
      t += 25_000;
      return send(n);
    };
    const r = await runNotifications(d, "now");
    expect(r).toMatchObject({ sent: 1, released: 1 });
    const later = deps();
    expect((await runNotifications(later, "now")).sent).toBe(1);
    expect(later.sent).toHaveLength(1);
  });

  it("арендатору рассылка недоступна", async () => {
    await expect(
      pgliteV4(pg, { botId: A }).call("release_notification", { p_id: 1 }),
    ).rejects.toThrow(/permission/);
  });
});
