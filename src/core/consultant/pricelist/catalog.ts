/**
 * Прайс консультанта «по прайсу» (BOVI): модель товара из выгрузки 1С, поиск
 * по размеру, цвету, жёсткости и бюджету, подбор корзины. Перенос
 * src/lib/consultant/catalog.ts v1 без чтения базы: снимок прайса читает
 * catalog.server.ts по арендатору, сюда он приходит массивом.
 */
import { expandToken, expandTokenAll, foldText, haystackOf, tokenizeQuery } from "./synonyms";

/**
 * Нормализованная карточка. Claude видит только результаты search/get,
 * не весь прайс и не «память» модели.
 */
export type ProductHardness = "soft" | "medium" | "firm";

export type ConsultantProduct = {
  id: string;
  name: string;
  category: string;
  size: string;
  colors: string[];
  price_kzt: number;
  stock: boolean;
  stock_qty?: number;
  material?: string;
  description?: string;
  /**
   * Жёсткость матраса или топпера. В прайсе 1С отдельной колонки под неё нет —
   * фабрика пишет её в названии («Dorelan LEVANT R4 SOFT 160x200»), поэтому
   * поле необязательное, а читать жёсткость надо через productHardness().
   */
  hardness?: ProductHardness;
};

export type ProductSearchQuery = {
  query?: string;
  category?: string;
  size?: string;
  color?: string;
  hardness?: ProductHardness;
  max_price_kzt?: number;
  exclude_ids?: string[];
  /** Переопределяет BROWSE_LIMIT / NARROW_LIMIT — нужен точечно, обычно не задаётся. */
  limit?: number;
};

/**
 * «Комфортный» и «упругий» — то, как продавец просит называть жёсткость
 * покупателю (Soft и Firm соответственно). Раз бот говорит этими словами,
 * покупатель ими же и отвечает, поэтому разбор запроса обязан их понимать.
 */
const HARDNESS_PATTERNS: [ProductHardness, RegExp][] = [
  ["soft", /(?:^|[^a-z])soft(?:[^a-z]|$)|мягк|комфортн/i],
  ["medium", /(?:^|[^a-z])medium(?:[^a-z]|$)|(?:^|[^a-zа-яё])средн/i],
  ["firm", /(?:^|[^a-z])(?:firm|hard)(?:[^a-z]|$)|жестк|жёстк|упруг/i],
];

/** Жёсткость из свободного текста: «TRESOR R3 SOFT», «что есть в жёсткости soft». */
export function extractHardness(text: string): ProductHardness | null {
  if (!text) return null;
  for (const [kind, re] of HARDNESS_PATTERNS) {
    if (re.test(text)) return kind;
  }
  return null;
}

/**
 * Жёсткость товара: поле, если импорт его проставил, иначе вывод из названия.
 * Вывод из названия обязателен — каталог в базе загружен прежним импортом,
 * без поля hardness, и переимпорт ради поиска по жёсткости требовать нельзя.
 */
export function productHardness(product: ConsultantProduct): ProductHardness | null {
  return product.hardness ?? extractHardness(`${product.name} ${product.size}`);
}

/**
 * Снятое с производства. Продавец: «матрасов средней жёсткости мы не
 * упоминаем — сняты с производства». Выгрузка 1С отдаёт их, пока остатки
 * числятся на складе, поэтому отсекаем при чтении каталога, а не при
 * импорте: вернут в производство — правка одной строки здесь, без
 * переимпорта прайса и без потери остатков в выгрузке.
 *
 * Правило намеренно узкое — только матрасы. Подушка, наматрасник или чехол
 * со словом MEDIUM в названии остаются обычным товаром: спрятать их значит
 * потерять продажу там, где продавец ни о чём не просил.
 */
const DISCONTINUED_MATTRESS_HARDNESS: ProductHardness = "medium";

/**
 * «Наматрасник» и «чехол на матрас» — не матрас: отрицательный просмотр назад
 * отсекает слово, приклеенное к приставке. Без него защитный наматрасник
 * Traumina MEDIUM исчез бы из продажи вместе со снятыми матрасами.
 */
const MATTRESS_RE = /(?<![а-яё])матрас|mattress/i;

export function isMattress(product: ConsultantProduct): boolean {
  return MATTRESS_RE.test(`${product.category} ${product.name}`);
}

