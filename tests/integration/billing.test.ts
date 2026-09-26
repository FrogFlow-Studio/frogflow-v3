import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveReady, DEMO_BOT, TEST_TG_ID } from "./live";
import { serviceDb } from "@/core/db/client.server";
import { requireTenant, tenantContext, type TenantContext } from "@/core/tenant/resolve.server";
import { attachInvoiceProof, openInvoiceForOwner } from "@/core/billing/invoices";
import {
  cancelInvoice,
  confirmInvoice,
  createInvoice,
  getPayoutRequisites,
  listInvoices,
  listPayments,
  rejectInvoice,
  setPayoutRequisites,
  settleInvoiceProof,
  subscriptionExpiresAt,
} from "@/app/operator/billing.server";

/**
 * Счёт оператора владельцу против настоящей базы: выставление, чек от
 * владельца под ключом арендатора (колоночный UPDATE по RLS), подтверждение
 * с платежом и пересчётом срока триггером, отказ и отмена. Без доставки в
 * Telegram — счёт заводится с deliver: false.
 */
const OWNER = TEST_TG_ID + 80;
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
let ctx: TenantContext;
let prevRequisites = "";
let prevExpires: string | null = null;
const invoiceIds: string[] = [];

async function cleanup() {
  const db = serviceDb();
  for (const id of invoiceIds) {
    const { data: files } = await db.storage
      .from("payment-proofs")
      .list(`${DEMO_BOT}/invoice-${id}`);
    if (files?.length)
      await db.storage
        .from("payment-proofs")
        .remove(files.map((f) => `${DEMO_BOT}/invoice-${id}/${f.name}`));
  }
  await db
    .from("subscription_payments")
    .delete()
    .eq("bot_id", DEMO_BOT)
    .like("note", "Счёт: v2 billing%");
  await db
    .from("subscription_invoices")
    .delete()
    .eq("bot_id", DEMO_BOT)
    .like("note", "v2 billing%");
  await db.from("bot_events").delete().eq("bot_id", DEMO_BOT).eq("actor", "v2-billing-test");
  if (invoiceIds.length)
    await db
      .from("bot_events")
      .delete()
      .eq("bot_id", DEMO_BOT)
      .in("payload->>invoice_id", invoiceIds);
}

