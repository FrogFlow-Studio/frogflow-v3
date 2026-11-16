/**
 * Студия 3D-печати (ниша print3d): заказы живут в Google Таблице студии.
 * Мастер оформляет клиента и вносит строку; клиент пишет в бота номер
 * заказа с чека — бот находит строку и отвечает карточкой, копия уходит в
 * рабочую группу. Когда в колонке «Статус» появляется «готово», бот один раз
 * пишет клиенту (если продавец включил это в настройках).
 *
 * Модуль без базы и без канала: разбор таблицы, поиск заказа, тексты на
 * 4 языках. Канал (Telegram сейчас, WhatsApp через Zernio позже) только
 * рисует и отправляет.
 */
import { parseCsv } from "@/core/catalog/import";
import type { Locale } from "@/core/i18n/locale";

export const PRINT3D_SHEET_KEY = "print3d_sheet_url";
export const PRINT3D_READY_KEY = "print3d_ready_notify";
/** Привязка заказа к клиенту: app_settings `print3d_bind:<номер>` (вставка один раз). */
export const BIND_PREFIX = "print3d_bind:";
/** Отметка «о готовности написали»: app_settings `print3d_ready:<номер>` (вставка один раз). */
export const READY_PREFIX = "print3d_ready:";

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

const READY_WORDS = ["готов", "ready", "дайын", "tayyor", "выдан", "done"];

/** «Готово», «Готов к выдаче», «ready» — да; «не готово», пусто — нет. */
export function isReadyStatus(status: string): boolean {
  const s = normHeader(status);
  if (!s || /^не\s/.test(s) || s.startsWith("not ")) return false;
  return READY_WORDS.some((w) => s.startsWith(w));
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
  orderTitle: (no: string) => string;
  item: string;
  due: string;
  sum: string;
  status: string;
  cardFooter: string;
  ready: (no: string) => string;
  takenNumber: string;
};

export const PRINT3D_TEXTS: Record<Locale, Texts> = {
  ru: {
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
  },
  kk: {
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
  },
  en: {
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
  },
  uz: {
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

function whoLine(who: ClientWho): string {
  const name = who.name.trim() || "Клиент";
  return who.username ? `${name} (@${who.username})` : name;
}

const REPLY_HINT = "Ответьте на это сообщение свайпом — бот перешлёт ответ клиенту.";

/** Рабочей группе: клиент написал и заказ найден — та же карточка плюс данные из таблицы. */
export function groupCardBound(o: Print3dOrder, who: ClientWho): string {
  const lines = [`✅ ${whoLine(who)} написал(а) в бота — заказ № ${o.no} (строка ${o.row})`];
  if (o.name) lines.push(`Клиент в таблице: ${o.name}`);
  if (o.phone) lines.push(`Телефон: ${o.phone}`);
  if (o.item) lines.push(`Что печатаем: ${o.item}`);
  if (o.due) lines.push(`Срок: ${o.due}`);
  if (o.sum) lines.push(`Сумма: ${o.sum}`);
  if (o.status) lines.push(`Статус: ${o.status}`);
  lines.push("", `${REPLY_HINT} ${clientRef(who.id)}`);
  return lines.join("\n");
}

/** Номер уже привязан к другому чату — мастеру нужно разобраться самому. */
export function groupTakenNumber(no: string, who: ClientWho): string {
  return `⚠️ ${whoLine(who)} прислал(а) номер № ${no}, но он уже привязан к другому чату. Карточку бот не отправил.\n\n${REPLY_HINT} ${clientRef(who.id)}`;
}

/** Обычное сообщение клиента — в рабочую группу (подпись над текстом или фото). */
export function groupMessageHeader(who: ClientWho, orderNo: string | null): string {
  const order = orderNo ? ` · заказ № ${orderNo}` : " · заказ не найден";
  return `💬 ${whoLine(who)}${order}\n${REPLY_HINT} ${clientRef(who.id)}`;
}

/** Готовность: сообщение группе, что клиенту написали. */
export function groupReadySent(no: string): string {
  return `📦 Клиенту отправлено «заказ № ${no} готов».`;
}

export const GROUP_RELAY_SENT = "✓ Отправлено клиенту.";
export const GROUP_RELAY_FAILED =
  "Не удалось отправить клиенту: возможно, он заблокировал бота. Свяжитесь с ним по телефону.";
