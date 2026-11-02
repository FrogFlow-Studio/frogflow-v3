import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cabinetItems } from "../core/access/access";
import type { SendOutcome } from "../core/cases/cases";
import { createOrder, recordPayment } from "../core/money/money";
import { pgliteV4, v4Db } from "../test/pg";
import { deliverHandler, deliveryText, type BuyerSender } from "./deliver";
import { runJobs, type Job } from "./runner";

/**
 * Выдача фоновой задачей на настоящем Postgres: оплата → задача deliver →
 * покупатель получает ссылку в кабинет на своём языке в последний канал.
 * Один раз: повтор, два исполнителя сразу и прерванная попытка не шлют
 * второй раз; «могло дойти» не повторяется, а становится делом продавцу.
 */

const A = "aaaaaaaa-0000-4000-8000-0000000000c9";
let pg: PGlite;
const svc = () => pgliteV4(pg);
const asA = () => pgliteV4(pg, { botId: A });
let product: string;
let n = 0;

type Sent = { channel: string; to: string; text: string };
function sender(outcome: SendOutcome = "sent") {
  const sent: Sent[] = [];
  const send: BuyerSender = async (channel, to, text) => {
    sent.push({ channel, to, text });
    return outcome;
  };
  return { sent, send };
}
const cabinetUrl = (bot: string, token: string) => `https://frogflow.tech/c/${bot}/${token}`;

async function paidBuyer(opts: { lang?: string; channels?: Array<[string, string]> } = {}) {
  const b = (
    await pg.query<{ id: string }>(
      "insert into v4.buyers (bot_id, country, language, name) values ($1, 'KZ', $2, 'Айгерим') returning id",
      [A, opts.lang ?? null],
    )
  ).rows[0]!.id;
  for (const [ch, ext] of opts.channels ?? [["instagram", `ig-${++n}`]])
    await pg.query(
      "insert into v4.buyer_channels (bot_id, channel, external_id, buyer_id) values ($1, $2, $3, $4)",
      [A, ch, ext, b],
    );
  const o = await createOrder(asA(), {
    botId: A,
    buyerId: b,
    country: "KZ",
    productIds: [product],
    by: "bot",
  });
  if (!o.ok) throw new Error(o.code);
  const p = await recordPayment(asA(), {
    botId: A,
    orderId: o.value.id,
    amountMinor: o.value.totalMinor,
    currency: "KZT",
    method: "transfer",
    externalRef: `d-${++n}`,
    by: "t",
  });
  if (!p.ok) throw new Error(p.code);
  const job = (
    await pg.query<{ id: number; payload: { access_id: string } }>(
      `select j.id, j.payload from v4.jobs j join v4.access a on a.id = (j.payload->>'access_id')::uuid
       where j.kind = 'deliver' and a.buyer_id = $1`,
      [b],
    )
  ).rows[0]!;
  return { buyer: b, accessId: job.payload.access_id, jobId: job.id };
}
const asJob = (accessId: string): Job => ({
  id: 0,
  botId: A,
  kind: "deliver",
  payload: { access_id: accessId },
  attempts: 1,
});
const deliveries = async (accessId: string) =>
  (
    await pg.query<{ channel: string; status: string }>(
      "select channel, status from v4.deliveries where access_id = $1",
      [accessId],
    )
  ).rows;
const openCases = async (buyer: string) =>
  (
    await pg.query<{ kind: string; detail: Record<string, unknown> }>(
      "select kind, detail from v4.cases where buyer_id = $1 and status = 'open'",
      [buyer],
    )
  ).rows;
const signal = () => AbortSignal.timeout(5000);

beforeAll(async () => {
  pg = await v4Db();
  await pg.query("insert into v4.shops (bot_id, base_currency) values ($1, 'KZT')", [A]);
  product = (
    await pg.query<{ id: string }>(
      "insert into v4.products (bot_id, title, kind, base_price_minor) values ($1, 'Рабочая тетрадь', 'file', 150000) returning id",
      [A],
    )
  ).rows[0]!.id;
}, 60_000);
afterAll(async () => {
  await pg?.close();
});

