import { describe, expect, it } from "vitest";
import type { ConsultantProduct } from "./catalog";
import {
  askedBefore,
  brandCountries,
  countryMistakes,
  cyrillicBrands,
  draftFixNote,
  draftProblems,
  heightMismatches,
  mattressHeightIn,
  unsupportedProperties,
} from "./draft-check";

/** Сверка черновика консультанта по прайсу (перенос из tests/consultant-v2-engine.test.ts v1). */
const catalog: ConsultantProduct[] = [
  {
    id: "T1",
    name: "Uchino полотенце банное",
    category: "Полотенца",
    size: "50x100",
    colors: ["белый", "серый"],
    price_kzt: 9000,
    stock: true,
  },
];

describe("сверка черновика", () => {
  it("страна марки не та, что в списке марок, и марка кириллицей — переписать (прогон 25.09, 13:20)", () => {
    const countries = brandCountries([
      ["traumina", "немецкие", "германия"],
      ["dorelan", "итальянские", "италия"],
      ["weseta", "швейцарские", "швейцария"],
      ["pip", "голландские", "голландия", "нидерланды"],
      ["uchino", "японские", "япония"],
    ]);
    expect(countries.get("traumina")).toBe("Германия");
    expect(
      countryMistakes(
        "Есть товары этих стран: Dorelan и Traumina (Италия), PIP (Голландия), Uchino (Япония).",
        countries,
      ),
    ).toEqual(["traumina — Германия, не Италия"]);
    expect(
      countryMistakes(
        "50х100: Uchino (Япония) от 21 000 ₸, Weseta (Голландия) от 27 000 ₸",
        countries,
      ),
    ).toEqual(["weseta — Швейцария, не Нидерланды"]);
    expect(countryMistakes("Есть итальянские Dorelan и немецкие Traumina.", countries)).toEqual([]);
    expect(countryMistakes("португальские Rivolta", countries)).toEqual([]);
    expect(countryMistakes("японские Traumina", countries)).toEqual([
      "traumina — Германия, не Япония",
    ]);
    expect(cyrillicBrands("Травматина мягкая (Soft) есть 40x60", ["Traumina", "Dorelan"])).toEqual([
      "Травматина → Traumina",
    ]);
    expect(cyrillicBrands("Учино и Дорелан", ["Uchino", "Dorelan"])).toEqual([
      "Учино → Uchino",
      "Дорелан → Dorelan",
    ]);
    expect(cyrillicBrands("Подушки для сна, мягкие травмы нет", ["Traumina", "Dorelan"])).toEqual(
      [],
    );
    const kinds = draftProblems("Dorelan и Traumina (Италия). Травматина мягкая.", catalog, {
      brandCountries: countries,
      brands: ["Traumina"],
    }).map((p) => p.kind);
    expect(kinds).toEqual(expect.arrayContaining(["country", "latin"]));
  });

  it("вопрос о бюджете — переписать: магазин просил не спрашивать", () => {
    expect(
      draftProblems("Есть халаты Uchino и BOVI. Какой размер и примерный бюджет?", catalog).map(
        (p) => p.kind,
      ),
    ).toContain("budget");
    expect(draftProblems("Бюджетные есть от 9 000 ₸.", catalog).map((p) => p.kind)).not.toContain(
      "budget",
    );
  });

  it("оценки из статьи и длинный пересказ — переписать (Rivolta, прогон 25.09)", () => {
    const rivolta =
      "Rivolta - итальянский бренд, Rivolta Carmignani. Это премиальный производитель, поставляет продукцию в лучшие мировые отели класса люкс, включая Four Seasons. " +
      "По качеству их полотенца имеют высокую плотность: серия Shangri-La - 570 г/м², серия Imperiale - 600 г/м². Это профессиональная отельная махра с высокой плотностью и износостойкостью, " +
      "в Imperiale - люксовый густой 100% хлопок с элегантным блеском. Полотенца мягкие, хорошо впитывают влагу, быстро сохнут и долго служат даже после многих стирок. Какой размер вас интересует?";
    const problems = draftProblems(rivolta, catalog);
    expect(problems.map((p) => p.kind)).toEqual(expect.arrayContaining(["ads", "length"]));
    expect(problems.find((p) => p.kind === "ads")?.detail).toBe("премиальн, элегантн");
    expect(draftFixNote(problems)).toContain("одно-три предложения");
    // Факт об уходе — не оценка.
    expect(draftProblems("Рекомендуется стирать при 40°.", catalog)).toEqual([]);
    expect(
      draftProblems("Rivolta - итальянская марка, махра 570 г/м². Какой размер нужен?", catalog),
    ).toEqual([]);
  });

  it("свойство без опоры в прайсе и базе знаний — переписать", () => {
    const evidence =
      "Dorelan наматрасник защитный C.M.FIBERSAN 160х200 (высота 32-37 см)\nTraumina — гипоаллергенные одеяла";
    const live =
      "Наматрасник под высокий матрас есть: Dorelan C.M.FIBERSAN 160х200, высота 32-37 см, непромокаемый, 100 000 ₸.";
    expect(unsupportedProperties(live, evidence)).toEqual(["непромокаемый"]);
    expect(draftProblems(live, catalog, { evidence }).map((p) => p.kind)).toContain("property");
    // Есть в данных — можно; оговорка — не утверждение.
    expect(unsupportedProperties("Одеяла Traumina гипоаллергенные.", evidence)).toEqual([]);
    expect(unsupportedProperties("Непромокаемый ли он, в описании не указано.", evidence)).toEqual(
      [],
    );
    expect(unsupportedProperties("Непромокаемых наматрасников нет.", evidence)).toEqual([]);
  });

  it("наматрасник не по высоте матраса — переписать", () => {
    expect(mattressHeightIn("для высокого матраса 160*200*25 есть вариант?")).toBe(25);
    expect(mattressHeightIn("матрас 160х200, высота 30 см")).toBe(30);
    expect(mattressHeightIn("Коврик 35*50")).toBeNull();
    const live =
      "Наматрасник под высокий матрас есть: Dorelan C.M.FIBERSAN 160х200, высота 32-37 см, 100 000 ₸.";
    expect(heightMismatches(live, "Коврик 35*50\nнаматрасник для матраса 160*200*25")).toEqual([
      "матрас 25 см, в ответе высота 32–37 см",
    ]);
    expect(heightMismatches(live, "160*200*35")).toEqual([]);
    expect(
      heightMismatches(
        "FIBERSAN рассчитан на высоту 32-37 см, на 25 см будет свободен.",
        "160*200*25",
      ),
    ).toEqual([]);
  });
});

