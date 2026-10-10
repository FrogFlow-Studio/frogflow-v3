import type { Locale } from "@/core/i18n/locale";
import { parsePlan } from "@/core/plans/registry";

/**
 * ИИ-наблюдатель за диалогами (фаза 1, решение Якова 09.10): раз в 15 минут
 * модель читает новые реплики диалогов бота на правилах и ищет то, что
 * оператор ловил руками срезами: бот ответил не на то или дважды, вопрос
 * висит без ответа, покупатель из другой страны или не может платить картой,
 * оплата зависла, оптовик, раздражённый покупатель, похожее на сбой
 * платформы. Покупателю наблюдатель НЕ пишет никогда: продавцу — подсказка с
 * цитатой и готовым ответом, оператору — сбой платформы. Здесь чистые
 * правила; чтение, модель и отправка — app/observer/observer.server.ts.
 */

/** Версия промпта: пишется в журнал каждой находки, чтобы сравнивать точность версий. */
export const OBSERVER_PROMPT_VERSION = "2026-10-10.1";
export const OBSERVER_MODEL = "claude-sonnet-5";
/** Цена Sonnet 5 за миллион токенов, $ (как у консультанта, core/consultant/engine.server). */
export const OBSERVER_PRICE = { in: 2, out: 10 };

/** Вкл/выкл у клиента: "true" / "false"; нет ключа — по умолчанию (OBSERVER_DEFAULT_ON). */
export const OBSERVER_ENABLED_KEY = "observer_enabled";
/** Потолок расхода в день, $; нет ключа — OBSERVER_DAILY_USD. */
export const OBSERVER_CAP_KEY = "observer_daily_usd";
/** Аренда прогона: ISO-время окончания; пусто — свободно. Маленькое значение для условной записи. */
export const OBSERVER_LEASE_KEY = "observer_lease";
/** Курсор, отметки сигналов, расход за день, итог прогона — пишет только держатель аренды. */
export const OBSERVER_STATE_KEY = "observer_state";
/** Журнал находок за день (по дате клиента): `observer_log:2026-10-10`. */
export const observerLogKey = (date: string) => `observer_log:${date}`;

/** Копилка Русоведа — первый клиент наблюдателя; остальным включает оператор. */
export const OBSERVER_DEFAULT_ON: readonly string[] = ["4f9562e2-3bf4-4cba-8a58-794637511431"];
/** ≈ 4 000 ₸ в месяц на клиента — в пределах цены Business (сетка тарифов 10.10.2026). */
export const OBSERVER_DAILY_USD = 0.25;
export const OBSERVER_LEASE_MS = 5 * 60_000;
/** Не больше одного сигнала продавцу по диалогу за час. */
export const SIGNAL_EVERY_MS = 60 * 60_000;
/** «Вопрос без ответа» — столько молчания после реплики покупателя. */
export const UNANSWERED_MS = 2 * 60 * 60_000;
/** Первый запуск (курсора нет) смотрит назад не дальше этого. */
export const FIRST_LOOKBACK_MS = 20 * 60_000;
/** Курсор старше этого (крон стоял) — не разбираем старьё, начинаем с этого окна. */
export const MAX_LOOKBACK_MS = 3 * 60 * 60_000;
/** Хвост окна: реплики последних секунд ещё могут дописываться, их возьмёт следующий прогон. */
export const WINDOW_LAG_MS = 30_000;
export const MAX_DIALOGS_PER_RUN = 30;
export const DIALOGS_PER_CALL = 5;
export const HISTORY_PER_DIALOG = 30;

export function parseEnabled(raw: string | null | undefined, botId: string): boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return OBSERVER_DEFAULT_ON.includes(botId);
}

/**
 * Наблюдатель входит только в Business (и в индивидуальные условия): он
 * тратит ИИ платформы без лимита диалогов (сетка тарифов 10.10.2026).
 */
export function observerInPlan(plan: string | null | undefined): boolean {
  const p = parsePlan(plan);
  return p?.kind === "custom" || (p?.kind === "tier" && p.tier === "business");
}