/**
 * Наматрасники и чехлы: слово «матрас» сидит в них подстрокой, и запрос про
 * матрасы вытаскивал защитный чехол наравне с матрасом. После снятия средней
 * жёсткости это особенно заметно — на «матрас средней жёсткости» в ответ
 * приезжал наматрасник MEDIUM и выглядел как тот самый матрас.
 */
const MATTRESS_ACCESSORY_RE = /наматрасник|чехол|чехлы/i;

export function isMattressAccessory(product: ConsultantProduct): boolean {
  return MATTRESS_ACCESSORY_RE.test(`${product.category} ${product.name}`);
}

function asksForMattress(q: ProductSearchQuery): boolean {
  const asked = `${q.category ?? ""} ${q.query ?? ""}`;
  return MATTRESS_RE.test(asked) && !MATTRESS_ACCESSORY_RE.test(asked);
}

export function isDiscontinuedProduct(product: ConsultantProduct): boolean {
  return isMattress(product) && productHardness(product) === DISCONTINUED_MATTRESS_HARDNESS;
}

/**
 * «Не для продажи».
 *
 * Пометка из прайса на позициях, которые стоят в салоне, но не продаются:
 * например, плед-образец на 70 000 ₸ с ценой и остатком, как у обычного
 * товара. Отдельно от пометки «демонстрационный»: ту с покупателя снимают, а
 * эту нельзя даже снимать — снятая, она превращает непродаваемую позицию в
 * обычную и бот предложит её к покупке.
 */
const NOT_FOR_SALE_RE = /не\s+для\s+продажи|не\s+прода[её]тся|not\s+for\s+sale/i;

export function isNotForSale(product: ConsultantProduct): boolean {
  return NOT_FOR_SALE_RE.test(`${product.category} ${product.name}`);
}

/** Позиции, которых покупатель видеть не должен ни по какому пути. */
export function isHiddenProduct(product: ConsultantProduct): boolean {
  return isDiscontinuedProduct(product) || isNotForSale(product);
}

/**
 * Пометка «демонстрационный».
 *
 * Продавец ведёт её в прайсе для себя: часть позиций стоит в салоне образцами.
 * Покупателю это знать незачем, а бот честно пересказывал — «Это
 * демонстрационная модель в нашем салоне» прямо в ответе о цене матраса.
 *
 * Правилом в промпте такое не лечится: пометка сидит в самом названии позиции
 * и в её категории, модель читает её в каталоге и повторяет. Значит убирать
 * надо там же, где убираются снятые с производства, — до того, как каталог
 * попадёт модели на глаза.
 *
 * Корень взят коротким намеренно: в прайсе встречаются и «(демонстр.)», и
 * «демонстраци подушк», и опечатка «(демонстарационный)». Осмысленных слов на
 * «демонст» в домашнем текстиле нет, поэтому широкий корень здесь безопаснее
 * точного перечисления написаний.
 */
const DEMO_MARKING_RE = /демонст[а-яё]*\.?/gi;
const DEMO_MENTION_RE = /демонст[а-яё]*/i;

export function isDemoMarked(product: ConsultantProduct): boolean {
  return DEMO_MENTION_RE.test(`${product.category} ${product.name}`);
}