describe("второе уточнение подряд и фото без поиска (BOVI 12.10, anjellaakaeva)", () => {
  const recent = (...t: Array<["customer" | "assistant", string]>) =>
    t.map(([role, text]) => ({ role, text }));

  it("уточнение после уточнения — только на второй вопрос, приветствие не в счёт", () => {
    expect(
      askedBefore(recent(["customer", "Здравствуйте"], ["assistant", "Что подсказать?"])),
    ).toBe(false);
    expect(
      askedBefore(
        recent(
          ["customer", "Здравствуйте"],
          ["assistant", "Что подсказать?"],
          ["customer", "Есть этот комплект?"],
          ["assistant", "Уточните название?"],
        ),
      ),
    ).toBe(true);
    expect(
      askedBefore(
        recent(
          ["customer", "Здравствуйте"],
          ["assistant", "Что подсказать?"],
          ["customer", "Полотенце"],
          ["assistant", "Uchino 50x100 — 9 000 ₸."],
        ),
      ),
    ).toBe(false);
  });

  it("вопрос без поиска после вопроса или на фото — проблема; с поиском или без вопроса — нет", () => {
    const kinds = (text: string, ctx: Parameters<typeof draftProblems>[2]) =>
      draftProblems(text, [], ctx).map((p) => p.kind);
    expect(kinds("Уточните марку?", { askedBefore: true })).toContain("clarify");
    expect(kinds("Какой размер?", { photo: true })).toContain("clarify");
    expect(kinds("Уточните марку?", { askedBefore: true, searched: true })).not.toContain(
      "clarify",
    );
    expect(kinds("Такого нет.", { askedBefore: true })).not.toContain("clarify");
    expect(kinds("Уточните марку?", {})).not.toContain("clarify");
    expect(draftFixNote([{ kind: "clarify", detail: "photo" }])).toContain("search_products");
  });
});

describe("BOVI 15.10: приветствие после комментария", () => {
  it("ответ на «Здравствуйте» после комментария — не уточнение", () => {
    expect(
      askedBefore([
        { role: "customer", text: "[комментарий под публикацией] Bovi" },
        { role: "assistant", text: "Здравствуйте. BOVI - от 66 000 ₸." },
        { role: "customer", text: "Здравствуйте" },
        { role: "assistant", text: "Что вас интересует из этого?" },
      ]),
    ).toBe(false);
  });
});

/** BOVI 15.10, ответы на «А в рублях?»: модель рассказала, что цены в тенге, а код покажет рубли. */
describe("служебное: кухня перевода тенге в рубли", () => {
  const service = (text: string) =>
    draftProblems(text, catalog).filter((p) => p.kind === "service");

  it.each([
    "Цены привожу в тенге, вы увидите их в рублях: комплекты 155x200 - от 19 052 ₽.",
    "Цены указываю в тенге, но у вас в чате суммы отобразятся в рублях. Если подскажете размер и цвет, назову точную цену.",
    "Цены всё равно называю в тенге - для вас они отобразятся в рублях автоматически. Из популярного: Uchino полотенце банное.",
    "Пересчитаю автоматически в рублях.",
  ])("ловит «%s»", (text) => {
    expect(service(text)).toHaveLength(1);
  });

  it.each([
    "Decoflux 155х200 — 35 804 ₽",
    "Цены в рублях ориентировочные.",
    "Uchino полотенце банное 50x100 — 9 000 ₸. Какой цвет нужен?",
    "Могу назвать цены в рублях: полотенце Uchino — 1 700 ₽.",
    "Цены указаны за штуку, доставка в Россию — отдельно.",
  ])("не трогает обычный ответ «%s»", (text) => {
    expect(service(text)).toEqual([]);
  });
});

describe("BOVI 19.10: требование размера перед отправкой фото", () => {
  const stall = (text: string) => draftProblems(text, []).filter((p) => p.kind === "photo_stall");

  it.each([
    "Подскажите, пожалуйста, размер и цвет - тогда пришлю фото нужного варианта.",
    "Уточните, пожалуйста, размер, чтобы я прислала фото.",
    "Пришлю фото нужного варианта, когда выберете размер.",
    "Назовите размер комплекта, тогда отправлю фото.",
  ])("ловит затягивание с фото: «%s»", (text) => {
    expect(stall(text)).toHaveLength(1);
  });

  it.each([
    "Отправил фото комплекта. Какой размер вам нужен?",
    "Вот фото комплекта. Подскажите, какой размер вам нужен?",
    "Фото отправил выше. Какой размер вас интересует?",
  ])("не трогает обычный ответ: «%s»", (text) => {
    expect(stall(text)).toEqual([]);
  });
});
