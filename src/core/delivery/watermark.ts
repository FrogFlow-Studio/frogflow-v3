/**
 * Водяной знак на PDF против перепродажи: на каждой странице — кто купил и
 * какой заказ. Стандартные шрифты PDF знают только латиницу, а вшивать
 * кириллический шрифт в каждую функцию дорого, поэтому имя пишется
 * латиницей. Для отпугивания этого хватает: покупатель узнаёт себя, а
 * перепродавца можно найти по номеру заказа.
 */

const MAP: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "kh",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "shch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
  // казахский
  ә: "a",
  ғ: "gh",
  қ: "q",
  ң: "ng",
  ө: "o",
  ұ: "u",
  ү: "u",
  һ: "h",
  і: "i",
  // узбекская латиница с апострофами — к простым буквам
  ʻ: "'",
  "‘": "'",
  "’": "'",
};

/** Латиница для стандартного шрифта PDF: кириллица по таблице, прочие знаки вне ASCII выпадают. */
export function toPdfLatin(s: string): string {
  let out = "";
  for (const ch of s.normalize("NFC")) {
    const lower = ch.toLowerCase();
    const m = MAP[lower];
    if (m !== undefined) {
      out += ch !== lower && m ? m[0]!.toUpperCase() + m.slice(1) : m;
    } else if (/^[\x20-\x7e]$/.test(ch)) out += ch;
  }
  return out.replace(/\s+/g, " ").trim();
}

export type WatermarkBuyer = {
  display_name?: string | null;
  username?: string | null;
  customer_email?: string | null;
  telegram_id?: number | null;
};

/** Строка знака: имя, @логин или почта, номер заказа. Пустых частей нет. */
export function watermarkLine(buyer: WatermarkBuyer, orderNo: number): string {
  const name = toPdfLatin(buyer.display_name ?? "").slice(0, 60);
  const handle = buyer.username
    ? `@${toPdfLatin(buyer.username).replace(/^@+/, "").slice(0, 40)}`
    : toPdfLatin(buyer.customer_email ?? "").slice(0, 60);
  const id = !handle && buyer.telegram_id && buyer.telegram_id > 0 ? `ID ${buyer.telegram_id}` : "";
  return [name, handle || id, `#${orderNo}`].filter(Boolean).join(" · ");
}

/** Файл, который метим: только PDF (по имени или ключу). */
export function isPdfMaterial(m: { path: string | null; name: string | null }): boolean {
  return /\.pdf$/i.test(m.name ?? "") || /\.pdf$/i.test(m.path ?? "");
}