/** Убирает пометку из названия, вычищая за собой опустевшие скобки и пробелы. */
export function stripDemoMarking(text: string): string {
  return text
    .replace(/\(\s*демонст[а-яё]*\.?\s*\)/gi, " ")
    .replace(DEMO_MARKING_RE, " ")
    .replace(/\(\s*\)/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();
}

/**
 * Позиция без пометки. Категорию «Демонстрационные позиции» обнуляем целиком:
 * подбор и так смотрит в название, когда категории нет, а иначе пометка
 * уезжает в промпт отдельным полем строки каталога.
 */
export function withoutDemoMarking(product: ConsultantProduct): ConsultantProduct {
  if (!isDemoMarked(product)) return product;
  const name = stripDemoMarking(product.name);
  return {
    ...product,
    // Если после чистки от названия ничего не осталось, пометка была всем
    // названием — исходное хуже не сделает, пустое сделает.
    name: name || product.name,
    category: DEMO_MENTION_RE.test(product.category) ? "" : product.category,
  };
}

/**
 * Каталог без снятого с производства — ровно то, что консультанту видно.
 * Фильтр стоит в одном месте (loadConsultantCatalog), а не в поиске: в промпт
 * каталог уходит целиком, и отсечь позицию только в поиске значит оставить её
 * модели на глазах — она и назовёт её сама, без всякого поиска.
 */
export function sellableProducts(rows: ConsultantProduct[]): ConsultantProduct[] {
  return rows.filter((p) => !isHiddenProduct(p));
}

/**
 * Допуск по размеру. Продавец подтвердил: фабрика выпускает 182×202 вместо
 * 180×200, и для покупателя это один и тот же размер — расхождение до 3 см
 * по каждой стороне считается совпадением, иначе поиск отвечает «нет»
 * на товар, который лежит на складе.
 */
export const SIZE_TOLERANCE_CM = 3;

function parseSizeDims(text: string): number[] | null {
  // «70 на 140» — живая речь покупателя; foldText приводит к «x» только
  // значки (× х * ), слово «на» остаётся, и размер переставал распознаваться.
  const folded = foldText(text).replace(/(\d)\s*на\s*(\d)/g, "$1x$2");
  const m = folded.match(/(\d{2,3})x(\d{2,3})(?:x(\d{1,3}))?/);
  if (!m) return null;
  const dims = [Number(m[1]), Number(m[2])];
  if (m[3]) dims.push(Number(m[3]));
  return dims.every((n) => Number.isFinite(n) && n > 0) ? dims : null;
}

/**
 * Стороны размера по убыванию, обрезанные до нужного количества и снова по
 * возрастанию — вид, в котором «140x70» и «70x140» это одно и то же.
 * Для трёхмерных размеров (подушка 40x70x10) при сравнении с двумя сторонами
 * берутся две большие: высота в запросе покупателя обычно не участвует.
 */
function sizeKey(dims: number[], take: number): number[] {
  return [...dims]
    .sort((a, b) => b - a)
    .slice(0, take)
    .sort((a, b) => a - b);
}

/**
 * Кухонные полотенца. У BOVI это отдельное назначение (SANDER), всё остальное —
 * банные и для лица. Продавец попросил не подмешивать кухонные в общий запрос
 * про полотенца и предлагать их, только когда спросили именно кухонные.
 */
const KITCHEN_TOWEL_RE = /кухон|kitchen|tea\s*towel/i;

export function isKitchenTowel(product: ConsultantProduct): boolean {
  return KITCHEN_TOWEL_RE.test(`${product.name} ${product.category}`);
}

/**
 * Прячем кухонные только в запросе именно про полотенца: поиск по бренду
 * SANDER или по цвету должен их находить, иначе они станут ненаходимыми.
 */
function hidesKitchenTowels(q: ProductSearchQuery): boolean {
  const text = `${q.query ?? ""} ${q.category ?? ""}`;
  if (!/полотенц|towel/i.test(foldText(text))) return false;
  return !KITCHEN_TOWEL_RE.test(text);
}

/**
 * Точное вхождение либо расхождение не больше SIZE_TOLERANCE_CM по каждой
 * стороне. Порядок сторон значения не имеет: продавец прислал живой случай,
 * где на «полотенце 140x70» бот ответил «такого размера в каталоге нет» и
 * предложил «близкий» 70x140 — то же самое полотенце, просто записанное с
 * другой стороны.
 */
export function sizeMatches(productSize: string, querySize: string): boolean {
  const want = foldText(querySize);
  if (!want) return true;
  if (foldText(productSize).includes(want)) return true;
  const have = parseSizeDims(productSize);
  const asked = parseSizeDims(querySize);
  if (!have || !asked) return false;
  const shared = Math.min(have.length, asked.length);
  if (shared < 2) return false;
  const haveKey = sizeKey(have, shared);
  const askedKey = sizeKey(asked, shared);
  for (let i = 0; i < shared; i++) {
    if (Math.abs(haveKey[i]! - askedKey[i]!) > SIZE_TOLERANCE_CM) return false;
  }
  return true;
}

function matches(product: ConsultantProduct, q: ProductSearchQuery): boolean {
  const hay = haystackOf([product.name, product.category, product.size, product.colors.join(" ")]);
  // Категорию сверяем только с названием и категорией товара. Раньше она
  // искалась по общему стогу вместе с расцветками и размером, и подбор по
  // цвету сползал в соседнюю категорию: на «голубые полотенца 50x70»
  // выдавалось голубое постельное бельё.
  if (
    q.category &&
    !haystackOf([product.category, product.name]).includes(expandToken(q.category))
  ) {
    return false;
  }
  if (q.size && !sizeMatches(product.size, q.size)) return false;
  if (q.color && !hay.includes(expandToken(q.color))) return false;
  // Жёсткость названа явно — другая жёсткость это не «похожий вариант», а
  // не тот товар: на запрос про soft выдавался TRESOR R2 MEDIUM.
  if (q.hardness && productHardness(product) !== q.hardness) return false;
  if (isKitchenTowel(product) && hidesKitchenTowels(q)) return false;
  // Спросили матрас — наматрасник и чехол это не он.
  if (isMattressAccessory(product) && asksForMattress(q)) return false;
  if (
    typeof q.max_price_kzt === "number" &&
    q.max_price_kzt > 0 &&
    product.price_kzt > q.max_price_kzt
  ) {
    return false;
  }
  if (q.exclude_ids?.includes(product.id)) return false;
  if (q.query) {
    const negated = extractNegatedWords(q.query);
    for (const neg of negated) {
      if (hay.includes(neg)) return false;
    }
    const tokens = searchTokens(q.query);
    if (tokens.length === 0 && negated.size === 0) return false;
    // Слово может значить несколько товаров сразу: «португальские» — и Bovi,
    // и Graccioza. Достаточно совпадения с любым из значений, иначе половина
    // ответа теряется.
    const groups = searchTokenAlternatives(q.query);
    if (groups.length > 0 && !groups.every((alts) => alts.some((a) => hay.includes(a)))) {
      return false;
    }
  }
  return true;
}

/** Служебные слова живой фразы. «У вас есть полотенца?» → только «полотенце». */
export const QUERY_STOP = new Set([
  "есть",
  "нужен",
  "нужна",
  "нужно",
  "нужны",
  "хочу",
  "подскажи",
  "подскажите",
  "скажите",
  "сколько",
  "стоит",
  "цена",
  "пожалуйста",
  "можно",
  "какой",
  "какая",
  "какое",
  "какие",
  "наличии",
  "наличие",
  "вас",
  "вам",
  "мне",
  "меня",
  "нам",
  "вы",
  "ли",
  "или",
  "для",
  "дома",
  "дом",
  "что",
  "это",
  "этот",
  "эта",
  "эти",
  "ещё",
  "еще",
  "нибудь",
  "можете",
  "посоветовать",
  "посоветуйте",
  "посоветуешь",
  "посоветуете",
  "порекомендуйте",
  "интересует",
  "интересуют",
  "покажите",
  "только",
  "купить",
  "купите",
  "предложите",
  "предложить",
  "корзину",
  "корзина",
  "бюджет",
  "тысяч",
  "тенге",
  "казахстан",
  "казахстана",
  "қазақстан",
  "россия",
  "россии",
  "россию",
  "россией",
  "алматы",
  "астана",
  "шымкент",
  "москва",
  "питер",
  "страна",
  "дагестан",
  "дагестане",
  "хасавюрт",
  "хасавюрте",
  "доставка",
  "доставку",
  "доставке",
  "сдэк",
  "cdek",
  "заказать",
  "цвет",
  "цвета",
  "расцветка",
  "расцветки",
  "оттенок",
  "оттенки",
  "осень",
  "зима",
  "качество",
  "соотношение",
  "здравствуйте",
  "привет",
  "добрый",
  "день",
  "вечер",
  "давайте",
  "давай",
  "хочу",
  "хотим",
  "хочется",
  "возьму",
  "возьмем",
  "возьмём",
  "берем",
  "берём",
  "беру",
  "буду",
  "будем",
  "можно",
  "пожалуйста",
  "спасибо",
  "благодарю",
  "какой",
  "какая",
  "какое",
  "какие",
  "каком",
  "наличие",
  "наличии",
  "подскажите",
  "выбрать",
  "выберите",
  "этого",
  "этому",
  "этом",
  "будет",
  "хватит",
  "достаточно",
]);

export function extractNegatedWords(text: string): Set<string> {
  const negated = new Set<string>();
  const re = /\bне\s+([а-яa-z0-9]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[1]) {
      negated.add(expandToken(m[1]));
    }
  }
  return negated;
}

