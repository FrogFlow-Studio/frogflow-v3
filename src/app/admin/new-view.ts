import { getRouteApi } from "@tanstack/react-router";

const authed = getRouteApi("/admin/_authed");

/**
 * Включён ли «новый вид» у магазина (core/settings/new-view). Страница с
 * новой вёрсткой выбирает её так: `const newView = useNewView();`
 * `return newView ? <NewPage /> : <OldPage />`. Данные и действия у обоих
 * видов одни и те же; сбой чтения настройки даёт «выключен» (старый вид).
 */
export function useNewView(): boolean {
  return authed.useRouteContext({ select: (c) => c.shop.newView });
}
