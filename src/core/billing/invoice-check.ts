import {
  amountsForCurrency,
  analyzeReceiptText,
  looksLikeCompletedPayment,
} from "@/core/receipts/pure";

/**
 * Автопроверка чека за подписку: владелец платит переводом на Kaspi по
 * счёту оператора и присылает чек в своего бота — как покупатель по заказу.
 * API Kaspi у платформы нет, поэтому проверяем текст чека. Правила строже,
 * чем у покупателей: это деньги платформы, и ошибка здесь продлевает
 * подписку даром. Любое сомнение — не отказ, а ручная проверка оператором.
 *
 * 1. Текст похож на чек банка и платёж не отклонён — те же правила, что у
 *    заказов, и сверх того банк прямо пишет, что платёж проведён: скрин
 *    самого счёта со словом «оплата» чеком не считается.
 * 2. Сумма счёта есть в чеке точно, без допуска ±30%, как у заказов.
 * 3. Получатель, как оператор его записал («Яков В.»), есть в тексте. Не
 *    задан — автоматически не принимаем: иначе подписку продлил бы перевод
 *    на ту же сумму кому угодно.
 * 4. Если в чеке есть даты, хотя бы одна не раньше дня выставления счёта:
 *    старый чек за другую оплату не подходит.
 * 5. В чеке есть номер операции (квитанции) — по нему ловится повтор: новый
 *    скриншот того же чека даёт другой файл, но тот же номер.
 */
export type InvoiceReceiptVerdict =
  { ok: true; operationId: string } | { ok: false; detail: string; operationId: string | null };

/**
 * Номер операции из чека: «№ квитанции 1234567», «Квитанция № QR1234567»,
 * «Номер операции: 123-456», «ID операции 98765». Цифр не меньше шести,
 * чтобы не принять за номер сумму или время.
 */
export function receiptOperationId(text: string): string | null {
  const t = text.replace(/\u00a0/g, " ");
  const m = t.match(
    /(?:№\s*квитанции|квитанци[яи]\s*№?|номер\s+(?:операции|квитанции|чека|транзакции)|id\s+(?:операции|транзакции)|чек\s*№)\s*[:#№]?\s*([A-Za-zА-Яа-я]{0,4}[ \t]?\d[\d \t-]{4,30}\d)/i,
  );
  if (!m) return null;
  const id = m[1]!.replace(/[ \t-]/g, "").toUpperCase();
  return (id.match(/\d/g) ?? []).length >= 6 ? id : null;
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();

/** Даты чека: 26.09.2026, 26/09/2026, 2026-09-26 → ISO-день. */
export function receiptDates(text: string): string[] {
  const out = new Set<string>();
  const ok = (y: number, m: number, d: number) =>
    y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;
  const iso = (y: number, m: number, d: number) =>
    `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  for (const m of text.matchAll(/\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/g)) {
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (ok(y, mo, d)) out.add(iso(y, mo, d));
  }
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (ok(y, mo, d)) out.add(iso(y, mo, d));
  }
  return [...out].sort();
}

export function checkInvoiceReceipt(
  text: string,
  invoice: {
    amount: number;
    currency: string;
    /** Когда выставлен счёт (ISO). */
    createdAt: string;
    /** Как получатель выглядит в чеке; пусто — чек идёт оператору. */
    recipient?: string | null;
  },
): InvoiceReceiptVerdict {
  const operationId = receiptOperationId(text);
  const no = (detail: string): InvoiceReceiptVerdict => ({ ok: false, detail, operationId });
  const base = analyzeReceiptText(text, invoice.amount, invoice.currency);
  if (!base.ok) return no(base.detail);
  if (!looksLikeCompletedPayment(text)) return no("В чеке нет слов банка о проведённом платеже.");
  const exact = amountsForCurrency(text, invoice.currency.toUpperCase()).some(
    (a) => Math.abs(a - invoice.amount) < 1,
  );
  if (!exact)
    return no(
      `В чеке нет суммы счёта ${invoice.amount} ${invoice.currency} точно — нужна ручная проверка.`,
    );
  const recipient = invoice.recipient?.trim();
  if (!recipient)
    return no("Получатель платежей не указан в настройках оператора — чек проверяет оператор.");
  if (!norm(text).includes(norm(recipient)))
    return no(`В чеке не найден получатель «${recipient}».`);
  const dates = receiptDates(text);
  const issued = invoice.createdAt.slice(0, 10);
  if (dates.length && dates[dates.length - 1]! < issued)
    return no(`Чек датирован ${dates[dates.length - 1]}, а счёт выставлен ${issued}.`);
  if (!operationId) return no("В чеке не найден номер операции — чек проверяет оператор.");
  return { ok: true, operationId };
}
