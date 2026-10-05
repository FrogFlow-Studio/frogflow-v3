/**
 * «Готовность» карточки товара: чего не хватает, чтобы товар было удобно
 * покупать. Считается по полям, ничего не пишет и не блокирует сохранение:
 * подсказка продавцу, а не запрет.
 */
export type ReadinessKey = "name" | "description" | "price" | "photos" | "category" | "file";

export type ReadinessInput = {
  name: string;
  description: string;
  /** Цена товара; null — не введена. */
  price: number | null;
  /** Сколько вариантов с ценой: цена у вариантов заменяет общую. */
  variants: number;
  photos: number;
  categories: number;
  kind: "digital" | "physical";
  /** Файлов для выдачи (у курса вместо них уроки). */
  files: number;
  isCourse: boolean;
};

export type ReadinessGap = { key: ReadinessKey; count?: number };

export type Readiness = {
  missing: ReadinessGap[];
  done: number;
  total: number;
  percent: number;
  ready: boolean;
};

/** Фото, с которыми карточка выглядит законченной. */
export const RECOMMENDED_PHOTOS = 3;

export function productReadiness(i: ReadinessInput): Readiness {
  const missing: ReadinessGap[] = [];
  if (!i.name.trim()) missing.push({ key: "name" });
  if (!i.description.trim()) missing.push({ key: "description" });
  if (!(i.price !== null && i.price > 0) && i.variants === 0) missing.push({ key: "price" });
  if (i.photos < RECOMMENDED_PHOTOS)
    missing.push({ key: "photos", count: RECOMMENDED_PHOTOS - i.photos });
  if (i.categories === 0) missing.push({ key: "category" });
  // Файл нужен цифровому товару; курс держит уроки, физический — выдаётся руками.
  const needsFile = i.kind === "digital" && !i.isCourse;
  if (needsFile && i.files === 0) missing.push({ key: "file" });
  const total = needsFile ? 6 : 5;
  const done = total - missing.length;
  return {
    missing,
    done,
    total,
    percent: Math.round((done / total) * 100),
    ready: missing.length === 0,
  };
}

/** Строка списка товаров (core/catalog/admin: ProductListRow) — то, что нужно для готовности. */
export type ReadinessRow = {
  name: string;
  price: number;
  variants: number;
  images: number;
  files: number;
  fulfillment_kind: string;
  category_ids: unknown;
  has_description: boolean;
  is_course: boolean;
};

export function rowReadiness(r: ReadinessRow): Readiness {
  return productReadiness({
    name: r.name,
    description: r.has_description ? "x" : "",
    price: r.price,
    variants: r.variants,
    photos: r.images,
    categories: Array.isArray(r.category_ids) ? r.category_ids.length : 0,
    kind: r.fulfillment_kind === "physical" ? "physical" : "digital",
    files: r.files,
    isCourse: r.is_course,
  });
}