export function parseCap(raw: string | null | undefined): number {
  const n = Number(raw);
  return raw != null && raw !== "" && Number.isFinite(n) && n >= 0 && n <= 50
    ? n
    : OBSERVER_DAILY_USD;
}

export type ObserverRunSummary = {
  at: string;
  dialogs: number;
  findings: number;
  sent: number;
  usd: number;
  /** Диалоги сверх потолка прогона — не разобраны. */
  overflow?: number;
  /** Диалоги, на которых модель не ответила. */
  failed?: number;
  error?: string;
};

export type ObserverState = {
  /** Конец последнего разобранного окна (created_at реплик). */
  cursor: string | null;
  /** telegram_id → когда продавцу писали по диалогу. */
  signals: Record<string, string>;
  /** Расход за день клиента. */
  spend: { date: string; usd: number; calls: number };
  /** День, за который оператору уже сообщили о потолке расхода. */
  capAlerted?: string;
  last?: ObserverRunSummary;
};

export function parseState(raw: string | null | undefined, today: string): ObserverState {
  let v: Partial<ObserverState> = {};
  try {
    v = (JSON.parse(raw ?? "null") as Partial<ObserverState> | null) ?? {};
  } catch {
    v = {};
  }
  const spend =
    v.spend && v.spend.date === today && Number.isFinite(Number(v.spend.usd))
      ? { date: today, usd: Number(v.spend.usd), calls: Number(v.spend.calls) || 0 }
      : { date: today, usd: 0, calls: 0 };
  const signals: Record<string, string> = {};
  if (v.signals && typeof v.signals === "object")
    for (const [k, at] of Object.entries(v.signals)) if (typeof at === "string") signals[k] = at;
  return {
    cursor: typeof v.cursor === "string" ? v.cursor : null,
    signals,
    spend,
    ...(typeof v.capAlerted === "string" ? { capAlerted: v.capAlerted } : {}),
    ...(v.last ? { last: v.last } : {}),
  };
}

/** Окно прогона: (from, to]. Курсор после простоя не тянет за собой часы старья. */
export function windowOf(cursor: string | null, now: number): { from: string; to: string } {
  const to = now - WINDOW_LAG_MS;
  const c = cursor ? Date.parse(cursor) : NaN;
  const from = Number.isFinite(c) ? Math.max(c, to - MAX_LOOKBACK_MS) : to - FIRST_LOOKBACK_MS;
  return { from: new Date(Math.min(from, to)).toISOString(), to: new Date(to).toISOString() };
}

/** Отметки старше часа больше ничего не запрещают — не храним. */
export function pruneSignals(s: Record<string, string>, now: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, at] of Object.entries(s)) if (now - Date.parse(at) < SIGNAL_EVERY_MS) out[k] = at;
  return out;
}

export function canSignal(s: Record<string, string>, telegramId: number, now: number): boolean {
  const at = s[String(telegramId)];
  return !at || now - Date.parse(at) >= SIGNAL_EVERY_MS;
}

export function costUsd(usage: { input_tokens?: number; output_tokens?: number } | undefined) {
  const i = Number(usage?.input_tokens) || 0;
  const o = Number(usage?.output_tokens) || 0;
  return Math.round(((i * OBSERVER_PRICE.in + o * OBSERVER_PRICE.out) / 1e6) * 1e6) / 1e6;
}

// ── Диалоги для модели ──────────────────────────────────────────────────

export type ChatLine = {
  id: string;
  telegramId: number;
  sender: string;
  text: string;
  at: string;
};

export type ObservedDialog = {
  telegramId: number;
  /** «Instagram · @user» — для модели и для сообщения продавцу. */
  who: string;
  lines: Array<ChatLine & { fresh: boolean }>;
  orders: Array<{ no: number; status: string; total: number; currency: string; at: string }>;
  /** Покупатель молчит в ответ уже столько минут (последняя реплика — его). */
  waitingMin?: number;
};

