/**
 * Корзина из каталога Meta (WhatsApp): покупатель собрал заказ штатной
 * корзиной WhatsApp, минуя бота. Meta присылает `product_retailer_id`
 * каждой позиции — это то, что продавец записал в каталоге Meta. Чтобы бот
 * мог оформить такой заказ сам, retailer id должен совпадать с id товара,
 * его номером («018») или названием; иначе позиция уходит продавцу текстом
 * (в v1 — всегда текстом).
 */
export type NativeItem = { retailerId: string; quantity: number; price: number; currency: string };
export type CatalogProduct = { id: string; name: string; keywords: string | null };

export type NativeMatch = {
  matched: Array<{ productId: string; name: string; quantity: number }>;
  unmatched: NativeItem[];
};

function normalizeNumber(n: string): string {
  return n.replace(/^0+(?=\d)/, "");
}

function numberFromName(name: string | null | undefined): string | null {
  const m = name?.trim().match(/^(\d{1,5})(?:\s*[.)|]|\s+\S)/);
  return m ? normalizeNumber(m[1]!) : null;
}

function numberFromKeywords(keywords: string | null | undefined): string | null {
  const m = keywords?.trim().match(/^(\d{1,5})\s*,/);
  return m ? normalizeNumber(m[1]!) : null;
}

export function matchNativeItems(
  items: readonly NativeItem[],
  products: readonly CatalogProduct[],
): NativeMatch {
  const byId = new Map(products.map((p) => [p.id.toLowerCase(), p]));
  const byName = new Map(products.map((p) => [p.name.trim().toLowerCase(), p]));
  const byNumber = new Map<string, CatalogProduct>();
  for (const p of products) {
    const n = numberFromKeywords(p.keywords) ?? numberFromName(p.name);
    if (n && !byNumber.has(n)) byNumber.set(n, p);
  }
  const out: NativeMatch = { matched: [], unmatched: [] };
  for (const item of items) {
    const key = item.retailerId.trim();
    const lower = key.toLowerCase();
    const numeric = /^[№#]?\s*\d{1,5}$/.test(key)
      ? normalizeNumber(key.replace(/^[№#]\s*/, ""))
      : null;
    const p = byId.get(lower) ?? byName.get(lower) ?? (numeric ? byNumber.get(numeric) : undefined);
    if (p)
      out.matched.push({
        productId: p.id,
        name: p.name,
        quantity: Math.max(1, item.quantity || 1),
      });
    else out.unmatched.push(item);
  }
  return out;
}

/** Текст продавцу о корзине, которую бот не смог оформить сам. */
export function describeNativeCart(
  who: string,
  items: readonly NativeItem[],
  note: string,
): string {
  const lines = items
    .slice(0, 20)
    .map((i) => `• ${i.retailerId} × ${i.quantity} — ${i.price} ${i.currency}`)
    .join("\n");
  const total = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const currency = items[0]?.currency ?? "";
  return (
    `🛒 <b>Заказ из каталога WhatsApp</b>\n\nОт: ${who}\n\n${lines}\n\nИтого: ${total} ${currency}\n` +
    (note ? `Комментарий: ${note.slice(0, 300)}\n\n` : "\n") +
    "Позиции не совпали с товарами в админке (по id, номеру или названию), бот оформить заказ не может. Ответьте покупателю в разделе «Чат»."
  );
}
