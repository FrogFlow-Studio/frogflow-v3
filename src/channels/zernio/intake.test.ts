import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";
import { findZernioTenant } from "@/core/tenant/directory";
import { intakeZernioEvent, type IntakeDeps } from "./intake.server";
import { claimZernioEvent, retryStuckEvents, type DispatchOutcome } from "./dispatch.server";
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
  const deps: IntakeDeps = {
    resolve: async (a, p) => findZernioTenant(directory, a, p),
    tenantContext: (t) => ({ tenant: t, db }) as unknown as TenantContext,
    background: async (task) => {
      queued.push(task);
    },
    claim: (ctx, id) => claimZernioEvent(ctx, id),
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
    resync: async (t) => {
      resynced.push(t.id);
      return tenant(t.id, { profile_id: "prof-1", account_ids: ["acc-old", "acc-new"] });
    },
  };
  const row = (id: string) => db.tables.zernio_logs!.find((r) => r.event_id === id);
  const drain = async () => {
    while (queued.length) await queued.shift()!();
  };
  return { db, deps, queued, dispatched, resynced, row, drain };
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
