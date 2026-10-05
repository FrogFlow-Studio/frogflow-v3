/**
 * Шаблон магазина по типу (seed/shop22-r-kinds.ts, shop22-r-kinds.spec.ts): два пустых магазина,
 * по одному на проект (desktop и phone), чтобы второй не застал уже применённый шаблон.
 * Основной магазин сида не меняется.
 */
export const KIND22_SHOPS = [
  {
    project: "desktop",
    id: "e2e22053-0000-4000-8000-000000000001",
    name: "Шаблон Р22 десктоп",
    slug: "e2e-kind22-d",
    login: "e2e_kind22_d",
    password: "e2e-kind22-pass-123",
    tg: 500000231,
  },
  {
    project: "phone",
    id: "e2e22053-0000-4000-8000-000000000002",
    name: "Шаблон Р22 телефон",
    slug: "e2e-kind22-p",
    login: "e2e_kind22_p",
    password: "e2e-kind22-pass-123",
    tg: 500000232,
  },
] as const;