/**
 * Какие диалоги смотреть: где в окне писал покупатель, и где последняя
 * реплика покупателя перешла отметку «2 часа без ответа» в этом окне.
 * Свежие первыми; сверх потолка — в overflow.
 */
export function pickDialogs(
  windowLines: readonly ChatLine[],
  crossedUnanswered: readonly number[],
): { ids: number[]; overflow: number } {
  const last = new Map<number, string>();
  for (const l of windowLines)
    if (l.sender === "customer" && (last.get(l.telegramId) ?? "") < l.at)
      last.set(l.telegramId, l.at);
  const ids = [...last.entries()].sort((a, b) => (a[1] < b[1] ? 1 : -1)).map(([id]) => id);
  for (const id of crossedUnanswered) if (!last.has(id)) ids.push(id);
  return {
    ids: ids.slice(0, MAX_DIALOGS_PER_RUN),
    overflow: Math.max(0, ids.length - MAX_DIALOGS_PER_RUN),
  };
}

const SENDER: Record<string, string> = { customer: "Покупатель", bot: "Бот", manager: "Продавец" };
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function dialogBlock(d: ObservedDialog, timezone: string): string {
  const time = (iso: string) =>
    new Date(iso).toLocaleString("ru", {
      timeZone: timezone,
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  const head = `<dialog id="${d.telegramId}" who="${d.who.replace(/"/g, "'")}">`;
  const orders = d.orders.length
    ? `Заказы покупателя за 3 дня: ${d.orders
        .map((o) => `№${o.no} ${o.status} ${o.total} ${o.currency} (${time(o.at)})`)
        .join("; ")}`
    : "Заказов за 3 дня нет.";
  const wait =
    d.waitingMin != null
      ? `\nПоследняя реплика — покупателя, ответа нет ${Math.round(d.waitingMin / 60)} ч ${d.waitingMin % 60} мин.`
      : "";
  const lines = d.lines
    .map(
      (l) =>
        `${l.fresh ? "* " : "  "}[${time(l.at)}] ${SENDER[l.sender] ?? l.sender}: ${clip(
          l.text.replace(/\s+/g, " "),
          600,
        )}`,
    )
    .join("\n");
  return `${head}\n${orders}${wait}\n${lines}\n</dialog>`;
}

// ── Промпт и ответ модели ───────────────────────────────────────────────

export const FINDING_KINDS = [
  "off_topic",
  "double_reply",
  "unanswered",
  "other_country",
  "card_trouble",
  "payment_stuck",
  "wholesale",
  "upset",
  "bug",
] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];

export type Finding = {
  telegramId: number;
  kind: FindingKind;
  /** seller — продавцу, system — оператору (сбой платформы), both — обоим. */
  audience: "seller" | "system" | "both";
  quote: string;
  summary: string;
  reply: string;
};

const LANG_NAME: Record<Locale, string> = {
  ru: "русском",
  kk: "казахском",
  en: "английском",
  uz: "узбекском",
};

export function observerSystemPrompt(p: { shop: string; sellerLocale: Locale }): string {
  return `Ты — наблюдатель за перепиской магазина «${p.shop}» с покупателями в Instagram и Telegram. Отвечает покупателям бот на правилах: ключевые слова, кнопки, каталог, оформление и оплата заказа; на непонятное он пишет «передаю продавцу». Продавец иногда отвечает сам из приложения Instagram, и эти ответы сюда могут не попадать.

Ты сам покупателям не пишешь. Твоя задача — найти диалоги, где продавцу или разработчикам платформы надо вмешаться, и сообщить об этом инструментом report.

Ищи только такое (kind):
- off_topic — бот ответил не на то, что спросили, или проигнорировал понятный вопрос;
- double_reply — бот прислал одно и то же дважды или противоречит себе;
- unanswered — покупатель задал вопрос или хочет купить, а ответа по существу нет (бот передал продавцу и тишина, или бот молчит);
- other_country — покупатель не из Казахстана (Россия, Беларусь, Кыргызстан и др.) или спрашивает про рубли/другую валюту;
- card_trouble — не может или не хочет платить картой, просит другой способ (Kaspi, Халык, перевод);
- payment_stuck — покупатель оплатил или пытается, а заказ не подтверждён, чек не принят, ссылка не работает;
- wholesale — опт, много штук, для школы/организации, сотрудничество;
- upset — покупатель раздражён, растерян, жалуется, грозит уйти;
- bug — похоже на сбой платформы: кнопка не сработала, бот замолчал на шаге, пустой или технический текст, ошибка, цена расходится между сообщениями.

Строки, помеченные «*», — новые с прошлой проверки. Сообщай только о том, что видно в новых строках или в отметке «ответа нет». Старое, о чём уже можно было сообщить раньше, не повторяй.

Не сообщай: «спасибо», смайлики, приветствия, нормальный ход покупки, успешную оплату, вопросы, на которые бот уже ответил по существу. Сомневаешься — не сообщай: продавца нельзя заваливать. По одному диалогу — не больше одной находки, самой важной.

audience: seller — продавцу надо ответить или проверить; system — только сбой платформы, продавцу делать нечего; both — сбой платформы, из-за которого покупателю нужен ответ продавца.

Поля:
- quote — точные слова покупателя (до 200 знаков), без изменений;
- summary — одна-две фразы на ${LANG_NAME[p.sellerLocale]} языке для продавца: что случилось и что сделать;
- reply — готовый ответ покупателю на его языке, вежливо и коротко, без выдуманных цен, ссылок и обещаний; если ответа нет без данных продавца — напиши, что уточнить. Для audience=system — пустая строка.

Нет находок — вызови report с пустым списком.`;
}

export const REPORT_TOOL = {
  name: "report",
  description: "Сообщить находки по диалогам. Пустой список — всё в порядке.",
  input_schema: {
    type: "object" as const,
    properties: {
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            dialog_id: { type: "string", description: "id из <dialog id=…>" },
            kind: { type: "string", enum: [...FINDING_KINDS] },
            audience: { type: "string", enum: ["seller", "system", "both"] },
            quote: { type: "string" },
            summary: { type: "string" },
            reply: { type: "string" },
          },
          required: ["dialog_id", "kind", "audience", "quote", "summary", "reply"],
        },
      },
    },
    required: ["findings"],
  },
};