describe.skipIf(!liveReady)("счета оператора владельцу", () => {
  beforeAll(async () => {
    const tenant = await requireTenant({ by: "id", value: DEMO_BOT });
    ctx = tenantContext({ ...tenant, ownerTelegramId: OWNER });
    prevRequisites = await getPayoutRequisites();
    prevExpires = await subscriptionExpiresAt(DEMO_BOT);
    await cleanup();
    await setPayoutRequisites("Kaspi Gold 4400 0000 0000 0000 · ИП Проба");
  });
  afterAll(async () => {
    await cleanup();
    await setPayoutRequisites(prevRequisites);
    await serviceDb()
      .from("bots")
      .update({ subscription_expires_at: prevExpires })
      .eq("id", DEMO_BOT);
  });

  it("счёт выставляется со снимком реквизитов; чужой отправитель открытого счёта не видит", async () => {
    const r = await createInvoice(
      DEMO_BOT,
      { amount: 15000, currency: "KZT", note: "v2 billing · сентябрь" },
      "v2-billing-test",
      { deliver: false },
    );
    invoiceIds.push(r.invoice.id);
    expect(r.invoice.status).toBe("sent");
    expect(r.invoice.requisites_snapshot).toContain("ИП Проба");
    await setPayoutRequisites("другие реквизиты");
    expect(
      (await listInvoices(DEMO_BOT)).find((i) => i.id === r.invoice.id)?.requisites_snapshot,
    ).toContain("ИП Проба");
    expect(await openInvoiceForOwner(ctx, OWNER + 1)).toBeNull();
    expect((await openInvoiceForOwner(ctx, OWNER))?.id).toBe(r.invoice.id);
  });

  it("чек владельца переводит счёт в «чек прислан» под ключом арендатора; повторный чек — уже обработан", async () => {
    const open = (await openInvoiceForOwner(ctx, OWNER))!;
    const r = await attachInvoiceProof(ctx, open, { bytes: PNG, mime: "image/png", ext: "png" });
    expect(r.ok).toBe(true);
    const inv = (await listInvoices(DEMO_BOT)).find((i) => i.id === open.id)!;
    expect(inv.status).toBe("proof_uploaded");
    expect(inv.has_proof).toBe(true);
    expect(await openInvoiceForOwner(ctx, OWNER)).toBeNull();
    const again = await attachInvoiceProof(ctx, open, {
      bytes: PNG,
      mime: "image/png",
      ext: "png",
    });
    expect(again.ok).toBe(false);
  });

  it("подтверждение записывает платёж, триггер сдвигает срок подписки; повторно — нельзя", async () => {
    const id = invoiceIds[0]!;
    const start = "2030-01-01";
    const end = "2030-01-31";
    const r = await confirmInvoice(id, { start, end }, "v2-billing-test");
    expect(r.expiresAt?.slice(0, 10)).toBe(end);
    const payments = await listPayments(DEMO_BOT);
    const p = payments.find((x) => x.note?.startsWith("Счёт: v2 billing"));
    expect(p?.amount).toBe(15000);
    expect((await listInvoices(DEMO_BOT)).find((i) => i.id === id)?.status).toBe("paid");
    await expect(confirmInvoice(id, { start, end }, "v2-billing-test")).rejects.toThrow(/уже/);
  });

  it("отказ с причиной и отмена только без чека", async () => {
    const a = await createInvoice(
      DEMO_BOT,
      { amount: 100, currency: "KZT", note: "v2 billing · отказ" },
      "v2-billing-test",
      { deliver: false },
    );
    invoiceIds.push(a.invoice.id);
    await rejectInvoice(a.invoice.id, "не та сумма", "v2-billing-test");
    const rej = (await listInvoices(DEMO_BOT)).find((i) => i.id === a.invoice.id)!;
    expect(rej.status).toBe("rejected");
    expect(rej.reject_reason).toBe("не та сумма");
    const b = await createInvoice(
      DEMO_BOT,
      { amount: 200, currency: "KZT", note: "v2 billing · отмена" },
      "v2-billing-test",
      { deliver: false },
    );
    invoiceIds.push(b.invoice.id);
    await cancelInvoice(b.invoice.id, "v2-billing-test");
    expect((await listInvoices(DEMO_BOT)).find((i) => i.id === b.invoice.id)?.status).toBe(
      "cancelled",
    );
    await expect(cancelInvoice(b.invoice.id, "v2-billing-test")).rejects.toThrow();
  });

  it("один чек по двум счетам разом: подписка продлевается не больше одного раза, номер операции сверяется без приставки", async () => {
    const op = String(Date.now()).slice(-10);
    const mk = async (note: string) => {
      const r = await createInvoice(
        DEMO_BOT,
        { amount: 300, currency: "KZT", note },
        "v2-billing-test",
        { deliver: false },
      );
      invoiceIds.push(r.invoice.id);
      return r.invoice.id;
    };
    const a = await mk("v2 billing · повтор A");
    const b = await mk("v2 billing · повтор B");
    const hash = `v2-billing-test-${op}`;
    const [ra, rb] = await Promise.all([
      settleInvoiceProof(DEMO_BOT, a, { ok: true, hash, operationId: `QR${op}` }),
      settleInvoiceProof(DEMO_BOT, b, { ok: true, hash: `${hash}-other`, operationId: op }),
    ]);
    // Засчитан не больше одного; если чеки легли совсем разом, оба уходят оператору.
    expect([ra.confirmed, rb.confirmed].filter(Boolean).length).toBeLessThanOrEqual(1);
    const paid = (await listInvoices(DEMO_BOT)).filter(
      (i) => (i.id === a || i.id === b) && i.status === "paid",
    );
    expect(paid.length).toBeLessThanOrEqual(1);
    // Тот же чек третий раз, позже — тоже не проходит.
    const c = await mk("v2 billing · повтор C");
    const rc = await settleInvoiceProof(DEMO_BOT, c, {
      ok: true,
      hash: `${hash}-third`,
      operationId: `QR ${op}`,
    });
    expect(rc).toMatchObject({ confirmed: false, detail: expect.stringContaining("уже") });
  });
});
