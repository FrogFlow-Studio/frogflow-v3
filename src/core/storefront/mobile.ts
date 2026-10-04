/**
 * Липкая корзина витрины на телефоне: показывается, пока в корзине есть
 * товар, и прячется там, где корзина уже перед глазами или идёт оформление.
 */
export function showMobileCartBar(pathname: string, slug: string, count: number): boolean {
  if (count <= 0) return false;
  const base = `/s/${slug}`;
  const rest = pathname.startsWith(base) ? pathname.slice(base.length).replace(/\/+$/, "") : "";
  return !(rest === "/cart" || rest === "/checkout" || rest.startsWith("/checkout/"));
}
