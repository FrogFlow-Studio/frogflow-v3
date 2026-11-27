import type { PGlite } from "@electric-sql/pglite";

/**
 * Каталог Копилки для тестов и экзамена v4 — восстановлен по базе знаний
 * 26.10 (как в tests/integration/v4-seller-eval.test.ts), с карточками товаров:
 * описание и ключевые слова (в т. ч. казахские). Цены — тенге.
 */
type Item = {
  title: string;
  price: number;
  variants?: Array<[string, number]>;
  description?: string;
  keywords?: string[];
};

const classes = (from: number, to: number, price: number): Array<[string, number]> =>
  Array.from({ length: to - from + 1 }, (_, i) => [`${from + i} класс`, price]);

export const KOPILKA_CATALOG: Item[] = [
  {
    title: "Лестницы «Части речи и члены предложения»",
    price: 2000,
    description: "Наглядность для кабинета: печатаете на А4, собираете лестницей на стене.",
    keywords: ["лестница", "части речи", "члены предложения", "наглядность"],
  },
  {
    title: "Палитра средств выразительности",
    price: 1700,
    description: "Плакаты для кабинета литературы. Печать на А4 или А3, на обычной или фотобумаге.",
    keywords: ["палитра", "тропы", "средства выразительности", "плакат"],
  },
  { title: "Небосвод писателей", price: 1500, keywords: ["писатели", "портреты"] },
  {
    title: "Папка классного руководителя",
    price: 3500,
    description:
      "Готовая папка: план воспитательной работы, социальный паспорт класса, протоколы, характеристики. Word, можно править.",
    keywords: ["классный руководитель", "сынып жетекші", "кл рук"],
  },
  {
    title: "Папка МО классных руководителей",
    price: 2500,
    variants: [
      ["Казахстан", 2500],
      ["Россия", 2500],
    ],
  },
  {
    title: "Папка МО ЕМН",
    price: 3500,
    variants: [
      ["Казахстан", 3500],
      ["Россия", 3500],
    ],
    keywords: ["естественно-математическое", "емн", "документация"],
  },
  {
    title: "Папка МО ОГН",
    price: 3500,
    variants: [
      ["Казахстан", 3500],
      ["Россия", 3500],
    ],
    keywords: ["общественно-гуманитарное", "огн", "документация"],
  },
  {
    title: "Папка родительских собраний",
    price: 2000,
    variants: [...classes(5, 11, 2000), ["5–11 классы", 10000]],
    keywords: ["родительское собрание", "ата-аналар жиналысы"],
  },
  {
    title: "Формативное оценивание: русский язык (Я1)",
    price: 2500,
    variants: [
      ...classes(5, 9, 2500),
      ["10 класс", 2000],
      ["11 класс", 2000],
      ["5–11 классы", 16500],
    ],
    description:
      "Сборник заданий формативного оценивания по русскому языку для школ с русским языком обучения.",
    keywords: ["формативка", "СОР", "оценивание"],
  },
  {
    title: "Формативное оценивание: русская литература (Я1)",
    price: 2500,
    variants: [...classes(5, 11, 2500), ["5–11 классы", 17500]],
    keywords: ["формативка", "оценивание"],
  },
  {
    title: "Рефлексия в национальном стиле",
    price: 2000,
    description: "Набор карточек рефлексии для урока, на казахском и русском.",
    keywords: ["рефлексия", "қазақша"],
  },
];

/** Магазин Копилка в базе v4: анкета, способы оплаты, каталог. Возвращает id товаров по названию. */
export async function seedKopilka(pg: PGlite, bot: string): Promise<Map<string, string>> {
  await pg.query("insert into v4.shops (bot_id, base_currency) values ($1, 'KZT')", [bot]);
  await pg.query("update v4.shops set seller_profile = $2 where bot_id = $1", [
    bot,
    {
      shop_name: "Копилка Русоведа",
      about:
        "Электронные материалы для учителей русского языка и литературы и классных руководителей.",
      payment_terms: "Kaspi-перевод по реквизитам, потом пришлите чек в этот чат.",
      delivery_terms: "Файл приходит в этот чат после подтверждения чека; бумажной продукции нет.",
      tone: "Тёплый, коротко, на «вы».",
    },
  ]);
  await pg.query(
    "insert into v4.payment_methods (bot_id, kind, country, currency, details) values ($1, 'transfer', 'KZ', 'KZT', 'Kaspi Gold 4400 0000 0000 0000')",
    [bot],
  );
  const ids = new Map<string, string>();
  for (const it of KOPILKA_CATALOG) {
    const parent = (
      await pg.query<{ id: string }>(
        "insert into v4.products (bot_id, kind, title, base_price_minor, description, keywords) values ($1, 'file', $2, $3, $4, $5) returning id",
        [bot, it.title, it.price * 100, it.description ?? null, it.keywords ?? []],
      )
    ).rows[0]!.id;
    ids.set(it.title, parent);
    for (const [label, price] of it.variants ?? []) {
      const v = (
        await pg.query<{ id: string }>(
          "insert into v4.products (bot_id, kind, title, variant_label, parent_id, base_price_minor) values ($1, 'file', $2, $3, $4, $5) returning id",
          [bot, it.title, label, parent, price * 100],
        )
      ).rows[0]!.id;
      ids.set(`${it.title} · ${label}`, v);
    }
  }
  return ids;
}
