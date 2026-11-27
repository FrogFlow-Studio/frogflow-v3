/**
 * Студия 3D-печати (ниша print3d): заказы живут в Google Таблице студии.
 * Мастер оформляет клиента и вносит строку. Бот может подтверждать заказ
 * автоматически по телефону или искать его по номеру с чека. Он также
 * отправляет карточку в рабочую группу и сообщает о готовности, если
 * продавец включил уведомления.
 *
 * Модуль без базы и без канала: разбор таблицы, поиск заказа, тексты на
 * 4 языках. Канал (Telegram сейчас, WhatsApp через Zernio позже) только
 * рисует и отправляет.
 */
import { parseCsv } from "@/core/catalog/import";
import type { Locale } from "@/core/i18n/locale";

export const PRINT3D_SHEET_KEY = "print3d_sheet_url";
export const PRINT3D_READY_KEY = "print3d_ready_notify";
export const PRINT3D_AUTO_KEY = "print3d_auto_accept";
/** Привязка заказа к клиенту: app_settings `print3d_bind:<номер>` (вставка один раз). */
export const BIND_PREFIX = "print3d_bind:";
/** Отметка «о готовности написали»: app_settings `print3d_ready:<номер>` (вставка один раз). */
export const READY_PREFIX = "print3d_ready:";
/**
 * Клиент прислал номер, которого в таблице ещё нет (мастер вносит строку
 * после того, как попросил клиента написать): app_settings `print3d_wait:<номер>`.
 * Крон находит строку, когда она появится, и шлёт карточку сам.
 */
export const WAIT_PREFIX = "print3d_wait:";
/** Сколько ждать появления номера в таблице, потом ожидание снимается. */
export const WAIT_TTL_MS = 3 * 24 * 3600_000;

export type Print3dOrder = {
  /** Номер заказа, как его видит клиент на чеке, без «№» и пробелов, в верхнем регистре. */
  no: string;
  name: string;
  phone: string;
  item: string;
  due: string;
  sum: string;
  photo: string;
  status: string;
  /** Строка таблицы (с заголовком = 1) — для сообщения мастеру. */
  row: number;
};

type Field = Exclude<keyof Print3dOrder, "row">;

/** Названия колонок: сравниваются целиком, без регистра, «ё» = «е». */
const HEADERS: Record<Field, readonly string[]> = {
  no: ["номер", "номер заказа", "№", "№ заказа", "заказ №", "order", "order no", "order #", "#"],
  name: ["имя", "клиент", "фио", "имя клиента", "name", "client", "customer"],
  phone: ["телефон", "номер телефона", "тел", "phone", "whatsapp"],
  item: [
    "заказ",
    "деталь",
    "описание",
    "что печатаем",
    "изделие",
    "item",
    "description",
    "details",
  ],
  due: ["срок", "дата готовности", "готово к", "дата", "due", "deadline"],
  sum: ["сумма", "цена", "стоимость", "итого", "sum", "price", "total"],
  photo: ["фото", "фото детали", "ссылка на фото", "photo", "image"],
  status: ["статус", "status", "состояние"],
};

const REQUIRED: Field[] = ["no", "item"];

function normHeader(s: string): string {
  return s.trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").replace(/:$/, "").trim();
}