/**
 * То же, что searchTokens, но каждое слово — со всеми своими значениями.
 * Используется подбором: совпадения с любым значением достаточно.
 */
export function searchTokenAlternatives(text: string): string[][] {
  // Варианты берём от ИСХОДНОГО слова, а не от свёрнутого: tokenizeQuery уже
  // выбрала одно значение из нескольких, и спросить у неё про остальные
  // нельзя — «португальские» к этому моменту стали просто «graccioza».
  const kept = new Set(searchTokens(text));
  const out: string[][] = [];
  for (const raw of foldText(text).split(" ")) {
    if (raw.length <= 1) continue;
    if (!kept.has(expandToken(raw))) continue;
    out.push(expandTokenAll(raw));
  }
  return out;
}

export function searchTokens(text: string): string[] {
  const negated = extractNegatedWords(text);
  return tokenizeQuery(text).filter((t) => {
    if (negated.has(t)) return false;
    if (QUERY_STOP.has(t) || /^\d+$/.test(t)) return false;
    if (/^[smlx]{1,3}$/i.test(t)) return true;
    return t.length > 2;
  });
}

/**
 * Разнообразит выборку: гарантирует, что каждый доступный размер и модель
 * попадают в топ результатов, а не вытесняются несколькими расцветками одного размера.
 */
