import type { TenantContext } from "@/core/tenant/resolve.server";
import { UserError } from "@/core/i18n/user-error";
import { loadCost, unitCost } from "@/core/profit/cost";
import { updateSettingStamped } from "@/core/settings/settings";
import { serverFailure } from "@/lib/server-failure";
import { createReceipt, deleteReceipt, loadReceipt, type Receipt } from "./receipts";
import { loadRequest, parseRequest, requestKey } from "./requests";

/**
 * Принять заказанное: черновик прихода по заявке (поставщик и позиции с
 * количествами заявки, цена — текущая себестоимость или 0). Продавец поправляет
 * фактическое и проводит приход; проведённый приход закрывает заявку
 * (`closeRequestByReceipt`, вызывается из postReceipt). Черновик по заявке один:
 * его номер ставится в заявку условной записью, второй клик или второй
 * сотрудник получают отказ, а лишний черновик удаляется. Если черновик удалили,
 * по заявке можно создать новый.
 */
export async function receiptFromRequest(
  ctx: TenantContext,
  requestId: string,
  actor: string,
): Promise<Receipt> {
  const req = await loadRequest(ctx, requestId);
  if (!req) throw new UserError("err.stock.requestNotFound", "Заявка не найдена.");
  if (req.status !== "ordered")
    throw new UserError(
      "err.stock.requestNotOrdered",
      "Приход по заявке создаётся после отметки «Заказано».",
    );
  if (req.receiptId && (await loadReceipt(ctx, req.receiptId)))
    throw new UserError(
      "err.stock.requestHasReceipt",
      "По этой заявке уже создан приход — продолжите его.",
    );
  const lines = [];
  for (const l of req.lines) {
    const cost = await loadCost(ctx, l.productId);
    lines.push({ productId: l.productId, qty: l.qty, price: unitCost(cost, null) ?? 0 });
  }
  const receipt = await createReceipt(
    ctx,
    { supplierId: req.supplierId, lines, updateCost: false, requestId: req.id },
    actor,
  );
  const r = await updateSettingStamped(ctx, requestKey(req.id), (raw) => {
    const d = parseRequest(raw);
    if (!d || d.status !== "ordered" || d.receiptId !== req.receiptId) return null;
    return JSON.stringify({ ...d, receiptId: receipt.id });
  });
  if (r !== "written") {
    await deleteReceipt(ctx, receipt.id).catch(() => {});
    if (r === "failed") throw serverFailure("Заявка не сохранилась");
    throw new UserError(
      "err.stock.requestHasReceipt",
      "По этой заявке уже создан приход — продолжите его.",
    );
  }
  return receipt;
}
