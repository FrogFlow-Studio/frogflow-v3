/**
 * «Первые 7 дней» (seed/shop22-r-week.ts, shop22-r-week.spec.ts): два пустых магазина,
 * по одному на проект (desktop и phone). Основной магазин сида не меняется.
 */
export const WEEK22_SHOPS = [
  {
    project: "desktop",
    id: "e2e22054-0000-4000-8000-000000000001",
    name: "Неделя Р22 десктоп",
    slug: "e2e-week22-d",
    login: "e2e_week22_d",
    password: "e2e-week22-pass-123",
    tg: 500000241,
  },
  {
    project: "phone",
    id: "e2e22054-0000-4000-8000-000000000002",
    name: "Неделя Р22 телефон",
    slug: "e2e-week22-p",
    login: "e2e_week22_p",
    password: "e2e-week22-pass-123",
    tg: 500000242,
  },
] as const;