export function diversifyProducts(products: ConsultantProduct[], limit = 12): ConsultantProduct[] {
  const inStock = products.filter((p) => p.stock);
  const outOfStock = products.filter((p) => !p.stock);
  const sorted = [...inStock, ...outOfStock];

  const byGroup = new Map<string, ConsultantProduct[]>();
  for (const p of sorted) {
    const key = `${foldText(p.name)}|${foldText(p.size)}`;
    const list = byGroup.get(key) ?? [];
    list.push(p);
    byGroup.set(key, list);
  }

  const result: ConsultantProduct[] = [];
  let round = 0;
  let added = true;
  while (added && result.length < limit) {
    added = false;
    for (const list of byGroup.values()) {
      if (round < list.length) {
        result.push(list[round]!);
        added = true;
        if (result.length >= limit) break;
      }
    }
    round++;
  }
  return result;
}

/**
 * Обогащает карточку всеми доступными в наличии расцветками для данной модели и размера.
 * В исходном прайсе/CSV каждый цвет — отдельная строка (SKU).
 * Чтобы модель видела полный спектр расцветок (и валидатор не блокировал их),
 * агрегируем расцветки из всех товаров в наличии с тем же именем и размером.
 */
export function enrichProductColors(
  product: ConsultantProduct,
  catalog: ConsultantProduct[],
): ConsultantProduct {
  const matching = catalog.filter(
    (p) =>
      p.stock &&
      foldText(p.name) === foldText(product.name) &&
      foldText(p.size) === foldText(product.size),
  );
  if (matching.length <= 1) return product;

  const colorSet = new Set<string>();
  for (const c of product.colors) {
    if (c && c.trim()) colorSet.add(c.trim());
  }
  for (const p of matching) {
    for (const c of p.colors) {
      if (c && c.trim()) colorSet.add(c.trim());
    }
  }
  if (colorSet.size === 0) return product;

  return {
    ...product,
    colors: Array.from(colorSet),
  };
}

/** Свободный просмотр без единого фильтра — короткая витрина, а не весь прайс. */
const BROWSE_LIMIT = 12;

/**
 * Запрос с явным фильтром (размер, цвет, жёсткость, категория, бюджет).
 * Прежний потолок в 12 позиций резал выдачу молча: на «что есть в жёсткости
 * soft» продавец получил три матраса из восьми и сказал, что так работать
 * нельзя. Потолок оставлен только как страховка от выгрузки всего прайса в
 * контекст модели, а сколько позиций нашлось всего, возвращается отдельно —
 * чтобы ответ мог назвать полное число, а не делать вид, что их столько и есть.
 */
const NARROW_LIMIT = 40;

/**
 * Полный список совпадений и то, что реально уходит в ответ.
 * Вызывающему нужен именно `all.length`: без него «показано 12» и «всего 12»
 * неразличимы.
 */
