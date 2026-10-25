const ORDER_STATUS_QUESTION = new RegExp(
  [
    String.raw`(?:заказ|покупк)\p{L}*[^.!?\n]{0,60}(?:статус|отмен[её]н\p{L}*|отменили|оплачен\p{L}*|выдан\p{L}*|доставлен\p{L}*|получен\p{L}*|готов\p{L}*|где|что\s+с)`,
    String.raw`(?:где|что\s+(?:с|по)|проверь\p{L}*)[^.!?\n]{0,60}(?:заказ|покупк)\p{L}*`,
    String.raw`(?:отменили|отменил|оплатили|оплатил|выдали|выдал|получили|получил|canceled|cancelled)[^.!?\n]{0,60}(?:заказ|покупк)\p{L}*`,
    String.raw`(?:тапсырыс|buyurtma)\p{L}*[^.!?\n]{0,60}(?:мәртеб\p{L}*|күші\s+жой\p{L}*|жойыл\p{L}*|төлен\p{L}*|қайда|holat\p{L}*|bekor\p{L}*|to['‘’]?lov\p{L}*|yetkaz\p{L}*|qayerda|qabul\p{L}*)`,
    String.raw`(?:қайда|qayerda|проверь\p{L}*)[^.!?\n]{0,60}(?:заказ|тапсырыс|buyurtma)\p{L}*`,
    String.raw`(?:status|статус\p{L}*|мәртеб\p{L}*|күй\p{L}*|holat\p{L}*|bekor\p{L}*|cancelled|canceled|paid|delivered)[^.!?\n]{0,60}(?:заказ|покупк|order|тапсырыс|buyurtma)\p{L}*`,
    String.raw`(?:order|buyurtma|тапсырыс)\p{L}*[^.!?\n]{0,60}(?:status|cancelled|canceled|paid|delivered)`,
    String.raw`where\s+(?:is\s+)?(?:my\s+)?order`,
  ]
    .map((part) => `(?:${part})`)
    .join("|"),
  "iu",
);

/** True only for a request to verify an order, never for a command to cancel it. */
export function isOrderStatusQuestion(text: string): boolean {
  return ORDER_STATUS_QUESTION.test(text);
}
