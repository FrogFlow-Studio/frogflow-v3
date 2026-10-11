/**
 * «Оплатила», «перевела 1400 на каспи» на шаге оплаты — сообщение об оплате:
 * ответ «пришлите чек» по делу. Вопрос («сколько вместе?», «точно придёт?»)
 * и отрицание («я ещё не отправила деньги») — нет: это продавцу (AATeach 11.10).
 */
const PAID_REPORT =
  /((^|[^\p{L}])(о|за|пере|до)?плати(л|ла|ли)(?!\p{L})|перев(ё|е)л(а|и)?(?!\p{L})|перечислил\p{L}*|скинул[аи]?\s*(деньги|оплату|сумму)|отправил[аи]?\s*(деньги|оплату|перевод|сумму)|төледім|төледік|to['‘’]?ladim|\b(i\s*)?(have\s*)?paid\b|sent\s*the\s*(money|payment))/iu;
const PAID_DENIED =
  /(^|[^\p{L}])не\s*(ещё\s*|еще\s*|пока\s*)?(о|за|пере|до)?(плати|перев|перечисл|скинул|отправил)|not\s*(yet\s*)?paid|haven['’]?t\s*paid/iu;

export function isPaidReport(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 160 || t.includes("?")) return false;
  return PAID_REPORT.test(t) && !PAID_DENIED.test(t);
}