export function findProducts(
  q: ProductSearchQuery,
  rows: ConsultantProduct[],
): { all: ConsultantProduct[]; shown: ConsultantProduct[] } {
  // Вторая линия защиты. Каталог отфильтрован уже при чтении, но поиск
  // принимает и переданный массив — а снятое с производства не должно
  // всплыть ни по одному пути.
  const pool = sellableProducts(rows);
  const hasFilter = Boolean(
    q.query || q.category || q.size || q.color || q.hardness || q.max_price_kzt,
  );
  if (!hasFilter) {
    return { all: pool, shown: diversifyProducts(pool, q.limit ?? BROWSE_LIMIT) };
  }
  const all = pool.filter((p) => matches(p, q));
  const limit = q.limit ?? NARROW_LIMIT;
  if (q.max_price_kzt) {
    const sorted = [...all].sort(
      (a, b) => Number(b.stock) - Number(a.stock) || b.price_kzt - a.price_kzt,
    );
    return { all: sorted, shown: sorted.slice(0, limit) };
  }
  if (q.size || q.color || q.hardness) {
    return { all, shown: all.slice(0, limit) };
  }
  return { all, shown: diversifyProducts(all, limit) };
}

/**
 * Ценовое дно и потолок того же среза каталога, но БЕЗ ограничения по цене.
 *
 * Нужно, чтобы ответ про бюджет опирался на факт, а не на догадку. На запрос
 * «одеяло за 100 000 ₸» бот ответил «это довольно узкий ценовой сегмент» и
 * подставил подушку за 30 000, хотя правда простая: одеял дешевле 170 000 в
 * каталоге нет вообще. С этим числом на руках сказать правду проще, чем
 * смягчить.
 */
export function priceFloorInScope(
  q: ProductSearchQuery,
  rows: ConsultantProduct[],
): { cheapest: ConsultantProduct; count: number } | null {
  const { max_price_kzt: _ignored, ...scope } = q;
  const inScope = rows.filter((p) => p.stock && p.price_kzt > 0 && matches(p, scope));
  if (inScope.length === 0) return null;
  const cheapest = inScope.reduce((a, b) => (b.price_kzt < a.price_kzt ? b : a));
  return { cheapest, count: inScope.length };
}

export function productsUnderBudget(
  catalog: ConsultantProduct[],
  maxPriceKzt: number,
): ConsultantProduct[] {
  return catalog
    .filter((p) => p.stock && p.price_kzt > 0 && p.price_kzt <= maxPriceKzt)
    .sort((a, b) => b.price_kzt - a.price_kzt);
}

/**
 * Две позиции из разных категорий в бюджет — не одна случайная первая.
 *
 * `category` сужает подбор, когда клиент назвал категорию: разброс по
 * категориям задумывался под «соберите набор», а на «одеяло за 100 000»
 * он выдавал подушку. Разные категории внутри среза по-прежнему
 * предпочитаются — но только внутри него.
 */
export function suggestForBudget(
  catalog: ConsultantProduct[],
  maxPriceKzt: number,
  limit = 2,
  category?: string,
): ConsultantProduct[] {
  const scoped = category ? catalog.filter((p) => matches(p, { category })) : catalog;
  const under = productsUnderBudget(scoped, maxPriceKzt);
  const picks: ConsultantProduct[] = [];
  const seen = new Set<string>();
  for (const p of under) {
    const cat = foldText(p.category || p.name);
    if (picks.length > 0 && seen.has(cat)) continue;
    picks.push(p);
    seen.add(cat);
    if (picks.length >= limit) break;
  }
  if (picks.length === 1 && under.length > 1) picks.push(under.find((p) => p.id !== picks[0]!.id)!);
  return picks.filter(Boolean);
}

/** Другие карточки той же категории, чем уже показали. */
export function relatedVariants(
  catalog: ConsultantProduct[],
  lastIds: string[],
  limit = 2,
): ConsultantProduct[] {
  const shown = catalog.filter((p) => lastIds.includes(p.id));
  if (shown.length === 0) return [];
  const cats = new Set(shown.map((p) => foldText(p.category)));
  const stems = new Set(shown.map((p) => foldText(p.name).split(" ")[0] ?? "").filter(Boolean));
  const shownSig = new Set(
    shown.map(
      (p) =>
        `${foldText(p.size)}|${p.colors
          .map((c) => foldText(c))
          .sort()
          .join(",")}`,
    ),
  );
  const rest = catalog.filter((p) => {
    if (!p.stock || lastIds.includes(p.id)) return false;
    const cat = foldText(p.category);
    const stem = foldText(p.name).split(" ")[0] ?? "";
    return cats.has(cat) || stems.has(stem);
  });
  const different = rest.filter(
    (p) =>
      !shownSig.has(
        `${foldText(p.size)}|${p.colors
          .map((c) => foldText(c))
          .sort()
          .join(",")}`,
      ),
  );
  const pool = different.length > 0 ? different : rest;
  return pool.slice(0, limit);
}