describe("выдача задачей deliver", () => {
  it("оплата → ссылка в кабинет на языке покупателя в последний канал; кабинет открывается", async () => {
    const { buyer, accessId } = await paidBuyer({
      lang: "kk",
      channels: [
        ["telegram", "555"],
        ["instagram", "ig-last"],
      ],
    });
    const { sent, send } = sender();
    const r = await runJobs(svc(), { deliver: deliverHandler({ db: svc(), send, cabinetUrl }) });
    expect(r.done).toBeGreaterThanOrEqual(1);
    const mine = sent.filter((s) => s.to === "ig-last");
    expect(mine).toHaveLength(1);
    expect(mine[0]!.channel).toBe("instagram");
    expect(mine[0]!.text).toContain("Сатып алғаныңызға рахмет");
    expect(await deliveries(accessId)).toEqual([{ channel: "instagram", status: "sent" }]);
    const token = /\/c\/[^/]+\/(\S+)/.exec(mine[0]!.text)![1]!;
    expect((await cabinetItems(svc(), A, token)).map((i) => i.title)).toEqual(["Рабочая тетрадь"]);
    expect(await openCases(buyer)).toEqual([]);
    // Задача сделана: второй прогон её не берёт.
    const again = sender();
    await runJobs(svc(), { deliver: deliverHandler({ db: svc(), send: again.send, cabinetUrl }) });
    expect(again.sent.filter((s) => s.to === "ig-last")).toEqual([]);
  });

  it("повтор задачи и два исполнителя сразу — одно сообщение", async () => {
    const { accessId } = await paidBuyer();
    const { sent, send } = sender();
    const h = deliverHandler({ db: svc(), send, cabinetUrl });
    await Promise.all([h(asJob(accessId), signal()), h(asJob(accessId), signal())]);
    await h(asJob(accessId), signal());
    expect(sent).toHaveLength(1);
    expect(await deliveries(accessId)).toHaveLength(1);
  });

  it("«могло дойти» — не повторяем, продавцу дело «материал не дошёл»", async () => {
    const { buyer, accessId } = await paidBuyer();
    const { sent, send } = sender("unknown");
    const h = deliverHandler({ db: svc(), send, cabinetUrl });
    expect(await h(asJob(accessId), signal())).toEqual({ ok: true });
    expect(await h(asJob(accessId), signal())).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    expect(await deliveries(accessId)).toEqual([{ channel: "instagram", status: "unknown" }]);
    expect((await openCases(buyer)).map((c) => c.kind)).toEqual(["delivery_failed"]);
  });

  it("отправка бросила исключение — считаем «неизвестно», не повторяем", async () => {
    const { accessId } = await paidBuyer();
    let calls = 0;
    const h = deliverHandler({
      db: svc(),
      send: async () => {
        calls++;
        throw new Error("socket hang up");
      },
      cabinetUrl,
    });
    await h(asJob(accessId), signal());
    await h(asJob(accessId), signal());
    expect(calls).toBe(1);
    expect(await deliveries(accessId)).toEqual([{ channel: "instagram", status: "unknown" }]);
  });

  it("прерванная попытка: свежая отметка — ждём, старая — «неизвестно», без второй отправки", async () => {
    const { buyer, accessId } = await paidBuyer();
    await pg.query(
      "insert into v4.delivery_claims (bot_id, access_id, channel) values ($1, $2, 'instagram')",
      [A, accessId],
    );
    const { sent, send } = sender();
    const fresh = deliverHandler({ db: svc(), send, cabinetUrl });
    expect(await fresh(asJob(accessId), signal())).toMatchObject({ ok: false, retryInSec: 360 });
    const later = deliverHandler({
      db: svc(),
      send,
      cabinetUrl,
      now: () => Date.now() + 6 * 60_000,
    });
    expect(await later(asJob(accessId), signal())).toEqual({ ok: true });
    expect(sent).toEqual([]);
    expect(await deliveries(accessId)).toEqual([{ channel: "instagram", status: "unknown" }]);
    expect((await openCases(buyer)).map((c) => c.kind)).toEqual(["delivery_failed"]);
  });

  it("писать некуда (только сайт) — дело продавцу, ничего не отправлено", async () => {
    const { buyer, accessId } = await paidBuyer({ channels: [["web", "w-1"]] });
    const { sent, send } = sender();
    expect(
      await deliverHandler({ db: svc(), send, cabinetUrl })(asJob(accessId), signal()),
    ).toEqual({
      ok: true,
    });
    expect(sent).toEqual([]);
    expect(await openCases(buyer)).toEqual([
      { kind: "delivery_failed", detail: expect.objectContaining({ reason: "no_channel" }) },
    ]);
  });

  it("отозванный доступ не выдаётся", async () => {
    const { accessId } = await paidBuyer();
    await pg.query(
      "update v4.access set status = 'revoked', closed_at = now(), close_reason = 'тест' where id = $1",
      [accessId],
    );
    const { sent, send } = sender();
    expect(
      await deliverHandler({ db: svc(), send, cabinetUrl })(asJob(accessId), signal()),
    ).toEqual({
      ok: true,
    });
    expect(sent).toEqual([]);
  });

  it("арендатору выдача недоступна", async () => {
    const { accessId } = await paidBuyer();
    await expect(
      asA().call("claim_delivery", { p_bot_id: A, p_access_id: accessId, p_channel: "instagram" }),
    ).rejects.toThrow(/permission/);
  });

  it("тексты на 4 языках, с датой для клуба", () => {
    const until = new Date("2026-12-01T00:00:00Z");
    for (const l of ["ru", "kk", "en", "uz"] as const) {
      const t = deliveryText(l, "club", { title: "VIP", url: "https://x/c/1", until });
      expect(t).toContain("https://x/c/1");
      expect(t).toMatch(/2026/);
    }
  });
});

describe("исполнитель задач", () => {
  it("берёт только свои виды; упавший обработчик — повтор позже; нет бюджета — задача назад", async () => {
    await pg.query(
      "insert into v4.jobs (bot_id, kind, dedupe_key) values ($1, 'club_invite', 'ci-1'), ($1, 'demo', 'd-1'), ($1, 'demo', 'd-2')",
      [A],
    );
    let t = 0;
    const r = await runJobs(
      svc(),
      {
        demo: async (job) => {
          t += 50_000;
          if (job.payload.x) return { ok: true };
          throw new Error("сломалось");
        },
      },
      { budgetMs: 60_000, perJobMs: 15_000, now: () => t },
    );
    expect(r).toEqual({ done: 0, retried: 2, budgetLeft: false });
    const rows = (
      await pg.query<{ kind: string; status: string; last_error: string | null }>(
        "select kind, status, last_error from v4.jobs where dedupe_key in ('ci-1', 'd-1', 'd-2') order by dedupe_key",
      )
    ).rows;
    expect(rows).toEqual([
      { kind: "club_invite", status: "queued", last_error: null },
      { kind: "demo", status: "queued", last_error: "сломалось" },
      { kind: "demo", status: "queued", last_error: "не успели в бюджет" },
    ]);
  });
});