/** Разбор вызова report: чужие id, неизвестные виды и дубли по диалогу отбрасываются. */
export function parseFindings(input: unknown, known: ReadonlySet<number>): Finding[] {
  const list = (input as { findings?: unknown } | null)?.findings;
  if (!Array.isArray(list)) return [];
  const out: Finding[] = [];
  const seen = new Set<number>();
  for (const raw of list) {
    const f = raw as Record<string, unknown>;
    const id = Number(f.dialog_id);
    const kind = String(f.kind) as FindingKind;
    const audience = String(f.audience);
    if (!known.has(id) || seen.has(id)) continue;
    if (!(FINDING_KINDS as readonly string[]).includes(kind)) continue;
    if (audience !== "seller" && audience !== "system" && audience !== "both") continue;
    seen.add(id);
    out.push({
      telegramId: id,
      kind,
      audience,
      quote: clip(String(f.quote ?? "").trim(), 300),
      summary: clip(String(f.summary ?? "").trim(), 500),
      reply: audience === "system" ? "" : clip(String(f.reply ?? "").trim(), 700),
    });
  }
  return out;
}

// ── Тексты продавцу (4 языка) ───────────────────────────────────────────

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const KIND_LABEL: Record<Locale, Record<FindingKind, string>> = {
  ru: {
    off_topic: "бот ответил не на то",
    double_reply: "бот ответил дважды",
    unanswered: "вопрос без ответа",
    other_country: "покупатель из другой страны",
    card_trouble: "не может оплатить картой",
    payment_stuck: "оплата зависла",
    wholesale: "оптовый запрос",
    upset: "покупатель недоволен",
    bug: "похоже на сбой",
  },
  kk: {
    off_topic: "бот басқа нәрсеге жауап берді",
    double_reply: "бот екі рет жауап берді",
    unanswered: "сұрақ жауапсыз қалды",
    other_country: "сатып алушы басқа елден",
    card_trouble: "картамен төлей алмайды",
    payment_stuck: "төлем тұрып қалды",
    wholesale: "көтерме сұрау",
    upset: "сатып алушы наразы",
    bug: "ақауға ұқсайды",
  },
  en: {
    off_topic: "bot answered off-topic",
    double_reply: "bot replied twice",
    unanswered: "question left unanswered",
    other_country: "buyer from another country",
    card_trouble: "can't pay by card",
    payment_stuck: "payment is stuck",
    wholesale: "wholesale request",
    upset: "buyer is unhappy",
    bug: "looks like a glitch",
  },
  uz: {
    off_topic: "bot boshqa narsaga javob berdi",
    double_reply: "bot ikki marta javob berdi",
    unanswered: "savol javobsiz qoldi",
    other_country: "xaridor boshqa davlatdan",
    card_trouble: "karta bilan to‘lay olmayapti",
    payment_stuck: "to‘lov to‘xtab qoldi",
    wholesale: "ulgurji so‘rov",
    upset: "xaridor norozi",
    bug: "nosozlikka o‘xshaydi",
  },
};