export function normOrderNo(raw: string): string {
  return raw
    .trim()
    .replace(/^(№|#|n[o°]\.?)\s*/i, "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

export type ParsedSheet =
  { ok: true; orders: Print3dOrder[] } | { ok: false; reason: "noColumns"; missing: Field[] };

/** Строки таблицы → заказы. Строка без номера пропускается (её ещё заполняют). */
export function parseOrders(csv: string): ParsedSheet {
  const rows = parseCsv(csv);
  const head = (rows[0] ?? []).map(normHeader);
  const idx = {} as Record<Field, number>;
  for (const f of Object.keys(HEADERS) as Field[]) {
    idx[f] = head.findIndex((h) => HEADERS[f].includes(h));
  }
  const missing = REQUIRED.filter((f) => idx[f] < 0);
  if (missing.length) return { ok: false, reason: "noColumns", missing };
  const cell = (r: string[], f: Field) => (idx[f] >= 0 ? (r[idx[f]] ?? "").trim() : "");
  const orders: Print3dOrder[] = [];
  const seen = new Set<string>();
  rows.slice(1).forEach((r, i) => {
    const no = normOrderNo(cell(r, "no"));
    if (!no || seen.has(no)) return;
    seen.add(no);
    orders.push({
      no,
      name: cell(r, "name"),
      phone: cell(r, "phone"),
      item: cell(r, "item"),
      due: cell(r, "due"),
      sum: cell(r, "sum"),
      photo: cell(r, "photo"),
      status: cell(r, "status"),
      row: i + 2,
    });
  });
  return { ok: true, orders };
}

/**
 * Номер заказа в сообщении клиента: «1234», «№1234», «заказ 1234». Ищем
 * среди слов сообщения точное совпадение с номером из таблицы — цифры
 * телефона или суммы сами по себе заказом не становятся.
 */
export function findOrderInText(
  text: string,
  orders: readonly Print3dOrder[],
): Print3dOrder | null {
  const byNo = new Map(orders.map((o) => [o.no, o]));
  for (const token of text.split(/[^\p{L}\p{N}-]+/u)) {
    const hit = byNo.get(normOrderNo(token));
    if (hit) return hit;
  }
  return null;
}

/** Последние 10 цифр: +7 701…, 8 701… и 701… — один номер. */
export function phoneKey(raw: string): string | null {
  const d = raw.replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
}

/** Международные номера не совпадают только по последним цифрам. */
export function orderPhoneKey(raw: string): string | null {
  const value = raw.trim();
  if (!/^\+?[\d\s()-]+$/.test(value)) return null;
  const digits = value.replace(/\D/g, "");
  if (/^7\d{10}$/.test(digits)) return digits;
  if (!value.startsWith("+") && /^8\d{10}$/.test(digits)) return `7${digits.slice(1)}`;
  if (!value.startsWith("+") && digits.length === 10) return `7${digits}`;
  return /^[1-9]\d{9,14}$/.test(digits) ? digits : null;
}

/**
 * Заказ по телефону клиента (он поделился контактом). Несколько открытых
 * заказов на один номер — берём последний в таблице: он самый свежий.
 */
export function findOrderByPhone(
  phone: string,
  orders: readonly Print3dOrder[],
): Print3dOrder | null {
  const key = phoneKey(phone);
  if (!key) return null;
  const hits = orders.filter((o) => phoneKey(o.phone) === key);
  return hits.at(-1) ?? null;
}

/**
 * Слово «готов» целиком: «готовится» и «готовим» — ещё в работе. «Выдан» не
 * «готов»: заказ уже забрали — писать «можно забирать» поздно.
 */
const READY = /^(готов[оаы]?|ready|дайын|tayyor)([\s!.,:;)-]|$)/u;

/** «Готово», «Готов к выдаче», «ready» — да; «не готово», «готовится», пусто — нет. */
export function isReadyStatus(status: string): boolean {
  return READY.test(normHeader(status));
}

/**
 * Ссылка на фото для отправки. Ссылка Google Диска «Поделиться»
 * (/file/d/<id>/…, ?id=<id>) → прямая; прочие https-адреса — как есть.
 * Пусто или не https — фото нет.
 */
export function photoUrl(raw: string): string | null {
  const s = raw.trim();
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password) return null;
  if (u.hostname === "drive.google.com") {
    const id = /\/file\/d\/([A-Za-z0-9_-]{10,})/.exec(u.pathname)?.[1] ?? u.searchParams.get("id");
    if (!id || !/^[A-Za-z0-9_-]{10,}$/.test(id)) return null;
    return `https://drive.google.com/uc?export=download&id=${id}`;
  }
  return u.toString();
}

// ── Метка для ответа свайпом в рабочей группе ─────────────────────────

/** Метка клиента в сообщениях рабочей группы: ответ свайпом уходит ему. */
export function clientRef(clientId: string): string {
  return `#p3d${clientId}`;
}

export function clientRefOf(text: string | null | undefined): string | null {
  return /#p3d(\d{3,20})\b/.exec(text ?? "")?.[1] ?? null;
}

// ── Тексты ─────────────────────────────────────────────────────────────

type Texts = {
  askNumber: string;
  askPhone: string;
  sharePhone: string;
  phoneSaved: string;
  accepted: (no: string) => string;
  orderTitle: (no: string) => string;
  item: string;
  due: string;
  sum: string;
  status: string;
  cardFooter: string;
  ready: (no: string) => string;
  takenNumber: string;
  waiting: (no: string) => string;
};

export const PRINT3D_TEXTS: Record<Locale, Texts> = {
  ru: {
    askPhone: "Поделитесь своим номером, чтобы получать подтверждения заказов студии в этом чате.",
    sharePhone: "Поделиться номером",
    phoneSaved:
      "Номер сохранён. Когда студия внесёт ваш заказ в таблицу, здесь появится подтверждение.",
    accepted: (no) => `Ваш заказ № ${no} принят!`,
    askNumber:
      "Здравствуйте! Пришлите, пожалуйста, номер заказа с чека — я найду ваш заказ. Вопросы можно писать сюда же, их увидит мастер.",
    orderTitle: (no) => `Заказ № ${no}`,
    item: "Что печатаем",
    due: "Срок",
    sum: "Сумма",
    status: "Статус",
    cardFooter: "Когда заказ будет готов, мы напишем. Вопросы — прямо в этот чат.",
    ready: (no) => `Ваш заказ № ${no} готов, можно забирать!`,
    takenNumber:
      "Этот номер заказа уже привязан к другому чату. Мастер увидит ваше сообщение и ответит.",
    waiting: (no) =>
      `Заказа № ${no} пока нет в системе, мастер, наверное, ещё вносит его. Как только появится, я пришлю карточку сюда.`,
  },
  kk: {
    askPhone: "Студия тапсырыстарының растауын осы чатта алу үшін өз нөміріңізді жіберіңіз.",
    sharePhone: "Нөмірмен бөлісу",
    phoneSaved:
      "Нөмір сақталды. Студия тапсырысыңызды кестеге енгізгенде, растау осы чатқа келеді.",
    accepted: (no) => `№ ${no} тапсырысыңыз қабылданды!`,
    askNumber:
      "Сәлеметсіз бе! Чектегі тапсырыс нөмірін жіберіңізші — тапсырысыңызды табамын. Сұрақтарды осында жаза беріңіз, оларды шебер көреді.",
    orderTitle: (no) => `Тапсырыс № ${no}`,
    item: "Не басып шығарамыз",
    due: "Мерзімі",
    sum: "Сомасы",
    status: "Күйі",
    cardFooter: "Тапсырыс дайын болғанда жазамыз. Сұрақтарды осы чатқа жазыңыз.",
    ready: (no) => `№ ${no} тапсырысыңыз дайын, алып кетуге болады!`,
    takenNumber:
      "Бұл тапсырыс нөмірі басқа чатқа байланған. Шебер хабарламаңызды көріп, жауап береді.",
    waiting: (no) =>
      `№ ${no} тапсырысы әзірге жүйеде жоқ, шебер оны енгізіп жатқан болар. Пайда болғанда карточканы осында жіберемін.`,
  },
  en: {
    askPhone: "Share your own phone number to receive studio order confirmations in this chat.",
    sharePhone: "Share phone number",
    phoneSaved:
      "Phone number saved. Your confirmation will appear here once the studio adds your order to the sheet.",
    accepted: (no) => `Your order No. ${no} has been accepted!`,
    askNumber:
      "Hello! Please send the order number from your receipt and I'll find your order. You can ask questions here too, the studio will see them.",
    orderTitle: (no) => `Order No. ${no}`,
    item: "What we print",
    due: "Due",
    sum: "Total",
    status: "Status",
    cardFooter: "We'll message you when your order is ready. Questions go right here.",
    ready: (no) => `Your order No. ${no} is ready for pickup!`,
    takenNumber:
      "This order number is already linked to another chat. The studio will see your message and reply.",
    waiting: (no) =>
      `Order No. ${no} isn't in the system yet; the studio is probably still entering it. I'll send the card here as soon as it appears.`,
  },
  uz: {
    askPhone: "Studiya buyurtmalari tasdig‘ini shu chatda olish uchun o‘z raqamingizni yuboring.",
    sharePhone: "Telefon raqamini yuborish",
    phoneSaved:
      "Raqam saqlandi. Studiya buyurtmangizni jadvalga kiritganda, tasdiq shu chatga keladi.",
    accepted: (no) => `№ ${no} buyurtmangiz qabul qilindi!`,
    askNumber:
      "Assalomu alaykum! Chekdagi buyurtma raqamini yuboring — buyurtmangizni topaman. Savollarni shu yerga yozishingiz mumkin, ularni usta ko‘radi.",
    orderTitle: (no) => `Buyurtma № ${no}`,
    item: "Nimani chop etamiz",
    due: "Muddat",
    sum: "Summa",
    status: "Holat",
    cardFooter: "Buyurtma tayyor bo‘lganda yozamiz. Savollarni shu chatga yozing.",
    ready: (no) => `№ ${no} buyurtmangiz tayyor, olib ketishingiz mumkin!`,
    takenNumber:
      "Bu buyurtma raqami boshqa chatga bog‘langan. Usta xabaringizni ko‘rib, javob beradi.",
    waiting: (no) =>
      `№ ${no} buyurtma hozircha tizimda yo‘q, usta uni hali kiritayotgan bo‘lsa kerak. Paydo bo‘lishi bilan kartochkani shu yerga yuboraman.`,
  },
};

/** Карточка заказа для клиента: без телефона и имени — только то, что он заказал. */
export function clientCard(o: Print3dOrder, locale: Locale): string {
  const m = PRINT3D_TEXTS[locale];
  const lines = [m.orderTitle(o.no)];
  if (o.item) lines.push(`${m.item}: ${o.item}`);
  if (o.due) lines.push(`${m.due}: ${o.due}`);
  if (o.sum) lines.push(`${m.sum}: ${o.sum}`);
  if (o.status) lines.push(`${m.status}: ${o.status}`);
  lines.push("", m.cardFooter);
  return lines.join("\n");
}

/** Кто написал: имя и @username из канала, без лишних пробелов. */
export type ClientWho = { id: string; name: string; username?: string };

/** Тексты рабочей группе — на языке админки продавца (sellerLocale). */
type StaffTexts = {
  client: string;
  replyHint: string;
  bound: (who: string, no: string, row: number) => string;
  newOrder: (no: string, row: number) => string;
  inSheet: string;
  phone: string;
  item: string;
  due: string;
  sum: string;
  status: string;
  taken: (who: string, no: string) => string;
  header: (who: string, no: string | null) => string;
  readySent: (no: string) => string;
  readyFailed: (no: string) => string;
  waiting: (who: string, no: string) => string;
  relaySent: string;
  relayFailed: string;
};

export const PRINT3D_STAFF: Record<Locale, StaffTexts> = {
  ru: {
    client: "Клиент",
    replyHint: "Ответьте на это сообщение свайпом — бот перешлёт ответ клиенту.",
    bound: (w, no, row) => `✅ ${w} написал(а) в бота — заказ № ${no} (строка ${row})`,
    newOrder: (no, row) => `📋 Заказ № ${no} принят (строка ${row})`,
    inSheet: "Клиент в таблице",
    phone: "Телефон",
    item: "Что печатаем",
    due: "Срок",
    sum: "Сумма",
    status: "Статус",
    taken: (w, no) =>
      `⚠️ ${w} прислал(а) номер № ${no}, но он уже привязан к другому чату. Карточку бот не отправил.`,
    header: (w, no) => `💬 ${w} · ${no ? `заказ № ${no}` : "заказ не найден"}`,
    readySent: (no) => `📦 Клиенту отправлено «заказ № ${no} готов».`,
    readyFailed: (no) =>
      `⚠️ Не удалось написать клиенту «заказ № ${no} готов» (возможно, он заблокировал бота). Позвоните ему.`,
    waiting: (w, no) =>
      `⏳ ${w} прислал(а) номер № ${no}, а в таблице его ещё нет. Как только строка появится, бот сам отправит карточку.`,
    relaySent: "✓ Отправлено клиенту.",
    relayFailed:
      "Не удалось отправить клиенту: возможно, он заблокировал бота. Свяжитесь с ним по телефону.",
  },
  kk: {
    client: "Клиент",
    replyHint: "Осы хабарламаға свайппен жауап беріңіз — бот жауапты клиентке жібереді.",
    bound: (w, no, row) => `✅ ${w} ботқа жазды — № ${no} тапсырыс (${row}-жол)`,
    newOrder: (no, row) => `📋 № ${no} тапсырыс қабылданды (${row}-жол)`,
    inSheet: "Кестедегі клиент",
    phone: "Телефон",
    item: "Не басып шығарамыз",
    due: "Мерзімі",
    sum: "Сомасы",
    status: "Күйі",
    taken: (w, no) =>
      `⚠️ ${w} № ${no} нөмірін жіберді, бірақ ол басқа чатқа байланған. Бот карточканы жібермеді.`,
    header: (w, no) => `💬 ${w} · ${no ? `№ ${no} тапсырыс` : "тапсырыс табылмады"}`,
    readySent: (no) => `📦 Клиентке «№ ${no} тапсырыс дайын» жіберілді.`,
    readyFailed: (no) =>
      `⚠️ Клиентке «№ ${no} тапсырыс дайын» деп жазу мүмкін болмады (ботты бұғаттаған болуы мүмкін). Оған қоңырау шалыңыз.`,
    waiting: (w, no) =>
      `⏳ ${w} № ${no} нөмірін жіберді, бірақ ол кестеде әлі жоқ. Жол пайда болғанда бот карточканы өзі жібереді.`,
    relaySent: "✓ Клиентке жіберілді.",
    relayFailed:
      "Клиентке жіберу мүмкін болмады: ботты бұғаттаған болуы мүмкін. Онымен телефон арқылы байланысыңыз.",
  },
  en: {
    client: "Customer",
    replyHint:
      "Reply to this message with a swipe and the bot will forward your answer to the customer.",
    bound: (w, no, row) => `✅ ${w} wrote to the bot: order No. ${no} (row ${row})`,
    newOrder: (no, row) => `📋 Order No. ${no} accepted (row ${row})`,
    inSheet: "Customer in the sheet",
    phone: "Phone",
    item: "What we print",
    due: "Due",
    sum: "Total",
    status: "Status",
    taken: (w, no) =>
      `⚠️ ${w} sent No. ${no}, but it is already linked to another chat. The bot did not send the card.`,
    header: (w, no) => `💬 ${w} · ${no ? `order No. ${no}` : "order not found"}`,
    readySent: (no) => `📦 Sent to the customer: “order No. ${no} is ready”.`,
    readyFailed: (no) =>
      `⚠️ Could not send “order No. ${no} is ready” to the customer (they may have blocked the bot). Please call them.`,
    waiting: (w, no) =>
      `⏳ ${w} sent No. ${no}, but it is not in the sheet yet. As soon as the row appears, the bot will send the card itself.`,
    relaySent: "✓ Sent to the customer.",
    relayFailed:
      "Could not send to the customer: they may have blocked the bot. Please contact them by phone.",
  },
  uz: {
    client: "Mijoz",
    replyHint: "Bu xabarga svayp bilan javob bering — bot javobni mijozga yuboradi.",
    bound: (w, no, row) => `✅ ${w} botga yozdi — № ${no} buyurtma (${row}-qator)`,
    newOrder: (no, row) => `📋 № ${no} buyurtma qabul qilindi (${row}-qator)`,
    inSheet: "Jadvaldagi mijoz",
    phone: "Telefon",
    item: "Nimani chop etamiz",
    due: "Muddat",
    sum: "Summa",
    status: "Holat",
    taken: (w, no) =>
      `⚠️ ${w} № ${no} raqamini yubordi, lekin u boshqa chatga bog‘langan. Bot kartochkani yubormadi.`,
    header: (w, no) => `💬 ${w} · ${no ? `№ ${no} buyurtma` : "buyurtma topilmadi"}`,
    readySent: (no) => `📦 Mijozga «№ ${no} buyurtma tayyor» yuborildi.`,
    readyFailed: (no) =>
      `⚠️ Mijozga «№ ${no} buyurtma tayyor» deb yozib bo‘lmadi (botni bloklagan bo‘lishi mumkin). Unga qo‘ng‘iroq qiling.`,
    waiting: (w, no) =>
      `⏳ ${w} № ${no} raqamini yubordi, lekin u jadvalda hali yo‘q. Qator paydo bo‘lishi bilan bot kartochkani o‘zi yuboradi.`,
    relaySent: "✓ Mijozga yuborildi.",
    relayFailed:
      "Mijozga yuborib bo‘lmadi: botni bloklagan bo‘lishi mumkin. U bilan telefon orqali bog‘laning.",
  },
};

function whoLine(who: ClientWho, t: StaffTexts): string {
  const name = who.name.trim() || t.client;
  return who.username ? `${name} (@${who.username})` : name;
}

function withRef(t: StaffTexts, clientId: string): string {
  return `${t.replyHint} ${clientRef(clientId)}`;
}

/** Рабочей группе: клиент написал и заказ найден — та же карточка плюс данные из таблицы. */
export function groupCardBound(o: Print3dOrder, who: ClientWho, loc: Locale = "ru"): string {
  const t = PRINT3D_STAFF[loc];
  return [t.bound(whoLine(who, t), o.no, o.row), ...groupFields(o, t), "", withRef(t, who.id)].join(
    "\n",
  );
}

export function groupCardAccepted(o: Print3dOrder, clientId: string | null, loc: Locale): string {
  const t = PRINT3D_STAFF[loc];
  const lines = [t.newOrder(o.no, o.row), ...groupFields(o, t)];
  if (clientId) lines.push("", withRef(t, clientId));
  return lines.join("\n");
}

function groupFields(o: Print3dOrder, t: StaffTexts): string[] {
  const lines: string[] = [];
  if (o.name) lines.push(`${t.inSheet}: ${o.name}`);
  if (o.phone) lines.push(`${t.phone}: ${o.phone}`);
  if (o.item) lines.push(`${t.item}: ${o.item}`);
  if (o.due) lines.push(`${t.due}: ${o.due}`);
  if (o.sum) lines.push(`${t.sum}: ${o.sum}`);
  if (o.status) lines.push(`${t.status}: ${o.status}`);
  return lines;
}

/** Номер уже привязан к другому чату — мастеру нужно разобраться самому. */
export function groupTakenNumber(no: string, who: ClientWho, loc: Locale = "ru"): string {
  const t = PRINT3D_STAFF[loc];
  return `${t.taken(whoLine(who, t), no)}\n\n${withRef(t, who.id)}`;
}

/** Обычное сообщение клиента — в рабочую группу (подпись над текстом или фото). */
export function groupMessageHeader(
  who: ClientWho,
  orderNo: string | null,
  loc: Locale = "ru",
): string {
  const t = PRINT3D_STAFF[loc];
  return `${t.header(whoLine(who, t), orderNo)}\n${withRef(t, who.id)}`;
}

/** Готовность: сообщение группе, что клиенту написали. */
export function groupReadySent(no: string, clientId: string, loc: Locale = "ru"): string {
  const t = PRINT3D_STAFF[loc];
  return `${t.readySent(no)}\n\n${withRef(t, clientId)}`;
}

/** «Готово» не дошло (клиент заблокировал бота и т. п.) — мастеру позвонить. */
export function groupReadyFailed(no: string, clientId: string, loc: Locale = "ru"): string {
  const t = PRINT3D_STAFF[loc];
  return `${t.readyFailed(no)} ${clientRef(clientId)}`;
}

/** Клиент прислал номер, которого ещё нет в таблице. */
export function groupWaiting(no: string, who: ClientWho, loc: Locale = "ru"): string {
  const t = PRINT3D_STAFF[loc];
  return `${t.waiting(whoLine(who, t), no)}\n\n${withRef(t, who.id)}`;
}

/**
 * Номер заказа в сообщении, которого ещё нет в таблице: сообщение — это
 * только номер («1240», «№1240», «заказ 1240»), а не телефон или вопрос.
 */
export function waitingCandidate(text: string): string | null {
  const t = text.trim().replace(/^(заказ|тапсырыс|order|buyurtma)\s*/i, "");
  if (!t || /\s/.test(t.replace(/^(№|#)\s*/, ""))) return null;
  const no = normOrderNo(t);
  if (!/^[\p{L}\p{N}-]{1,12}$/u.test(no) || !/\d/.test(no)) return null;
  if (no.replace(/\D/g, "").length >= 10) return null; // похоже на телефон
  return no;
}
