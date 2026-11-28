/**
 * Главная кнопка Telegram внизу Mini App. Вне Telegram её нет.
 * На карточке с живой ценой — «Купить», на обычной карточке — «В корзину»,
 * в корзине с товарами — «Оформить».
 */

export type MainAction = "buy" | "add" | "checkout";

export function telegramMainButton(input: {
  inTelegram: boolean;
  pathname: string;
  slug: string;
  cartCount: number;
  /** На карточке есть живое предложение: кнопка забирает его, а не кладёт в корзину. */
  offerOpen: boolean;
  canAdd: boolean;
  labels: { buy: string; add: string; checkout: string };
}): { visible: boolean; text: string; action: MainAction | null } {
  if (!input.inTelegram) return { visible: false, text: "", action: null };
  const rest = input.pathname.replace(/\/+$/, "").slice(`/s/${input.slug}`.length);
  if (rest.startsWith("/p/")) {
    if (input.offerOpen) return { visible: true, text: input.labels.buy, action: "buy" };
    if (input.canAdd) return { visible: true, text: input.labels.add, action: "add" };
    return { visible: false, text: "", action: null };
  }
  if (rest === "/cart" && input.cartCount > 0) {
    return { visible: true, text: input.labels.checkout, action: "checkout" };
  }
  return { visible: false, text: "", action: null };
}