const SELLER_WORDS: Record<Locale, { title: string; reply: string; open: string; note: string }> = {
  ru: {
    title: "Проверьте диалог",
    reply: "Можно ответить",
    open: "Открыть диалог",
    note: "Подсказка ИИ-наблюдателя: покупателю ничего не отправлено. Если вы уже ответили в Instagram — пропустите.",
  },
  kk: {
    title: "Диалогты тексеріңіз",
    reply: "Былай жауап беруге болады",
    open: "Диалогты ашу",
    note: "ИИ-бақылаушының кеңесі: сатып алушыға ештеңе жіберілген жоқ. Instagram-да жауап берген болсаңыз — өткізіп жіберіңіз.",
  },
  en: {
    title: "Check this conversation",
    reply: "Suggested reply",
    open: "Open conversation",
    note: "AI observer hint: nothing was sent to the buyer. If you've already replied in Instagram, skip this.",
  },
  uz: {
    title: "Suhbatni tekshiring",
    reply: "Shunday javob berish mumkin",
    open: "Suhbatni ochish",
    note: "AI kuzatuvchi maslahati: xaridorga hech narsa yuborilmadi. Instagram’da javob bergan bo‘lsangiz — o‘tkazib yuboring.",
  },
};

export function sellerSignalText(locale: Locale, f: Finding, who: string, link: string): string {
  const w = SELLER_WORDS[locale];
  return [
    `🔎 <b>${w.title}</b> · ${KIND_LABEL[locale][f.kind]}`,
    esc(who),
    f.quote ? `«${esc(f.quote)}»` : null,
    f.summary ? esc(f.summary) : null,
    f.reply ? `💬 <b>${w.reply}:</b>\n${esc(f.reply)}` : null,
    `<a href="${esc(link)}">${w.open}</a>`,
    `<i>${w.note}</i>`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Оператору — все находки «сбой платформы» прогона одним сообщением. */
export function operatorBugText(
  shop: string,
  items: Array<{ f: Finding; who: string }>,
  link: string,
): string {
  const body = items
    .map(
      ({ f, who }) =>
        `• ${esc(who)} — ${KIND_LABEL.ru[f.kind]}\n  «${esc(f.quote)}»\n  ${esc(f.summary)}`,
    )
    .join("\n");
  return `🔎 <b>Наблюдатель: похоже на сбой</b> · «${esc(shop)}»\n${body}\n<a href="${esc(link)}">Карточка клиента</a>`;
}

export function capAlertText(shop: string, usd: number, cap: number): string {
  return `🔎 <b>Наблюдатель остановлен до завтра</b> · «${esc(shop)}»\nРасход за день ${usd.toFixed(2)} $ при потолке ${cap.toFixed(2)} $. Потолок — ключ ${OBSERVER_CAP_KEY} или страница «Наблюдатель».`;
}
