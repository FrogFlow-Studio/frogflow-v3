import { previewReadonly } from "@/lib/preview";
import Anthropic from "@anthropic-ai/sdk";
import { env, envPresence } from "@/config/env";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import type { Locale } from "@/core/i18n/locale";
import { updateStateSection } from "@/core/customers/customers";
import {
  BURST,
  commitTurn,
  isStaleIncoming,
  joinTurn,
  releaseUnanswered,
  settleTurn,
  type InboxItem,
} from "./burst";
import { handoffSummary, sellerLocaleSafe } from "@/core/ai/seller-text";
import { offerForProductRow } from "@/core/offers/offers";
import { activePreorder, preordersFor } from "@/core/preorder/preorder";
import {
  buyerLocale,
  clarifyReply,
  dialogHandoffReply,
  handoffReply,
  leadDoneReply,
  priceUnsureReply,
  resetReply,
  unavailableReply,
} from "./messages";
import { getSettings, trySetSetting, updateSettingAtomic } from "@/core/settings/settings";
import { resolvePrice } from "@/core/pricing/pricing";
import { PRODUCT_SELECT, sortedVariants, type Product } from "@/core/catalog/catalog";
import { listCustomerOrderStatuses, type CustomerOrderStatus } from "@/core/orders/order-queries";
import { cancelCustomerOrder } from "@/core/orders/customer-cancel.server";
import { cancellationIntentMatchesOrder, isExplicitOrderCancellation } from "./order-cancel-intent";
import { isOrderStatusQuestion } from "./order-status-intent";
import { isConsultantVertical } from "@/core/verticals/registry";
import { parseKnowledge, retrieveKnowledge, type KnowledgeDoc } from "./knowledge";
import { parseProfile, type ConsultantProfile } from "./profile";
import { buildSystemPrompt, cleanReply, isResetIntent } from "./prompt";
import { checkReplyFacts, knownNumbers } from "./price-check";
import {
  CATALOG_TOOL_NAMES,
  CATALOG_TOOLS,
  catalogPromptSection,
  catalogSearchEnabled,
  loadCatalog,
  runCatalogTool,
} from "./catalog-tool.server";
import { pauseHours, pausedUntilIso } from "./pause";
import { takeAiCall } from "./rate.server";
import { modelParams } from "@/core/ai/pure";
import { serverFailure } from "@/lib/server-failure";
import {
  ASK_CONTACT_RESULT,
  formatProfile,
  isPurchaseHandoff,
  mergeProfile,
  parseProfile as parseMemory,
  phoneIn,
  REMEMBER_TOOL,
  type CustomerProfile,
} from "./memory";
import {
  budgetBlock,
  limitsFor,
  parseDaily,
  parseMonthly,
  reserveDaily,
  RESERVE_USD,
  settleRaw,
  startsNewDialog,
  today,
} from "./budget";

/**
 * ИИ-консультант: отвечает покупателю по профилю бизнеса, базе знаний и
 * каталогу; сложное передаёт менеджеру инструментом. Канала не знает —
 * адаптер присылает текст и отправляет ответ. Расход считается на клиента.
 */
export const KEYS = {
  enabled: "consultant_enabled",
  profile: "consultant_profile",
  knowledge: "consultant_knowledge",
  usage: "consultant_usage",
  daily: "consultant_daily",
  dialogs: "consultant_dialogs_month",
  lastError: "consultant_last_error",
} as const;

/**
 * Модель платформы. Sonnet 5 с 09.10.2026: на Haiku 4.5 BOVI до 25.09 ошибался
 * заметно чаще (выдуманные цены, лишние уточнения). Ход дороже вдвое ($2/$10).
 */
export const DEFAULT_MODEL = "claude-sonnet-5";
const TIMEOUT_MS = 20_000;
export const HISTORY_TURNS = 16;
/** Раундов с инструментами каталога на одно сообщение (v1: 4). */
export const MAX_ROUNDS = 4;
/**
 * Общий потолок времени всех вызовов модели на одно сообщение с поиском:
 * каждый вызов получает таймаут по остатку, меньше MIN_CALL_MS на вызов —
 * нового не начинаем, вопрос уходит менеджеру.
 */
export const ROUNDS_DEADLINE_MS = 35_000;
const MIN_CALL_MS = 3_000;
const CATALOG_LIMIT = 120;
/** Цены Haiku 4.5 за миллион токенов: ввод, вывод, запись в кеш, чтение из кеша. */
/**
 * Ставки Haiku 4.5, $ за миллион токенов. Кеш промпта держим час, как в v1
 * (fix «hold the cache for an hour»): покупатель отвечает через минуты, а не
 * секунды, и пятиминутный кеш остывал к следующему сообщению. Запись в
 * часовой кеш — вдвое дороже входа, чтение — десятая часть.
 */
export const CACHE_TTL = "1h" as const;
/**
 * cacheWrite — запись в часовой кеш (2× входа), cacheWrite5m — в пятиминутный
 * (1,25×): консультант по прайсу держит в нём хвост переписки
 * (pricelist/engine.server withTailCache).
 */
const PRICE = { in: 1, out: 5, cacheWrite: 2, cacheWrite5m: 1.25, cacheRead: 0.1 };
/**
 * Sonnet — консультант по прайсу может работать на нём (настройка consultant_model).
 * Sonnet 5 вдвое дешевле на вводе, чем Sonnet 4.x: $2/$10, часовой кеш $4,
 * чтение $0,20. По старой ставке ИИ-баланс клиента и дневной предел
 * списывались в 1,5 раза больше реального.
 */
const PRICE_SONNET_5 = { in: 2, out: 10, cacheWrite: 4, cacheWrite5m: 2.5, cacheRead: 0.2 };
const PRICE_SONNET_4 = { in: 3, out: 15, cacheWrite: 6, cacheWrite5m: 3.75, cacheRead: 0.3 };

/**
 * Записи в кеш из ответа API: всего и сколько из них — в пятиминутный.
 * Без разбивки (старые ответы, подставные в тестах) вся запись — часовая:
 * так списание не меньше реального.
 */
export function cacheWrites(usage: {
  cache_creation_input_tokens?: number | null;
  cache_creation?: { ephemeral_5m_input_tokens?: number | null } | null;
}): { total: number; fiveMin: number } {
  const total = usage.cache_creation_input_tokens ?? 0;
  const fiveMin = Math.min(total, usage.cache_creation?.ephemeral_5m_input_tokens ?? 0);
  return { total, fiveMin };
}

/**
 * Claude Haiku 5.5: $0,10/$0,50, кеш — запись 1,25× (5 мин) и 2× (час), чтение
 * 0,1×. Запрос длиннее 100 тыс. токенов — в пять раз дороже (PRICE_HAIKU_55_LONG).
 * Токенизатор новый: тот же текст — примерно на 30% больше токенов, чем у 4.5.
 */
const PRICE_HAIKU_55 = { in: 0.1, out: 0.5, cacheWrite: 0.2, cacheWrite5m: 0.125, cacheRead: 0.01 };
const PRICE_HAIKU_55_LONG = {
  in: 0.5,
  out: 2.5,
  cacheWrite: 1,
  cacheWrite5m: 0.625,
  cacheRead: 0.05,
};
/** Порог длинного запроса Haiku 5.5: вход вместе с кешем, токенов. */
const HAIKU_55_LONG_PROMPT = 100_000;

/**
 * Ставки модели, $ за миллион токенов; неизвестная — как Haiku 4.5.
 * `promptTokens` — вход запроса вместе с кешем (у Haiku 5.5 от него зависит ставка).
 */
export function modelPrice(model: string, promptTokens = 0): typeof PRICE {
  if (/sonnet-5/.test(model)) return PRICE_SONNET_5;
  if (/sonnet/.test(model)) return PRICE_SONNET_4;
  if (/haiku-5/.test(model))
    return promptTokens > HAIKU_55_LONG_PROMPT ? PRICE_HAIKU_55_LONG : PRICE_HAIKU_55;
  return PRICE;
}

/** Цена одного вызова модели по его usage, $. */
export function callUsd(
  model: string,
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
    cache_creation?: { ephemeral_5m_input_tokens?: number | null } | null;
  },
): number {
  const writes = cacheWrites(usage);
  const read = usage.cache_read_input_tokens ?? 0;
  const price = modelPrice(model, usage.input_tokens + writes.total + read);
  return (
    (usage.input_tokens * price.in +
      (writes.total - writes.fiveMin) * price.cacheWrite +
      writes.fiveMin * price.cacheWrite5m +
      read * price.cacheRead +
      usage.output_tokens * price.out) /
    1_000_000
  );
}

/**
 * Вызовов модели на одно сообщение консультанта по прайсу, на которые
 * бронируется бюджет: четыре раунда, переспрос о рублях, два на сверку
 * черновика и последний без инструментов.
 */
const PRICELIST_RESERVE_CALLS = 8;

export type ConsultantTurn = { role: "customer" | "assistant"; text: string };

const EXPLICIT_ORDER_INTENT =
  /(?<![\p{L}\p{N}])(?:беру|бер(?:е|ё)м|покупаю|куплю|заказываю|закажите(?:\s+мне)?|хочу\s+(?:купить|заказать|оформить)|давайте\s+(?:купим|закажем|оформим)|оформля(?:ю|ем|йте|й)|оформите\s+заказ|подтверждаю\s+(?:заказ|покупку)|сатып\s+ал(?:амын|ғым\s+келеді)|тапсырыс\s+бер(?:емін|ейік)|рәсімде(?:йік|ңіз|ймін))(?=$|[^\p{L}\p{N}])/iu;
const ORDER_WORDS =
  /(?:оформ\w*|заказ\w*|закаж\w*|куп\w*|покуп\w*|бер[её]м\w*|бер[её]те|сатып\s+ал\w*|тапсырыс)/iu;
const SHORT_AFFIRMATIVE =
  /^(?:да|ага|угу|ок(?:ей)?|конечно|согласен|согласна|давайте|иә|ия|жарайды|мақұл|yes|yep|sure)[.!]?$/iu;
const SELECTION_QUESTION =
  /(?:какой|какая|какое|какие|какую)[\s\S]{0,120}(?:нуж\p{L}*|выбира\p{L}*|выбер\p{L}*|актуаль\p{L}*|оформ\p{L}*|бер[её]\p{L}*)/iu;
const CONTEXTUAL_SELECTION_PREFIX =
  /^(?:а\s*)?(?:можно\s+(?:мне|нам)|мне\s+(?:нужен|нужна|нужно|нужны))\s+/iu;
const NON_PRODUCT_REQUEST =
  /подробн\p{L}*|описан\p{L}*|информац\p{L}*|состав\p{L}*|фото|пример\p{L}*|список|узна\p{L}*|посмотр\p{L}*|показ\p{L}*|рассказ\p{L}*|доставк\p{L}*|оплат\p{L}*|ссылк\p{L}*|чек|адрес\p{L}*|телефон\p{L}*|стоимост\p{L}*|цен\p{L}*|сравн\p{L}*|объясн\p{L}*|поясн\p{L}*/iu;
const GENERIC_SELECTION_WORDS = new Set([
  "а",
  "для",
  "из",
  "на",
  "в",
  "и",
  "или",
  "мне",
  "нам",
  "папка",
  "папки",
  "папку",
  "папке",
  "товар",
  "товара",
  "вариант",
  "варианта",
  "нужен",
  "нужна",
  "нужно",
  "нужны",
]);

/**
 * Согласие на покупку берём только из текущей реплики либо из короткого
 * утвердительного ответа на последний прямой вопрос об оформлении.
 */
export function confirmedOrderIntent(
  text: string,
  recent: readonly ConsultantTurn[] = [],
): boolean {
  const current = text.trim();
  if (
    !current ||
    /^(?:нет|не|не надо|не хочу|передумал(?:а)?|отмена|отмените)[.!]?$/iu.test(current)
  )
    return false;
  if (EXPLICIT_ORDER_INTENT.test(current)) return true;
  const last = recent.at(-1);
  const prefix = CONTEXTUAL_SELECTION_PREFIX.exec(current)?.[0];
  if (
    last?.role === "assistant" &&
    SELECTION_QUESTION.test(last.text) &&
    prefix &&
    !NON_PRODUCT_REQUEST.test(current)
  ) {
    const words = (value: string) =>
      (
        value
          .toLowerCase()
          .replace(/ё/g, "е")
          .match(/[\p{L}\p{N}]+/gu) ?? []
      ).filter((word) => !GENERIC_SELECTION_WORDS.has(word));
    const requested = words(current.slice(prefix.length));
    const offered = words(last.text);
    const matchesOffered = (word: string) =>
      offered.some(
        (known) =>
          word === known ||
          (word.length >= 4 && known.startsWith(word.slice(0, 4))) ||
          (known.length >= 4 && word.startsWith(known.slice(0, 4))),
      );
    if (requested.length > 0 && requested.some(matchesOffered)) return true;
  }
  if (!SHORT_AFFIRMATIVE.test(current)) return false;
  return Boolean(
    last?.role === "assistant" && last.text.includes("?") && ORDER_WORDS.test(last.text),
  );
}

function orderNotCreatedReply(locale: string): string {
  if (locale === "kk")
    return "Тапсырыс әзірге рәсімделмеді. Тауар туралы нақты нені білгіңіз келеді?";
  if (locale === "en")
    return "I haven't placed an order. What would you like to know about the product?";
  return "Пока заказ не оформлен. Что именно вы хотели узнать о товаре?";
}

function orderLeadNotCreatedReply(locale: string): string {
  if (locale === "kk")
    return "Тапсырыс әзірге рәсімделмеді және менеджерге берілген жоқ. Оны осы чатта рәсімдейік пе?";
  if (locale === "en")
    return "The order hasn't been placed or sent to a manager. Would you like me to place it here in the chat?";
  return "Заказ пока не оформлен и менеджеру не передан. Оформить его прямо здесь, в чате?";
}

function paymentNotCreatedReply(locale: string): string {
  if (locale === "kk")
    return "Бұл чат күйінде төлемге байланыстырылған тапсырыс көрінбейді. Әзірге ақша жібермеңіз және чек жолдамаңыз; алдымен тауарды нақтылап, тапсырысты рәсімдейік.";
  if (locale === "en")
    return "I can't see an order linked to this payment in the chat state. Please don't pay or send a receipt yet; let's confirm the item and place the order first.";
  if (locale === "uz")
    return "Bu suhbat holatida to‘lovga bog‘langan buyurtmani ko‘rmayapman. Hozircha pul yubormang va chek jo‘natmang; avval mahsulotni aniqlab, buyurtmani rasmiylashtiraylik.";
  return "Я не вижу в состоянии чата заказа, привязанного к оплате. Не отправляйте деньги или чек; сначала уточним товар и оформим заказ.";
}

function paymentOrderPendingReply(locale: string): string {
  if (locale === "kk")
    return "Алдымен тапсырыстың рәсімделгені, сомасы және төлем тәсілі көрсетілген хабарламаны күтіңіз; оған дейін ақша жібермеңіз және чек жолдамаңыз.";
  if (locale === "en")
    return "Please wait for the order confirmation with its amount and payment method before paying or sending a receipt.";
  if (locale === "uz")
    return "Avval buyurtma tasdig‘i, summasi va to‘lov usuli ko‘rsatilgan xabarni kuting; ungacha pul yubormang va chek jo‘natmang.";
  return "Сначала дождитесь сообщения с оформленным заказом, суммой и способом оплаты; до этого не отправляйте деньги или чек.";
}

function cancellationNotConfirmedReply(locale: string, handedOff: boolean): string {
  if (handedOff) {
    if (locale === "kk")
      return "Өтінішіңізді менеджерге жібердім. Тапсырыс күйі өзгерген жоқ; растауын күтіңіз.";
    if (locale === "en")
      return "I've passed your request to the manager. The order status hasn't changed; please wait for confirmation.";
    if (locale === "uz")
      return "So‘rovingizni menejerga yubordim. Buyurtma holati o‘zgarmadi; tasdiqni kuting.";
    return "Передал просьбу менеджеру. Статус заказа не изменён; дождитесь подтверждения.";
  }
  if (locale === "kk")
    return "Тапсырыс күйінің өзгергенін растай алмаймын. Жабылды деп есептемей тұрып, сатушыға хабарласыңыз.";
  if (locale === "en")
    return "I can't confirm that the order status has changed. Please contact the seller before treating it as closed.";
  if (locale === "uz")
    return "Buyurtma holati o‘zgarganini tasdiqlay olmayman. Yopildi deb hisoblashdan oldin sotuvchiga murojaat qiling.";
  return "Не могу подтвердить изменение статуса заказа. Свяжитесь с продавцом, прежде чем считать заказ закрытым.";
}

const SHOP_ORDER_PROMISE =
  /(?:(?<![\p{L}\p{N}])(?:оформ|созда|запис)\p{L}*\s+(?:вам\s+)?(?:к\s+)?(?:заказ\p{L}*|покупк\p{L}*)|(?<![\p{L}\p{N}])(?:заказ\p{L}*|покупк\p{L}*)\s+(?:уже\s+)?(?:оформлен\p{L}*|создан\p{L}*)|(?<![\p{L}\p{N}])(?:детал\p{L}*(?:\s+и\s+оплат\p{L}*)?|сч[её]т\p{L}*|ссылк\p{L}*)\s+(?:сейчас\s+)?(?:появ\p{L}*|отправ\p{L}*|пришл\p{L}*|сформир\p{L}*)|(?<![\p{L}\p{N}])оплат\p{L}*\s+(?:сейчас\s+)?(?:появ\p{L}*|сформир\p{L}*))/iu;

const SHOP_CANCELLATION_PROMISE =
  /(?:(?<![\p{L}\p{N}])(?:отменяю|отменяем|отменим|отменю|отменит|отменят|отменил(?:а|и|о)?|аннулирую|аннулируем|аннулирует|аннулировал(?:а|и|о)?|cancel(?:l?ed|l?ing)|will\s+cancel|bekor\s+qil\p{L}*|жой\p{L}*|болдырм\p{L}*)(?![\p{L}\p{N}])|(?:заказ|order|buyurtma|тапсырыс)[^.!?\n]{0,40}(?:отменен|отменён|аннулирован|cancelled|canceled|bekor|жой|болдырм))/iu;

const SHOP_UNTRACKED_PAYMENT_PROMISE =
  /(?:(?:оплат\p{L}*|pay\p{L}*|төле\p{L}*|төлем\p{L}*|to['’‘]?lov\p{L}*|tolov\p{L}*)[^.!?\n]{0,100}(?:чек\p{L}*|квитанц\p{L}*|скрин\p{L}*|receipt|screenshot|chek)|(?:материал\p{L}*|файл\p{L}*|доступ\p{L}*|materials?|files?|access|material\p{L}*|fayl\p{L}*|kirish\p{L}*)[^.!?\n]{0,100}(?:чек\p{L}*|оплат\p{L}*|төлем\p{L}*|to['’‘]?lov\p{L}*|tolov\p{L}*|receipt|payment|chek))/iu;

/** Не отправляем покупателю неподтверждённое обещание заказа из shop-in-chat. */
export function guardShopOrderReply(
  reply: string,
  locale: Locale,
  result: {
    orderAction?: boolean;
    handoff?: Handoff | null;
    hasActivePaymentOrder?: boolean;
    verifiedOrderStatus?: boolean;
  },
): string {
  if (SHOP_CANCELLATION_PROMISE.test(reply) && !result.verifiedOrderStatus)
    return cancellationNotConfirmedReply(locale, Boolean(result.handoff));
  const orderPromise = SHOP_ORDER_PROMISE.test(reply);
  const paymentPromise =
    !result.hasActivePaymentOrder && SHOP_UNTRACKED_PAYMENT_PROMISE.test(reply);
  if ((!orderPromise || result.orderAction) && !paymentPromise) return reply;
  if (result.handoff)
    return result.handoff.kind === "lead" ? leadDoneReply(locale) : dialogHandoffReply(locale);
  if (paymentPromise)
    return result.orderAction ? paymentOrderPendingReply(locale) : paymentNotCreatedReply(locale);
  return result.orderAction ? reply : orderNotCreatedReply(locale);
}

export type ConsultantState = {
  recent?: ConsultantTurn[];
  paused_until?: string;
  contact?: string;
  last_reply_at?: string;
  /** Что покупатель уже сказал (core/consultant/memory) — расширенный режим. */
  profile?: CustomerProfile;
  /** Телефон перед покупкой уже спрашивали — второй раз не спрашиваем. */
  contact_asked?: boolean;
  /** Когда человек вернул диалог боту — проверка менеджера не смотрит раньше. */
  resumed_at?: string;
  /** Ответы менеджера, пересланные из Telegram (core/consultant/relay), — последние 10. */
  relayed?: string[];
  /** Консультант по прайсу: покупатель смотрит цены в рублях (переводит код). */
  rub?: boolean;
  /** Консультант по прайсу: файлы фотобазы, которые покупатель уже получил. */
  media_sent?: string[];
  /** Консультант по прайсу: товары последних ответов — для «а другой цвет?». */
  last_product_ids?: string[];
  /** Напоминание замолчавшему покупателю уже ушло после ответа с этим временем. */
  followup_for?: string;
  /**
   * Товар последней кнопки «Купить» (offer_buy_button): WhatsApp иногда
   * присылает нажатие без нашего payload («0») — тогда заказ по этой записи.
   */
  buy_offer?: { productId: string; variantId?: string };
  /** Имена v1 у диалогов BOVI, начатых до переезда (читаются, не пишутся). */
  v2_profile?: CustomerProfile;
  v2_rub?: boolean;
  v2_contact_asked?: boolean;
  v2_media_sent?: string[];
};

export type Handoff = {
  kind: "handoff" | "lead";
  reason: string;
  customerName?: string;
  customerContact?: string;
  summary: string;
};

export type ConsultantOrderAction = {
  productId?: string;
  productName?: string;
  variantId?: string;
  variantName?: string;
  quantity?: number;
  /** Остальные позиции той же покупки («5, 6 и 7 классы» — одним заказом). */
  extra?: ConsultantOrderAction[];
};

export type ConsultantResult = {
  reply: string;
  handoff: Handoff | null;
  /** Действие по заказу товара прямо из чата (order_product). */
  orderAction?: ConsultantOrderAction | null;
  /**
   * Кнопка «Купить» под ответом (offer_buy_button): товар, на который
   * покупатель смотрит. Канал проверяет товар и вариант по каталогу сам.
   */
  buyOffer?: { productId: string; variantId?: string } | null;
  /** Статусный ответ сформирован сервером по read-only записи заказа. */
  verifiedOrderStatus?: boolean;
  /** Внутренний id заказа, который инструмент отмены подтвердил или отменил. */
  cancelledOrderId?: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    usd: number;
    cacheWriteTokens?: number;
    cacheReadTokens?: number;
  };
  /** Модель ответа — для журнала ответов (core/consultant/runs). */
  model?: string;
  /** Курс рубля, по которому консультант по прайсу считал цены. */
  rate?: { value: number; updatedAt: string; source: string | null } | null;
  /**
   * Что делал консультант по порядку: имена вызванных инструментов, а также
   * `ask_contact` (спросил телефон вместо передачи). Для журнала ответов в
   * каналах.
   */
  tools?: string[];
  /** Фото и видео товара к ответу (консультант по прайсу, send_product_photo). */
  attachments?: { url: string; kind: "image" | "video" }[];
  /** Тест-чат с историей: состояние пробного диалога после хода (без `recent`). */
  testState?: ConsultantState;
  /**
   * Отвечать не нужно (core/consultant/burst): folded — сообщение вошло в
   * соседний ход и ответ на него уходит там; busy — прежнее значение (не
   * дождались чужого хода), теперь такой ход передаёт диалог менеджеру; paused — пока ждали, соседний ход передал
   * диалог менеджеру; stale — сообщение доставлено с опозданием. Реплика
   * покупателя в истории диалога в любом случае.
   */
  skipped?: "folded" | "busy" | "paused" | "stale";
};

export function consultantConfigured(): boolean {
  return envPresence().has("ANTHROPIC_API_KEY");
}

/** Включён ли консультант у клиента: явный тумблер, а для ниш-консультантов — по умолчанию. */
export async function consultantEnabled(ctx: TenantContext): Promise<boolean> {
  if (!consultantConfigured()) return false;
  const s = await getSettings(ctx, [KEYS.enabled]);
  const v = s[KEYS.enabled];
  if (v === "true") return true;
  if (v === "false") return false;
  return isConsultantVertical(ctx.tenant.vertical);
}

export async function loadConsultant(
  ctx: TenantContext,
): Promise<{ profile: ConsultantProfile; docs: KnowledgeDoc[]; enabled: boolean }> {
  const s = await getSettings(ctx, [KEYS.profile, KEYS.knowledge, KEYS.enabled, "shop_name"]);
  const v = s[KEYS.enabled];
  // Условия оплаты и доставки — только из анкеты продавца: подставленные по
  // умолчанию («материалы электронные», «Kaspi») были условиями одной Копилки и
  // врали бы магазину с доставкой (решение Якова 25.10). Пусто — модель не знает.
  const profile = parseProfile(s[KEYS.profile], s.shop_name ?? ctx.tenant.name);
  return {
    profile,
    docs: parseKnowledge(s[KEYS.knowledge]),
    enabled:
      v === "true" ? true : v === "false" ? false : isConsultantVertical(ctx.tenant.vertical),
  };
}

/** «30.09 23:59» в часовом поясе магазина — срок акции для подсказки модели. */
function untilText(iso: string, timeZone: string | undefined): string {
  return new Date(iso).toLocaleString("ru-RU", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Каталог одной строкой на товар — наличие и цены только отсюда. */
/** Каталог для подсказки и цены из него — для сверки ответа (price-check). */
async function catalogSnippet(ctx: TenantContext): Promise<{ text: string; prices: number[] }> {
  const { data } = await ctx.db
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("is_active", true)
    .order("sort_order")
    .limit(CATALOG_LIMIT);
  const rows = (data ?? []) as Product[];
  const preorders = await preordersFor(
    ctx,
    rows.map((p) => p.id),
  );
  const prices: number[] = [];
  const lines = await Promise.all(
    rows.map(async (p) => {
      const variants = sortedVariants(p);
      const priced = variants.length
        ? await Promise.all(
            variants.map(async (v) => ({ v, m: await resolvePrice(ctx, p, null, v) })),
          )
        : [];
      const base = await resolvePrice(ctx, p, null);
      prices.push(base.amount, ...priced.map(({ m }) => m.amount));
      const price = priced.length
        ? priced.map(({ v, m }) => `${v.name} — ${m.amount} ${m.currency}`).join(", ")
        : `${base.amount} ${base.currency}`;
      const pre = activePreorder(ctx, p, preorders.get(p.id));
      const stock = !ctx.tenant.modules.stock
        ? ""
        : pre
          ? `, предзаказ: сейчас нет на складе, ${pre.from ? `отправка с ${pre.from}` : "срок отправки уточнит менеджер"}`
          : p.stock_quantity != null
            ? p.stock_quantity > 0
              ? `, в наличии ${p.stock_quantity}`
              : ", нет в наличии"
            : "";
      const offer = await offerForProductRow(ctx, p);
      const promo = offer
        ? `, по акции −${offer.percent}% до ${untilText(offer.ends_at, ctx.timezone)}${offer.left != null ? `, осталось ${offer.left} шт.` : ""}`
        : "";
      const desc = (p.description ?? "").replace(/\s+/g, " ").slice(0, 160);
      return `- [id:${p.id}] ${p.name}: ${price}${promo}${stock}${desc ? `. ${desc}` : ""}`;
    }),
  );
  return { text: lines.join("\n"), prices };
}

const ORDER_STATUS_TOOL: Anthropic.Tool = {
  name: "get_my_order_status",
  description:
    "Проверить текущий статус последних заказов только покупателя из этого диалога. Вызывайте перед ответом на вопрос, отменён ли, оплачен ли, где или в каком статусе заказ. Ничего не меняет.",
  input_schema: { type: "object", properties: {} },
};

const ORDER_CANCEL_TOOL: Anthropic.Tool = {
  name: "cancel_my_order",
  description:
    "Отменить конкретный заказ покупателя. Вызывайте только после явной просьбы покупателя отменить заказ и когда он назвал номер; не используйте для вопроса «как отменить?» или проверки статуса. Если номера ещё нет — сначала спросите. Сервер отменяет только неоплаченный заказ этого покупателя в статусе awaiting_payment; при любом другом статусе ничего не меняется.",
  input_schema: {
    type: "object",
    properties: {
      order_number: {
        type: "integer",
        minimum: 1,
        description: "Номер заказа, видимый покупателю",
      },
    },
    required: ["order_number"],
  },
};

const ORDER_STATUS_LABELS: Record<string, Partial<Record<Locale, string>>> = {
  awaiting_payment: {
    ru: "не отменён и ожидает оплаты",
    kk: "күші жойылмаған, төлемді күтуде",
    en: "hasn't been cancelled and is awaiting payment",
    uz: "bekor qilinmagan, to‘lov kutilmoqda",
  },
  awaiting_confirmation: {
    ru: "ожидает подтверждения оплаты",
    kk: "төлемнің расталуын күтуде",
    en: "is awaiting payment confirmation",
    uz: "to‘lov tasdiqlanishini kutmoqda",
  },
  paid: { ru: "оплачен", kk: "төленген", en: "is paid", uz: "to‘langan" },
  accepted: {
    ru: "принят в обработку",
    kk: "өңдеуге қабылданған",
    en: "has been accepted for processing",
    uz: "ishlovga qabul qilingan",
  },
  in_production: {
    ru: "готовится",
    kk: "дайындалып жатыр",
    en: "is being prepared",
    uz: "tayyorlanmoqda",
  },
  ready: {
    ru: "готов к выдаче",
    kk: "беруге дайын",
    en: "is ready for handoff",
    uz: "topshirishga tayyor",
  },
  delivering: {
    ru: "передан в доставку",
    kk: "жеткізуге берілген",
    en: "is out for delivery",
    uz: "yetkazib berishga topshirilgan",
  },
  delivered: { ru: "выдан", kk: "берілген", en: "has been delivered", uz: "topshirilgan" },
  cancelled: { ru: "отменён", kk: "күші жойылған", en: "has been cancelled", uz: "bekor qilingan" },
  rejected: { ru: "отклонён", kk: "қабылданбаған", en: "was rejected", uz: "rad etilgan" },
};

function verifiedOrderStatusReply(
  rows: CustomerOrderStatus[] | null,
  locale: Locale,
  lookupFailed = false,
): { reply: string; handoff?: Handoff } {
  const handoff = (summary: string): Handoff => ({
    kind: "handoff",
    reason: "unknown_question",
    summary,
  });
  if (lookupFailed || !rows || rows.length === 0) {
    const noData = lookupFailed
      ? {
          ru: "Не удалось проверить статус в системе. Передаю вопрос менеджеру.",
          kk: "Жүйеде мәртебені тексеру мүмкін болмады. Сұрағыңызды менеджерге жіберемін.",
          en: "I couldn't verify the status in the system. I'll pass this to a manager.",
          uz: "Tizimda holatni tekshira olmadim. Savolingizni menejerga yuboraman.",
        }
      : {
          ru: "Не нашёл заказа, привязанного к этому чату. Передаю вопрос менеджеру для проверки.",
          kk: "Бұл чатқа байланыстырылған тапсырысты таппадым. Тексеру үшін менеджерге жіберемін.",
          en: "I couldn't find an order linked to this chat. I'll pass this to a manager to check.",
          uz: "Bu chatga bog‘langan buyurtmani topmadim. Tekshirish uchun menejerga yuboraman.",
        };
    return {
      reply: noData[locale],
      handoff: handoff("Проверить статус заказа покупателя; в системе нет доступной записи."),
    };
  }

  const labeled = rows.map((row) => ({
    row,
    label: ORDER_STATUS_LABELS[row.status]?.[locale],
    number: row.display_no ?? row.order_no ?? row.id,
  }));
  if (labeled.some(({ label }) => !label)) {
    const texts = {
      ru: "Нашёл заказ, но не могу безопасно расшифровать его статус. Передаю вопрос менеджеру.",
      kk: "Тапсырыс табылды, бірақ мәртебесін нақты түсіндіру үшін менеджерге жіберемін.",
      en: "I found the order, but its status needs a manager's review. I'll pass this along.",
      uz: "Buyurtma topildi, ammo holatini aniqlashtirish uchun menejerga yuboraman.",
    };
    return { reply: texts[locale], handoff: handoff("Проверить неизвестный статус заказа.") };
  }

  if (labeled.length === 1) {
    const { number, label } = labeled[0]!;
    const texts = {
      ru: `По данным магазина, заказ №${number} ${label}.`,
      kk: `Дүкен дерегі бойынша, №${number} тапсырыс ${label}.`,
      en: `According to the store, order #${number} ${label}.`,
      uz: `Do‘kon ma’lumotiga ko‘ra, №${number} buyurtma ${label}.`,
    };
    return { reply: texts[locale] };
  }

  const items = labeled
    .slice(0, 5)
    .map(({ number, label }) => `№${number} — ${label}`)
    .join("; ");
  const multiple = {
    ru: `Нашёл несколько заказов: ${items}. Уточните, о каком заказе вы спрашиваете.`,
    kk: `Бірнеше тапсырыс бар: ${items}. Қайсысын сұрап тұрғаныңызды нақтылаңыз.`,
    en: `I found several orders: ${items}. Which one do you mean?`,
    uz: `Bir nechta buyurtma topildi: ${items}. Qaysi birini nazarda tutyapsiz?`,
  };
  return { reply: multiple[locale] };
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: "handoff_to_manager",
    description:
      "Передать диалог живому менеджеру: клиент просит человека, жалуется, задаёт вопрос вне базы знаний и каталога, или в сервисном сценарии готов завершить сделку. В магазине в чате не передавайте покупку с reason=purchase — используйте order_product после подтверждения клиента.",
    input_schema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          enum: [
            "purchase",
            "book_call",
            "booking",
            "human_requested",
            "complaint",
            "unknown_question",
          ],
        },
        customer_name: { type: "string" },
        customer_contact: {
          type: "string",
          description: "Телефон или другой контакт, если клиент дал",
        },
        summary: { type: "string", description: "Суть запроса и договорённостей, 1–3 предложения" },
      },
      required: ["reason", "summary"],
    },
  },
  {
    name: "record_order_lead",
    description:
      "Зафиксировать заказ, запись или заявку на звонок, когда параметры и контакт клиента известны.",
    input_schema: {
      type: "object",
      properties: {
        lead_type: { type: "string", enum: ["order", "call", "booking"] },
        customer_name: { type: "string" },
        customer_contact: { type: "string" },
        details: {
          type: "string",
          description: "Товары и количество, повод, дата, время — всё, что нужно менеджеру",
        },
      },
      required: ["lead_type", "details"],
    },
  },
];

export const OFFER_BUY_TOOL: Anthropic.Tool = {
  name: "offer_buy_button",
  description:
    "Поставить под вашим ответом кнопку «Купить» для одного товара из каталога. Вызывайте, когда покупатель интересуется конкретным товаром (спросил о нём, о цене, выбрал вариант), но покупку ещё не подтвердил. Нажатие кнопки сразу оформит заказ и пришлёт оплату. Если у товара есть варианты, передайте variant_id выбранного варианта; пока вариант не выбран — не вызывайте, сначала уточните его.",
  input_schema: {
    type: "object",
    properties: {
      product_id: { type: "string", description: "ID товара из [id:...] каталога" },
      variant_id: {
        type: "string",
        description: "ID выбранного варианта, если у товара есть варианты",
      },
    },
    required: ["product_id"],
  },
};

export const ORDER_PRODUCT_TOOL: Anthropic.Tool = {
  name: "order_product",
  description:
    "Инициировать покупку/оформление заказа выбранного товара для покупателя прямо в чате. Вызывайте ТОЛЬКО когда клиент прямо подтвердил желание купить («да», «беру», «оформляем», «давайте», «хочу купить», «согласен», «заказываю» и т.п.) и товар понятен из контекста диалога или каталога.",
  input_schema: {
    type: "object",
    properties: {
      product_id: {
        type: "string",
        description: "ID товара (если указан в [id:...])",
      },
      product_name: {
        type: "string",
        description:
          "Название товара из каталога (например: Лестницы Части речи и члены предложения)",
      },
      variant_id: {
        type: "string",
        description:
          "ID конкретного варианта товара (если есть варианты, например 5 класс, 7 класс и т.д.)",
      },
      variant_name: {
        type: "string",
        description: "Название выбранного варианта (например: 7 класс)",
      },
      quantity: {
        type: "number",
        description: "Количество единиц товара (по умолчанию 1)",
      },
      items: {
        type: "array",
        description:
          "Ещё позиции в ТОЙ ЖЕ покупке, если клиент берёт несколько (например, сборники за 5, 6 и 7 классы: первая позиция — в полях выше, остальные — здесь). Заказ будет один на все позиции.",
        items: {
          type: "object",
          properties: {
            product_id: { type: "string" },
            product_name: { type: "string" },
            variant_id: { type: "string" },
            variant_name: { type: "string" },
            quantity: { type: "number" },
          },
        },
      },
    },
  },
};

/**
 * История диалога — отдельными сообщениями Anthropic, а не одной строкой.
 * Первой идёт реплика покупателя, соседние реплики одной роли склеиваются
 * (два сообщения покупателя подряд, пока бот молчал).
 */
export function buildConsultantMessages(
  recent: readonly ConsultantTurn[],
  incoming?: string,
): Array<{ role: "user" | "assistant"; content: string }> {
  const turns = recent.slice(-HISTORY_TURNS).map((t) => ({
    role: t.role === "customer" ? ("user" as const) : ("assistant" as const),
    content: t.text,
  }));
  if (incoming !== undefined) turns.push({ role: "user", content: incoming });
  const out: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const t of turns) {
    if (!t.content.trim()) continue;
    if (!out.length && t.role === "assistant") continue;
    const last = out[out.length - 1];
    if (last?.role === t.role) last.content = `${last.content}\n\n${t.content}`;
    else out.push({ ...t });
  }
  return out;
}

function stateOf(customer: Customer): ConsultantState {
  const s = customer.state.consultant;
  return s && typeof s === "object" && !Array.isArray(s) ? (s as ConsultantState) : {};
}

export function isPaused(customer: Customer, now = Date.now()): boolean {
  const until = stateOf(customer).paused_until;
  return Boolean(until) && new Date(until!).getTime() > now;
}

/**
 * Записать изменения поверх свежего состояния: пока модель думала, бот или
 * второе сообщение могли записать своё (core/customers updateStateSection).
 * Профиль покупателя сливается: новое поверх того, что узнали параллельно.
 */
async function saveState(ctx: TenantContext, customer: Customer, patch: Partial<ConsultantState>) {
  return updateStateSection(ctx, customer, "consultant", (current) => withPatch(current, patch));
}

function withPatch(
  current: Record<string, unknown>,
  patch: Partial<ConsultantState>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...current, ...patch };
  if (patch.profile) next.profile = { ...parseMemory(current.profile), ...patch.profile };
  return next;
}

const NO_USAGE = { inputTokens: 0, outputTokens: 0, usd: 0 };

/** Ход консультанта: аренда и сообщения очереди, которые он закрывает (core/consultant/burst). */
type OpenTurn = {
  id: string | null;
  items: Array<Pick<InboxItem, "id" | "text">>;
  closed: boolean;
};

/**
 * Продавец ответил сам или клиент ушёл к менеджеру — консультант молчит
 * столько, сколько выбрал продавец (core/consultant/pause, по умолчанию 6 ч, как в v1).
 */
export async function pauseConsultant(ctx: TenantContext, customer: Customer) {
  return saveState(ctx, customer, { paused_until: pausedUntilIso(pauseHours(ctx.tenant)) });
}

/** Заменить сохранённый ответ модели на фактический текст, если его вложение не доставлено. */
export async function replaceLastConsultantReply(
  ctx: TenantContext,
  customer: Customer,
  expectedReplies: string[],
  actualReply: string,
) {
  const expected = new Set(expectedReplies.map((reply) => reply.slice(0, 700)));
  if (!expected.size || !actualReply.trim()) return customer;
  return updateStateSection(ctx, customer, "consultant", (current) => {
    const recent = Array.isArray(current.recent) ? (current.recent as ConsultantTurn[]) : [];
    const last = recent.at(-1);
    if (!last || last.role !== "assistant" || !expected.has(last.text)) return current;
    return {
      ...current,
      recent: [...recent.slice(0, -1), { role: "assistant", text: actualReply.slice(0, 700) }],
    };
  });
}

/**
 * Менеджер ответил из Telegram на уведомление о передаче: пауза продлевается,
 * текст запоминается — проверка «менеджер в чате» не примет его за чужого.
 */
export async function recordRelayedReply(ctx: TenantContext, customer: Customer, text: string) {
  const prev = stateOf(customer).relayed ?? [];
  return saveState(ctx, customer, {
    paused_until: pausedUntilIso(pauseHours(ctx.tenant)),
    relayed: [...prev, text].slice(-10),
  });
}

export async function resumeConsultant(ctx: TenantContext, customer: Customer) {
  return saveState(ctx, customer, {
    paused_until: undefined,
    resumed_at: new Date().toISOString(),
    recent: [],
    profile: undefined,
    contact_asked: undefined,
    rub: undefined,
    media_sent: undefined,
    last_product_ids: undefined,
    v2_profile: undefined,
    v2_rub: undefined,
    v2_contact_asked: undefined,
    v2_media_sent: undefined,
  });
}

async function recordUsage(
  ctx: TenantContext,
  usd: number,
  inputTokens: number,
  outputTokens: number,
) {
  const s = await getSettings(ctx, [KEYS.usage]);
  let prev = { count: 0, inputTokens: 0, outputTokens: 0, usd: 0 };
  try {
    prev = { ...prev, ...(JSON.parse(s[KEYS.usage] || "{}") as object) };
  } catch {
    /* пустое значение */
  }
  await trySetSetting(
    ctx,
    KEYS.usage,
    JSON.stringify({
      count: prev.count + 1,
      inputTokens: prev.inputTokens + inputTokens,
      outputTokens: prev.outputTokens + outputTokens,
      usd: Math.round((prev.usd + usd) * 1_000_000) / 1_000_000,
    }),
  );
}

/**
 * Один ответ консультанта на сообщение покупателя. Историю держим в
 * bot_users.state.consultant; при handoff — пауза, дальше отвечает человек.
 * `dryRun` — проверка из админки: без истории и без записи состояния.
 */
export async function runConsultant(
  ctx: TenantContext,
  customer: Customer | null,
  text: string,
  opts: {
    platform: string;
    dryRun?: boolean;
    /** Ответ на сторис/рилс — консультант узнаёт товар по тегу продавца. */
    story?: { storyId: string | null; mediaUrl: string | null; caption?: string | null };
    /** Фото покупателя: ссылки (директ) или уже скачанные (Telegram) — консультант по прайсу. */
    imageUrls?: string[];
    images?: import("./pricelist/images").V2Image[];
    /** В этом канале включён магазин в переписке: покупку оформляет бот, не менеджер. */
    shopInChat?: boolean;
    /** Канал умеет ставить кнопку «Купить» под ответом (настройка канала buy_button). */
    buyButton?: boolean;
    /** Id входящего (Meta, Telegram) — повтор доставки не встаёт в очередь диалога второй раз. */
    messageId?: string | null;
    /** Когда покупатель написал (часы канала, ISO): старое сообщение не отвечается. */
    sentAt?: string | null;
    /**
     * Тест-чат админки с историей (только `dryRun` без покупателя): состояние
     * пробного диалога живёт в браузере продавца и приходит с каждым вопросом.
     * В базу ничего не пишется.
     */
    testState?: ConsultantState;
  } = { platform: "telegram" },
): Promise<ConsultantResult | null> {
  // Предпросмотр: до брони ИИ-баланса и до клиента — как «ИИ недоступен».
  if (previewReadonly()) return null;
  const bLocale = buyerLocale(ctx, customer);
  const apiKey = env().ANTHROPIC_API_KEY?.trim();
  const { pricelistMode } = await import("./pricelist/mode");
  const pricelist = pricelistMode(ctx.tenant);
  const photos = (opts.imageUrls?.length ?? 0) + (opts.images?.length ?? 0) > 0;
  let incoming = text.trim().slice(0, 1500);
  // По прайсу фото без подписи — тоже вопрос: модель смотрит на снимок.
  if (!incoming && !(pricelist && photos)) return null;
  // Ключа ИИ платформы нет: покупатель не остаётся в тишине — «сейчас не могу
  // ответить» и передача менеджеру. Оператору сигнал шлёт крон здоровья
  // (operator/consultant-alerts, «no_key»). Тест-чат — как «ИИ недоступен».
  if (!apiKey) {
    if (opts.dryRun) return null;
    await trySetSetting(
      ctx,
      KEYS.lastError,
      `${new Date().toISOString()} — нет ключа ИИ платформы; вопрос передан менеджеру`,
    );
    return {
      reply: unavailableReply(bLocale),
      handoff: {
        kind: "handoff",
        reason: "unknown_question",
        summary: handoffSummary(await sellerLocaleSafe(ctx), "failure", incoming),
      },
      usage: { inputTokens: 0, outputTokens: 0, usd: 0 },
    };
  }
  // По прайсу товары публикации приходят пометкой (pricelist/engine.server).
  if (!pricelist && opts.story && (opts.story.storyId || opts.story.mediaUrl)) {
    const { findStoryTag, listStoryTags, storyContextLine } = await import("./story-tags");
    const tag = findStoryTag(await listStoryTags(ctx), opts.story.storyId, opts.story.mediaUrl);
    incoming = `${storyContextLine(tag, opts.story.storyId, opts.story.caption)}\n\n${incoming}`;
  }

  const live = Boolean(customer) && !opts.dryRun;
  // Доставлено с опозданием (Zernio повторяет вебхук часами): не отвечаем как
  // на свежее, но реплику — в историю, чтобы следующий вопрос её видел.
  if (customer && live && isStaleIncoming(opts.sentAt)) {
    await commitTurn(ctx, customer, {
      turnId: null,
      items: [{ id: opts.messageId || "stale", text: incoming }],
      historyTurns: HISTORY_TURNS,
    });
    return { reply: "", handoff: null, usage: NO_USAGE, skipped: "stale" };
  }

  const { profile, docs } = await loadConsultant(ctx);
  const state = customer ? stateOf(customer) : opts.dryRun ? (opts.testState ?? {}) : {};

  if (customer && !opts.dryRun && isResetIntent(incoming)) {
    await resumeConsultant(ctx, customer);
    return {
      reply: resetReply(bLocale, pricelist ? undefined : profile.brand_name),
      handoff: null,
      usage: { inputTokens: 0, outputTokens: 0, usd: 0 },
    };
  }
  // Попытка взломать подсказку — менеджеру, модель её не видит (v1 BOVI).
  if (pricelist) {
    const { looksLikePromptInjection } = await import("./pricelist/finalize");
    if (looksLikePromptInjection(incoming)) {
      if (customer && !opts.dryRun)
        await saveState(ctx, customer, { paused_until: pausedUntilIso(pauseHours(ctx.tenant)) });
      return {
        reply: handoffReply(bLocale),
        handoff: {
          kind: "handoff",
          reason: "injection",
          summary: handoffSummary(await sellerLocaleSafe(ctx), "injection", incoming),
        },
        usage: { inputTokens: 0, outputTokens: 0, usd: 0 },
      };
    }
  }

  const answer = (
    c: Customer | null,
    a: { incoming: string; state: ConsultantState },
    turn: OpenTurn | null,
    imageUrls = opts.imageUrls,
  ) =>
    answerConsultant(
      ctx,
      c,
      { ...opts, imageUrls },
      { ...a, bLocale, apiKey, pricelist, profile, docs, turn },
    );
  if (!customer || !live) return answer(customer, { incoming, state }, null);

  // Один ход на диалог: сообщение встаёт в очередь, ход идёт под арендой (core/consultant/burst).
  // Фото по ссылке может ответить любой ход — ссылки едут в очереди; публикацию
  // и уже скачанные фото Telegram — только своя функция.
  const own = Boolean(opts.images?.length) || Boolean(opts.story?.storyId || opts.story?.mediaUrl);
  const joinedAt = Date.now();
  const joined = await joinTurn(ctx, customer, {
    id: opts.messageId,
    text: incoming,
    own,
    images: opts.imageUrls,
  });
  if (!joined.lead && joined.why === "busy") {
    // Чужой ход завис дольше ожидания: молча ждать следующего сообщения
    // покупателя нельзя — его может не быть. Реплика — в историю, диалог —
    // менеджеру с задачей (пауза, как у любой передачи).
    const mine = await releaseUnanswered(
      ctx,
      customer,
      { id: joined.ownId, text: incoming },
      HISTORY_TURNS,
      (cur) => withPatch(cur, { paused_until: pausedUntilIso(pauseHours(ctx.tenant)) }),
    );
    // Пока писали, чужой ход всё же взял сообщение — ответ уйдёт там.
    if (!mine) return { reply: "", handoff: null, usage: NO_USAGE, skipped: "folded" };
    return {
      reply: handoffReply(bLocale),
      handoff: {
        kind: "handoff",
        reason: "unknown_question",
        summary: handoffSummary(await sellerLocaleSafe(ctx), "busy", incoming),
      },
      usage: NO_USAGE,
    };
  }
  if (!joined.lead) return { reply: "", handoff: null, usage: NO_USAGE, skipped: joined.why };
  // Фото приходят пачкой (вебхук на каждое фото с разрывом до 12 с, подпись —
  // ещё одним): ход с фото ждёт тишины и отвечает на всю пачку одним
  // сообщением. Ожидание кончается до того, как ход (аренда) перестал бы
  // укладываться в функцию: за чужим ходом сообщение уже могло ждать.
  const settled = photos
    ? await settleTurn(ctx, joined, {
        quietMs: opts.imageUrls?.length
          ? BURST.settleMs
          : Math.min(BURST.settleMs, BURST.settleShortMs),
        until: joinedAt + BURST.budgetMs - BURST.leaseMs,
      }).catch((e: unknown) => {
        console.error(`[consultant:${ctx.tenant.id}] очередь диалога не перечитана`, e);
        return joined;
      })
    : joined;
  const fresh = settled.customer;
  const turn: OpenTurn = { id: settled.turnId, items: settled.items, closed: false };
  try {
    // Пока ждали, соседний ход передал диалог менеджеру — молчим, реплики в историю.
    if (isPaused(fresh)) return { reply: "", handoff: null, usage: NO_USAGE, skipped: "paused" };
    // Своё сообщение — целиком (с пометкой публикации), соседей — из очереди.
    const together = settled.items
      .map((i) => (i.id === settled.ownId ? incoming : i.text))
      .filter((t) => t.trim())
      .join("\n\n");
    // Фото всех сообщений хода: свои — как пришли, соседей — ссылками из очереди.
    const imageUrls = settled.items.flatMap((i) =>
      i.id === settled.ownId ? (opts.imageUrls ?? []) : (i.images ?? []),
    );
    return await answer(
      fresh,
      { incoming: together || incoming, state: stateOf(fresh) },
      turn,
      imageUrls.length ? imageUrls : undefined,
    );
  } finally {
    // Ход закрылся без ответа модели (предел, сбой): реплики — в историю, аренда — соседям.
    if (!turn.closed)
      await commitTurn(ctx, fresh, {
        turnId: turn.id,
        items: turn.items,
        historyTurns: HISTORY_TURNS,
      }).catch((e: unknown) =>
        console.error(`[consultant:${ctx.tenant.id}] ход диалога не закрыт`, e),
      );
  }
}

/** Ответ консультанта после очереди диалога: бюджет, модель, расход и история. */
async function answerConsultant(
  ctx: TenantContext,
  customer: Customer | null,
  opts: Parameters<typeof runConsultant>[3] & { platform: string },
  a: {
    incoming: string;
    state: ConsultantState;
    bLocale: ReturnType<typeof buyerLocale>;
    apiKey: string;
    pricelist: boolean;
    profile: Awaited<ReturnType<typeof loadConsultant>>["profile"];
    docs: Awaited<ReturnType<typeof loadConsultant>>["docs"];
    turn: OpenTurn | null;
  },
): Promise<ConsultantResult | null> {
  const { incoming, state, bLocale, apiKey, pricelist, profile, docs, turn } = a;
  // Предел на клиента — до вызова модели (core/consultant/budget).
  const kind = opts.dryRun ? "test" : "customer";
  const date = today();
  const budgetLimits = limitsFor(ctx.tenant.settings.consultant_limits);
  const daily = parseDaily((await getSettings(ctx, [KEYS.daily]))[KEYS.daily], date);
  const overBudget = async (
    blocked: string,
    note: "budget" | "empty",
  ): Promise<ConsultantResult> => {
    if (opts.dryRun) throw new Error(blocked);
    await trySetSetting(
      ctx,
      KEYS.lastError,
      `${new Date().toISOString()} — ${blocked}`.slice(0, 500),
    );
    // Как при передаче менеджеру: пауза, чтобы продавец не получал уведомление на каждое сообщение.
    if (customer)
      await saveState(ctx, customer, {
        paused_until: pausedUntilIso(pauseHours(ctx.tenant)),
      });
    return {
      reply: handoffReply(bLocale),
      handoff: {
        kind: "handoff",
        reason: "unknown_question",
        summary: handoffSummary(await sellerLocaleSafe(ctx), note, incoming),
      },
      usage: { inputTokens: 0, outputTokens: 0, usd: 0 },
    };
  };
  const early = budgetBlock(daily, kind, budgetLimits);
  if (early) return overBudget(early, "budget");

  // Лимит ИИ-диалогов плана на месяц: новый диалог сверх лимита — сразу менеджеру.
  const newDialog = Boolean(customer) && !opts.dryRun && startsNewDialog(state.last_reply_at);
  const { tenantLimits, monthOf } = await import("@/core/plans/tenant");
  const limits = tenantLimits(ctx.tenant);
  const dialogs = parseMonthly((await getSettings(ctx, [KEYS.dialogs]))[KEYS.dialogs], monthOf());
  if (newDialog && limits?.aiDialogs != null && dialogs.count >= limits.aiDialogs) {
    const reason = `Лимит ИИ-диалогов плана на месяц (${limits.aiDialogs}) исчерпан — новые обращения уходят менеджеру.`;
    await trySetSetting(
      ctx,
      KEYS.lastError,
      `${new Date().toISOString()} — ${reason}`.slice(0, 500),
    );
    if (customer)
      await saveState(ctx, customer, {
        paused_until: pausedUntilIso(pauseHours(ctx.tenant)),
      });
    return {
      reply: handoffReply(bLocale),
      handoff: {
        kind: "handoff",
        reason: "unknown_question",
        summary: handoffSummary(await sellerLocaleSafe(ctx), "limit", incoming),
      },
      usage: { inputTokens: 0, outputTokens: 0, usd: 0 },
    };
  }

  // Большой каталог — инструментом поиска (флаг оператора), иначе первые товары в подсказке.
  const searchMode = !pricelist && catalogSearchEnabled(ctx);
  let loaded: Awaited<ReturnType<typeof loadCatalog>> | null = null;
  try {
    loaded = searchMode ? await loadCatalog(ctx) : null;
  } catch (e) {
    // Каталог не прочитался — покупатель не остаётся без ответа: вопрос менеджеру.
    await trySetSetting(
      ctx,
      KEYS.lastError,
      `${new Date().toISOString()} — каталог для консультанта не прочитан: ${e instanceof Error ? e.message : String(e)}`.slice(
        0,
        500,
      ),
    );
    if (opts.dryRun) throw serverFailure("Каталог не прочитался. Попробуйте ещё раз.");
    return {
      reply: unavailableReply(bLocale),
      handoff: {
        kind: "handoff",
        reason: "unknown_question",
        summary: handoffSummary(await sellerLocaleSafe(ctx), "catalog", incoming),
      },
      usage: { inputTokens: 0, outputTokens: 0, usd: 0 },
    };
  }
  const catalog = loaded
    ? { text: catalogPromptSection(loaded), prices: [] as number[] }
    : await catalogSnippet(ctx);
  const system = buildSystemPrompt(profile, retrieveKnowledge(incoming, docs, 6), catalog.text, {
    catalogTools: Boolean(loaded),
    shopInChat: opts.shopInChat,
    buyButton: opts.buyButton,
    platform: opts.platform,
  });
  let known = loaded ? parseMemory(state.profile) : {};
  const profile0 = known;
  const paymentMode = customer?.state.mode;
  const pendingOrderId = customer?.state.pending_order_id;
  const hasActivePaymentOrder = Boolean(
    pendingOrderId &&
    ["choose_pay", "awaiting_payment", "awaiting_proof"].includes(paymentMode ?? ""),
  );
  const checkoutContext = !opts.shopInChat
    ? ""
    : hasActivePaymentOrder
      ? `Активный шаг оплаты: заказ #${String(pendingOrderId)} (${paymentMode}). Не утверждай, что платёж или чек принят, если это не подтверждено системным статусом.`
      : "К этому чату не передан активный заказ для оплаты. Не делай вывод по истории, что заказ или ссылка существуют; не проси оплачивать или присылать чек и не обещай выдачу материалов после оплаты.";
  const session = [
    `Канал: ${opts.platform}`,
    customer?.firstName ? `Имя клиента в профиле: ${customer.firstName}` : "",
    state.contact ? `Контакт клиента, который он уже давал: ${state.contact}` : "",
    checkoutContext,
    loaded && formatProfile(profile0)
      ? `Что известно о покупателе: ${formatProfile(profile0)}`
      : "",
    `Сейчас: ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
  ]
    .filter(Boolean)
    .join("\n");

  const history = buildConsultantMessages(state.recent ?? []);

  // Бронь бюджета — проверка и прибавка одной атомарной записью: параллельные
  // сообщения видят брони друг друга и не проскакивают мимо предела.
  // С поиском — бронь на все раунды сразу: у потолка параллельные сообщения
  // видят полную цену друг друга, а не одного вызова.
  const reserveUsd = pricelist
    ? RESERVE_USD * PRICELIST_RESERVE_CALLS
    : loaded
      ? RESERVE_USD * MAX_ROUNDS
      : RESERVE_USD;
  let reserveBlock: string | null = null;
  const reserved = await updateSettingAtomic(ctx, KEYS.daily, (raw) => {
    const r = reserveDaily(parseDaily(raw, date), kind, budgetLimits, reserveUsd);
    if ("blocked" in r) {
      reserveBlock = r.blocked;
      return null;
    }
    return JSON.stringify(r.next);
  });
  if (reserveBlock) return overBudget(reserveBlock, "budget");
  // Сбой базы или гонка не выиграна: без брони модель не зовём, но и паузу
  // не ставим — это не исчерпанный предел.
  if (reserved !== "written") {
    if (opts.dryRun) throw new Error("Не удалось записать расход ИИ. Попробуйте ещё раз.");
    return {
      reply: unavailableReply(bLocale),
      handoff: {
        kind: "handoff",
        reason: "unknown_question",
        summary: handoffSummary(await sellerLocaleSafe(ctx), "accounting", incoming),
      },
      usage: { inputTokens: 0, outputTokens: 0, usd: 0 },
    };
  }

  // ИИ-баланс клиента (core/ai/balance): кончился — вопрос менеджеру, как при пределе.
  // Модуль не загрузился — как сбой учёта баланса: дневная бронь закрывается ниже.
  const balance = await import("@/core/ai/balance").catch(() => null);
  // Бронь — на все раунды сразу, как дневной расход выше: расчёт один, после цикла.
  const aiHold = balance ? await balance.aiReserve(ctx, "consultant", reserveUsd) : "failed";
  if (typeof aiHold === "string" || !balance) {
    await updateSettingAtomic(ctx, KEYS.daily, (raw) => settleRaw(raw, date, reserveUsd, 0));
    if (aiHold === "short")
      return overBudget(
        "ИИ-баланс клиента закончился — вопросы уходят менеджеру, пока баланс не пополнят.",
        "empty",
      );
    // Сбой учёта баланса — не пустой баланс: без паузы, как сбой дневного расхода.
    if (opts.dryRun) throw serverFailure("Не удалось записать расход ИИ. Попробуйте ещё раз.");
    return {
      reply: unavailableReply(bLocale),
      handoff: {
        kind: "handoff",
        reason: "unknown_question",
        summary: handoffSummary(await sellerLocaleSafe(ctx), "balance", incoming),
      },
      usage: { inputTokens: 0, outputTokens: 0, usd: 0 },
    };
  }
  const { aiSettle, aiRelease } = balance;

  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: TIMEOUT_MS });
  // Модель «по прайсу» читается из настроек уже внутри try ниже: её сбой закрывает
  // обе брони и уходит покупателю «сейчас не могу ответить» с передачей менеджеру.
  let model = env().CONSULTANT_MODEL?.trim() || DEFAULT_MODEL;
  const u = { input_tokens: 0, output_tokens: 0, cacheWrite: 0, cacheRead: 0 };
  // Цена считается по каждому вызову: у Haiku 5.5 ставка зависит от длины запроса.
  let spentUsd = 0;
  const costUsd = () => spentUsd;
  // Расход записан и бронь закрыта — catch второй раз их не трогает.
  let settled = false;
  // Вызов модели ушёл и не вернулся: Anthropic мог его списать (catch бронирует его цену).
  let callInFlight = false;
  const toolsUsed: string[] = [];
  const started = Date.now();
  const deadline = started + ROUNDS_DEADLINE_MS;
  /**
   * Один вызов модели. С поиском время ограничено общим потолком: таймаут —
   * остаток до него, повтор — только если остатка хватит на два вызова.
   * Каждый вызов проходит лимит частоты (core/consultant/rate.server).
   */
  const callModel = async (
    params: Anthropic.MessageCreateParamsNonStreaming,
  ): Promise<Anthropic.Message | "limited" | "late"> => {
    const left = deadline - Date.now();
    const bounded = Boolean(loaded) || pricelist;
    if (bounded && left < MIN_CALL_MS) return "late";
    if (!(await takeAiCall(ctx))) return "limited";
    callInFlight = true;
    const response = bounded
      ? await client.messages.create(params, {
          timeout: Math.min(TIMEOUT_MS, left),
          // Повтор не уложится в потолок: таймаут вызова — до 20 с из 35.
          maxRetries: 0,
          signal: AbortSignal.timeout(left),
        })
      : await client.messages.create(params);
    u.input_tokens += response.usage.input_tokens;
    u.output_tokens += response.usage.output_tokens;
    u.cacheWrite += response.usage.cache_creation_input_tokens ?? 0;
    u.cacheRead += response.usage.cache_read_input_tokens ?? 0;
    spentUsd += callUsd(model, response.usage);
    callInFlight = false;
    return response;
  };
  /**
   * Ответ готов: расход записан, бронь закрыта, история и состояние — в
   * диалог. Общее для обычного консультанта и консультанта по прайсу.
   */
  const finish = async (out: {
    reply: string;
    handoff: Handoff | null;
    orderAction?: ConsultantOrderAction | null;
    buyOffer?: ConsultantResult["buyOffer"];
    clearError: boolean;
    patch: Partial<ConsultantState>;
    /** В историю, если покупателю ушло другое (рубли вместо тенге). */
    historyReply?: string;
    /** Сбой, который ответ не остановил: в последнюю ошибку вместо очистки. */
    error?: string;
    attachments?: ConsultantResult["attachments"];
    rate?: ConsultantResult["rate"];
    verifiedOrderStatus?: boolean;
    cancelledOrderId?: number;
  }): Promise<ConsultantResult> => {
    const { reply, handoff } = out;
    const usd = costUsd();
    settled = true;
    // ИИ-баланс клиента: все раунды (и по прайсу) по фактической цене API, один расчёт брони.
    await aiSettle(ctx, aiHold, usd);
    await recordUsage(ctx, usd, u.input_tokens + u.cacheWrite + u.cacheRead, u.output_tokens);
    await updateSettingAtomic(ctx, KEYS.daily, (raw) => settleRaw(raw, date, reserveUsd, usd));
    // Условная запись: два диалога одновременно прибавляют по единице, а не затирают друг друга.
    if (newDialog)
      await updateSettingAtomic(ctx, KEYS.dialogs, (raw) =>
        JSON.stringify({
          month: dialogs.month,
          count: parseMonthly(raw, dialogs.month).count + 1,
        }),
      );
    if (out.error)
      await trySetSetting(
        ctx,
        KEYS.lastError,
        `${new Date().toISOString()} — ${out.error}`.slice(0, 500),
      );
    else if (out.clearError) await trySetSetting(ctx, KEYS.lastError, "");

    if (customer && !opts.dryRun) {
      // Ответ уже готов и оплачен: сбой записи истории его не отменяет.
      // История дописывается к свежей (не к снимку начала хода): соседний
      // ход или напоминание, записанные за это время, не затираются.
      try {
        const patch: Partial<ConsultantState> = {
          last_reply_at: new Date().toISOString(),
          ...(handoff?.customerContact ? { contact: handoff.customerContact } : {}),
          ...out.patch,
          ...(handoff ? { paused_until: pausedUntilIso(pauseHours(ctx.tenant)) } : {}),
        };
        await commitTurn(ctx, customer, {
          turnId: turn?.id ?? null,
          items: turn?.items ?? [{ id: "turn", text: incoming }],
          reply: out.historyReply || reply,
          historyTurns: HISTORY_TURNS,
          patch: (cur) => withPatch(cur, patch),
        });
        if (turn) turn.closed = true;
      } catch (e) {
        console.error(`[consultant:${ctx.tenant.id}] состояние диалога не записано`, e);
        await trySetSetting(
          ctx,
          KEYS.lastError,
          `${new Date().toISOString()} — состояние диалога не записано: ${e instanceof Error ? e.message : String(e)}`.slice(
            0,
            500,
          ),
        );
      }
    }
    return {
      reply,
      handoff,
      ...(out.orderAction ? { orderAction: out.orderAction } : {}),
      ...(out.buyOffer && !out.orderAction && !handoff ? { buyOffer: out.buyOffer } : {}),
      ...(out.verifiedOrderStatus ? { verifiedOrderStatus: true } : {}),
      ...(out.cancelledOrderId ? { cancelledOrderId: out.cancelledOrderId } : {}),
      // Тест-чат: что консультант запомнил за ход (рубли, товары) — следующему вопросу.
      ...(!customer && opts.dryRun && opts.testState
        ? { testState: withPatch(state, out.patch) as ConsultantState }
        : {}),
      usage: {
        inputTokens: u.input_tokens,
        outputTokens: u.output_tokens,
        usd,
        cacheWriteTokens: u.cacheWrite,
        cacheReadTokens: u.cacheRead,
      },
      model,
      tools: toolsUsed,
      ...(out.attachments?.length ? { attachments: out.attachments } : {}),
      ...(out.rate !== undefined ? { rate: out.rate } : {}),
    };
  };
  try {
    if (pricelist) {
      const { pricelistModel } = await import("./pricelist/engine.server");
      model = await pricelistModel(ctx, model);
      const { runPricelistTurn } = await import("./pricelist/turn.server");
      const out = await runPricelistTurn(ctx, {
        text: incoming,
        state,
        locale: bLocale,
        model,
        callModel,
        story: opts.story,
        imageUrls: opts.imageUrls,
        images: opts.images,
        channel: opts.platform,
        contact: customer
          ? customer.username
            ? `@${customer.username}`
            : customer.firstName || customer.userKey
          : undefined,
        dryRun: opts.dryRun,
      });
      toolsUsed.push(...out.tools);
      return await finish(out);
    }
    const orderStatusQuestion = Boolean(
      opts.shopInChat &&
      customer &&
      !isExplicitOrderCancellation(incoming) &&
      isOrderStatusQuestion(incoming),
    );
    const orderProductAllowed = Boolean(
      opts.shopInChat && confirmedOrderIntent(incoming, state.recent ?? []),
    );
    const tools = [
      ...(loaded ? [...CATALOG_TOOLS, REMEMBER_TOOL] : []),
      ...(orderStatusQuestion ? [ORDER_STATUS_TOOL] : []),
      ...(opts.shopInChat ? [ORDER_CANCEL_TOOL] : []),
      ...(orderProductAllowed ? [ORDER_PRODUCT_TOOL] : []),
      ...(opts.shopInChat && opts.buyButton ? [OFFER_BUY_TOOL] : []),
      ...TOOLS.filter((tool) => !(opts.shopInChat && tool.name === "record_order_lead")),
    ];
    let contactAsked = Boolean(state.contact_asked);
    const phoneNow = phoneIn(incoming);
    const hasPhoto = Boolean(opts.imageUrls?.length || opts.images?.length);
    const userIncoming = incoming || (hasPhoto ? "Здравствуйте, посмотрите фото" : "");
    const messages: Anthropic.MessageParam[] = buildConsultantMessages(
      state.recent ?? [],
      userIncoming,
    );
    if (hasPhoto) {
      const { fetchImage, MAX_IMAGES_PER_TURN } = await import("./pricelist/images");
      type LoadedImg = {
        mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
        data: string;
      };
      const ready = [...(opts.images ?? [])].slice(0, MAX_IMAGES_PER_TURN);
      const fetched = await Promise.all(
        (opts.imageUrls ?? [])
          .slice(0, MAX_IMAGES_PER_TURN - ready.length)
          .map((u) => fetchImage(u)),
      );
      const images: LoadedImg[] = [
        ...ready,
        ...fetched.filter((img): img is LoadedImg => img !== null),
      ];
      if (images.length > 0 && messages.length > 0) {
        const last = messages[messages.length - 1]!;
        const note =
          "[Покупатель прислал фото — оно ниже. Рассмотрите его детально, определите, какой товар изображён, и найдите подходящие товары в каталоге с помощью search_products.]";
        const contentText = typeof last.content === "string" ? last.content : userIncoming;
        last.content = [
          ...images.map(
            (img) =>
              ({
                type: "image",
                source: { type: "base64", media_type: img.mediaType, data: img.data },
              }) as Anthropic.ImageBlockParam,
          ),
          { type: "text", text: [note, contentText].filter(Boolean).join("\n\n") },
        ];
      }
    }
    const toolTexts: string[] = [];
    let stopped: "limited" | "late" | null = null;
    let reply = "";
    let handoff: Handoff | null = null;
    let orderStatusRows: CustomerOrderStatus[] | null = null;
    let orderStatusLookupFailed = false;
    let orderStatusVerified = false;
    let cancelledOrderId: number | undefined;
    let orderAction: ConsultantOrderAction | null = null;
    let buyOffer: ConsultantResult["buyOffer"] = null;
    let orderToolRejected = false;
    let orderLeadRejected = false;
    let response: Anthropic.Message | null = null;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const last = round === MAX_ROUNDS - 1;
      let purchaseHandoffRejectedThisRound = false;
      const got = await callModel({
        model,
        ...modelParams(model),
        max_tokens: 700,
        system: [
          { type: "text", text: system, cache_control: { type: "ephemeral", ttl: CACHE_TTL } },
          { type: "text", text: `ДАННЫЕ ТЕКУЩЕГО ДИАЛОГА:\n${session}` },
        ],
        tools,
        // Последний раунд — без инструментов: модель отвечает тем, что уже нашла.
        ...(orderStatusQuestion && round === 0
          ? { tool_choice: { type: "tool" as const, name: ORDER_STATUS_TOOL.name } }
          : last && loaded
            ? { tool_choice: { type: "none" as const } }
            : {}),
        messages,
      });
      if (typeof got === "string") {
        stopped = got;
        break;
      }
      response = got;

      let text = "";
      let askContact = false;
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type === "text") text += block.text;
        else if (block.type === "tool_use") {
          toolsUsed.push(block.name);
          const input = (block.input ?? {}) as Record<string, unknown>;
          if (opts.shopInChat && block.name === ORDER_CANCEL_TOOL.name) {
            const orderNumber =
              typeof input.order_number === "number" ? Math.floor(input.order_number) : NaN;
            if (
              !customer ||
              !cancellationIntentMatchesOrder(state.recent ?? [], incoming, orderNumber)
            ) {
              const resultText =
                "Заказ НЕ изменён: система не подтвердила одновременно явную просьбу покупателя об отмене и именно этот номер. Уточните запрос; не говорите, что заказ отменён.";
              toolTexts.push(resultText);
              results.push({ type: "tool_result", tool_use_id: block.id, content: resultText });
              continue;
            }
            try {
              const outcome = await cancelCustomerOrder(ctx, customer, orderNumber);
              if (outcome.kind === "cancelled" || outcome.kind === "already_cancelled") {
                cancelledOrderId = outcome.orderId;
                orderStatusVerified = true;
              } else {
                handoff = {
                  kind: "handoff",
                  reason: "unknown_question",
                  summary: `${handoffSummary(
                    await sellerLocaleSafe(ctx),
                    outcome.kind === "not_cancellable" ? "cancel_blocked" : "cancel_not_found",
                    incoming,
                  )} (№${outcome.orderNumber}${outcome.kind === "not_cancellable" ? `, ${outcome.status}` : ""})`,
                };
                reply =
                  text.trim() ||
                  (bLocale === "kk"
                    ? "Тапсырыстың күшін жоя алмадым және мәртебесі өзгерген жоқ. Тексеру үшін менеджерге жіберемін."
                    : bLocale === "en"
                      ? "I couldn't cancel the order; its status has not changed. I'm passing this to a manager to check."
                      : bLocale === "uz"
                        ? "Buyurtmani bekor qila olmadim, holati o‘zgarmadi. Tekshirish uchun menejerga yuboraman."
                        : "Не могу подтвердить отмену: статус заказа не изменён. Передаю вопрос менеджеру для проверки.");
              }
              const resultText = JSON.stringify(outcome);
              toolTexts.push(resultText);
              results.push({ type: "tool_result", tool_use_id: block.id, content: resultText });
            } catch {
              handoff = {
                kind: "handoff",
                reason: "unknown_question",
                summary: `${handoffSummary(await sellerLocaleSafe(ctx), "cancel_unverified", incoming)} (№${orderNumber})`,
              };
              reply =
                text.trim() ||
                (bLocale === "kk"
                  ? "Жүйеде тексеру өтпеді, тапсырыстың мәртебесі өзгерген жоқ. Менеджерге жіберемін."
                  : bLocale === "en"
                    ? "I couldn't verify the order, so its status has not changed. I'm passing this to a manager."
                    : bLocale === "uz"
                      ? "Buyurtmani tekshirish imkoni bo‘lmadi, holati o‘zgarmadi. Menejerga yuboraman."
                      : "Не удалось проверить заказ, его статус не изменён. Передаю вопрос менеджеру.");
              const resultText =
                "Не удалось проверить или изменить заказ. Ничего не отменяйте словами; сообщите, что проверка не прошла, и передайте менеджеру.";
              toolTexts.push(resultText);
              results.push({ type: "tool_result", tool_use_id: block.id, content: resultText });
            }
            continue;
          }
          if (opts.shopInChat && block.name === ORDER_STATUS_TOOL.name) {
            try {
              if (!customer) throw new Error("Покупатель не привязан к диалогу");
              orderStatusRows = await listCustomerOrderStatuses(
                ctx,
                customer,
                5,
                customer.state.pending_order_id,
              );
              const resultText = JSON.stringify({ orders: orderStatusRows });
              toolTexts.push(resultText);
              results.push({ type: "tool_result", tool_use_id: block.id, content: resultText });
            } catch {
              orderStatusLookupFailed = true;
              const resultText = "Не удалось проверить статус заказа в системе.";
              toolTexts.push(resultText);
              results.push({ type: "tool_result", tool_use_id: block.id, content: resultText });
            }
            continue;
          }
          if (loaded && CATALOG_TOOL_NAMES.has(block.name)) {
            const run = runCatalogTool(loaded, block.name, input);
            toolTexts.push(run.result);
            catalog.prices.push(...run.prices);
            results.push({ type: "tool_result", tool_use_id: block.id, content: run.result });
            continue;
          }
          if (loaded && block.name === REMEMBER_TOOL.name) {
            known = mergeProfile(known, input);
            results.push({ type: "tool_result", tool_use_id: block.id, content: "ok" });
            continue;
          }
          const str = (k: string) =>
            typeof input[k] === "string" && input[k].trim() ? (input[k] as string) : undefined;
          if (opts.shopInChat && block.name === "record_order_lead") {
            orderLeadRejected = true;
            results.push({
              type: "tool_result",
              tool_use_id: block.id,
              content:
                "В магазине в чате не создавайте заявку менеджеру. Если покупатель выбрал товар и подтвердил покупку — используйте order_product; иначе ответьте на вопрос или уточните выбор.",
            });
            continue;
          }
          if (
            opts.shopInChat &&
            block.name === "handoff_to_manager" &&
            str("reason") === "purchase"
          ) {
            orderLeadRejected = true;
            purchaseHandoffRejectedThisRound = true;
            results.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: orderProductAllowed
                ? "В магазине в чате не передавайте покупку менеджеру. Покупатель подтвердил покупку: оформите выбранный товар инструментом order_product. Если он просит человека, передайте диалог с reason human_requested."
                : "В магазине в чате не передавайте покупку менеджеру и не создавайте заказ: выбор товара ещё не подтверждает покупку. Коротко уточните, хочет ли покупатель оформить выбранный товар. Если он просит человека, передайте диалог с reason human_requested.",
            });
            continue;
          }
          // Покупку без телефона менеджеру не отдаём: сначала контакт и способ получения (v1).
          if (
            loaded &&
            isPurchaseHandoff(block.name, input) &&
            !str("customer_contact") &&
            !known.phone &&
            !state.contact &&
            !phoneNow &&
            !contactAsked
          ) {
            contactAsked = true;
            askContact = true;
            toolsUsed.push("ask_contact");
            results.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: ASK_CONTACT_RESULT,
            });
            continue;
          }
          const contact = str("customer_contact") ?? known.phone ?? phoneNow ?? undefined;
          const summary = (key: string) =>
            [
              str(key) ?? "",
              loaded && formatProfile(known) ? `Известно: ${formatProfile(known)}` : "",
            ]
              .filter(Boolean)
              .join("\n");
          if (block.name === OFFER_BUY_TOOL.name) {
            const pid = str("product_id");
            if (pid)
              buyOffer = {
                productId: pid,
                ...(str("variant_id") ? { variantId: str("variant_id")! } : {}),
              };
            results.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: pid
                ? "Кнопка «Купить» будет под вашим ответом. Не спрашивайте «Оформляем заказ?» и не пишите, что заказ оформлен: заказ появится, когда покупатель нажмёт кнопку. Ответьте по существу коротко."
                : "Кнопка не поставлена: нужен product_id из каталога.",
            });
            continue;
          }
          if (block.name === "order_product") {
            if (!orderProductAllowed) {
              orderToolRejected = true;
              results.push({
                type: "tool_result",
                tool_use_id: block.id,
                content:
                  "Заказ НЕ оформлен: текущая реплика не подтверждает покупку. Не вызывайте order_product повторно, не обещайте оплату; ответьте по существу на вопрос клиента.",
              });
              continue;
            }
            const pid = str("product_id");
            const pname = str("product_name");
            const vid = str("variant_id");
            const vname = str("variant_name");
            const qty =
              typeof input.quantity === "number" && input.quantity > 0
                ? Math.floor(input.quantity)
                : 1;
            const extra: ConsultantOrderAction[] = (
              Array.isArray(input.items) ? input.items.slice(0, 10) : []
            )
              .map((raw) => {
                const o = (raw ?? {}) as Record<string, unknown>;
                const s = (k: string) =>
                  typeof o[k] === "string" && (o[k] as string).trim()
                    ? (o[k] as string)
                    : undefined;
                return {
                  productId: s("product_id"),
                  productName: s("product_name"),
                  variantId: s("variant_id"),
                  variantName: s("variant_name"),
                  quantity:
                    typeof o.quantity === "number" && o.quantity > 0 ? Math.floor(o.quantity) : 1,
                };
              })
              .filter((a) => a.productId || a.productName);
            orderAction = {
              productId: pid,
              productName: pname,
              variantId: vid,
              variantName: vname,
              quantity: qty,
              ...(extra.length ? { extra } : {}),
            };
            results.push({
              type: "tool_result",
              tool_use_id: block.id,
              content:
                "Заказ инициирован в системе магазина. Напишите клиенту короткое приветливое подтверждение (1–2 предложения), что вы оформляете заказ — система сейчас пришлёт детали и кнопку для оплаты в этот чат.",
            });
            continue;
          }
          if (block.name === "handoff_to_manager")
            handoff = {
              kind: "handoff",
              reason: str("reason") ?? "human_requested",
              customerName: str("customer_name") ?? known.name,
              customerContact: contact,
              summary: summary("summary"),
            };
          else if (block.name === "record_order_lead")
            handoff = {
              kind: "lead",
              reason: str("lead_type") ?? "order",
              customerName: str("customer_name") ?? known.name,
              customerContact: contact,
              summary: summary("details"),
            };
          results.push({ type: "tool_result", tool_use_id: block.id, content: "ok" });
        }
      }
      // Нужны данные каталога — ещё раунд с результатами; иначе ответ готов.
      // Текст раунда, который ушёл за данными («секунду, посмотрю») или за
      // контактом («передаю менеджеру»), покупателю не уходит.
      const needsData = response.content.some(
        (b) =>
          b.type === "tool_use" &&
          (CATALOG_TOOL_NAMES.has(b.name) ||
            b.name === ORDER_STATUS_TOOL.name ||
            b.name === ORDER_CANCEL_TOOL.name),
      );
      if (text.trim() && !needsData && !askContact) reply = text;
      // Ещё раунд и тогда, когда нужно спросить контакт или модель только
      // запомнила сказанное и ничего не ответила.
      const more = needsData || askContact || !text.trim() || purchaseHandoffRejectedThisRound;
      if (
        last ||
        (!loaded &&
          !purchaseHandoffRejectedThisRound &&
          !response.content.some(
            (b) => b.type === "tool_use" && b.name === ORDER_CANCEL_TOOL.name,
          )) ||
        !more ||
        response.stop_reason !== "tool_use" ||
        handoff
      )
        break;
      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: results });
    }

    // Если принудительный tool call не вернул результат, всё равно проверяем
    // заказ на сервере, а не позволяем модели угадывать статус.
    if (orderStatusQuestion && orderStatusRows === null && !orderStatusLookupFailed && customer) {
      try {
        orderStatusRows = await listCustomerOrderStatuses(
          ctx,
          customer,
          5,
          customer.state.pending_order_id,
        );
        toolTexts.push(JSON.stringify({ orders: orderStatusRows }));
      } catch {
        orderStatusLookupFailed = true;
      }
    }

    // Лимит частоты или потолок времени до готового ответа — вопрос менеджеру, молча.
    if (!reply && !handoff && stopped) {
      await trySetSetting(
        ctx,
        KEYS.lastError,
        `${new Date().toISOString()} — ${stopped === "limited" ? "лимит частоты вызовов ИИ" : "не уложился в потолок времени"}; вопрос передан менеджеру`,
      );
      reply = handoffReply(bLocale);
      handoff = {
        kind: "handoff",
        reason: "unknown_question",
        summary: handoffSummary(await sellerLocaleSafe(ctx), "slow", incoming),
      };
    }
    if (response?.stop_reason === "refusal") {
      reply = handoffReply(bLocale);
      handoff = handoff ?? {
        kind: "handoff",
        reason: "unknown_question",
        summary: incoming.slice(0, 300),
      };
    }
    reply = cleanReply(reply);
    // Модель могла сообщить об оформлении в том же ответе, что и отклонённый tool call.
    if (
      orderToolRejected &&
      /(?:оформля\w*\s+заказ|заказ.{0,40}(?:оформлен|создан)|(?:детали|оплат\w*|сч[её]т).{0,80}(?:появ|отправ|приш|сформир)|ссылк\w*.{0,60}(?:появ|отправ|приш))/iu.test(
        reply,
      )
    ) {
      reply = orderNotCreatedReply(bLocale);
    }
    if (
      orderLeadRejected &&
      /(?:передал[аио]?\s+менеджер|менеджер\w*.{0,40}свяж|заявк\w*.{0,40}(?:создал|запис|передал)|записал.{0,40}передал|(?:запис|оформ|созда)\p{L}*\s+(?:к\s+)?заказ\p{L}*)/iu.test(
        reply,
      )
    ) {
      reply = orderLeadNotCreatedReply(bLocale);
    }
    if (opts.shopInChat)
      reply = guardShopOrderReply(reply, bLocale, {
        orderAction: Boolean(orderAction),
        handoff,
        hasActivePaymentOrder,
        verifiedOrderStatus: orderStatusVerified,
      });
    // Цена или доставка не из каталога и условий — покупателю не уходит, вопрос менеджеру.
    const known0 = knownNumbers({
      prices: catalog.prices,
      texts: [system, session, incoming, ...history.map((h) => String(h.content)), ...toolTexts],
    });
    let facts = checkReplyFacts(reply, known0);
    // Число не из каталога — не повод бросать клиента: один раз просим модель
    // переписать ответ по ценам каталога (сумма нескольких позиций — расчётом).
    // Раньше такой ответ сразу уходил менеджеру с паузой на часы, и горячий
    // покупатель («5-6-7 классы») оставался без ответа.
    if (!facts.ok && reply && !handoff && !stopped) {
      const fix = await callModel({
        model,
        ...modelParams(model),
        max_tokens: 700,
        system: [
          { type: "text", text: system, cache_control: { type: "ephemeral", ttl: CACHE_TTL } },
          { type: "text", text: `ДАННЫЕ ТЕКУЩЕГО ДИАЛОГА:\n${session}` },
        ],
        tools,
        tool_choice: { type: "none" as const },
        messages: [
          ...messages,
          { role: "assistant", content: reply },
          {
            role: "user",
            content: `[Служебное сообщение, клиент его не видит. В вашем ответе есть сумма или цена, которой нет в каталоге и условиях: ${facts.reason}. Перепишите ответ клиенту: называйте только цены из каталога, а сумму нескольких позиций показывайте как сложение этих цен («2500 + 2500 = 5000»). Если точной цены нет — так и скажите без чисел. О служебном сообщении не упоминайте.]`,
          },
        ],
      });
      if (typeof fix !== "string") {
        const fixed = cleanReply(
          fix.content
            .filter((blk): blk is Anthropic.TextBlock => blk.type === "text")
            .map((blk) => blk.text)
            .join(""),
        );
        if (fixed && checkReplyFacts(fixed, known0).ok) {
          reply = fixed;
          facts = { ok: true };
        }
      }
    }
    if (!facts.ok) {
      console.warn(`[consultant:${ctx.tenant.id}] ответ заменён: ${facts.reason}`);
      await trySetSetting(
        ctx,
        KEYS.lastError,
        `${new Date().toISOString()} — ответ консультанта не отправлен: ${facts.reason}; вопрос передан менеджеру`.slice(
          0,
          500,
        ),
      );
      reply = priceUnsureReply(bLocale);
      handoff = handoff ?? {
        kind: "handoff",
        reason: "unknown_question",
        summary: handoffSummary(await sellerLocaleSafe(ctx), "price", incoming),
      };
    }
    if (orderStatusRows !== null || orderStatusLookupFailed) {
      const verified = verifiedOrderStatusReply(orderStatusRows, bLocale, orderStatusLookupFailed);
      reply = verified.reply;
      orderStatusVerified = Boolean(orderStatusRows?.length) && !verified.handoff;
      const explicitHandoff =
        handoff?.kind === "handoff" &&
        (handoff.reason === "human_requested" || handoff.reason === "complaint");
      handoff = verified.handoff ?? (explicitHandoff ? handoff : null);
    }
    if (!reply && handoff)
      reply = handoff.kind === "lead" ? leadDoneReply(bLocale) : dialogHandoffReply(bLocale);
    if (!reply && orderAction) {
      reply =
        bLocale === "kk"
          ? "Тапсырысты рәсімдеп жатырмын — төлем мәліметтері осы чатқа қазір жіберіледі."
          : "Оформляю заказ — детали и оплата сейчас появятся в этом чате.";
    }
    if (!reply) reply = clarifyReply(bLocale);

    return await finish({
      reply,
      handoff,
      orderAction,
      buyOffer,
      ...(cancelledOrderId ? { cancelledOrderId } : {}),
      clearError: facts.ok,
      patch: {
        ...(loaded ? { profile: known, contact_asked: contactAsked || undefined } : {}),
        ...(buyOffer && !orderAction && !handoff ? { buy_offer: buyOffer } : {}),
      },
      verifiedOrderStatus: orderStatusVerified,
    });
  } catch (e) {
    // Бронь ИИ-баланса закрываем всегда: прошедшие раунды — по их цене, упавший
    // вызов клиент не оплачивает; раундов не было — бронь назад целиком.
    if (!settled) {
      const spent = costUsd();
      if (spent > 0) await aiSettle(ctx, aiHold, spent).catch(() => {});
      else await aiRelease(ctx, aiHold).catch(() => {});
    }
    const detail =
      e instanceof Anthropic.APIError
        ? `HTTP ${e.status ?? "?"}: ${e.message}`
        : e instanceof Error
          ? e.message
          : String(e);
    console.error(`[consultant:${ctx.tenant.id}]`, detail);
    await trySetSetting(
      ctx,
      KEYS.lastError,
      `${new Date().toISOString()} — ${detail}`.slice(0, 500),
    );
    // Бронь закрываем прошедшими раундами плюс одна бронь на упавший вызов:
    // Anthropic мог успеть его списать, а мы этого не узнаем. Упало до вызова
    // модели (настройки, прайс) — только прошедшие раунды.
    if (!settled) {
      const spent = costUsd();
      if (spent > 0)
        await recordUsage(
          ctx,
          spent,
          u.input_tokens + u.cacheWrite + u.cacheRead,
          u.output_tokens,
        ).catch(() => {});
      await updateSettingAtomic(ctx, KEYS.daily, (raw) =>
        settleRaw(raw, date, reserveUsd, spent + (callInFlight ? RESERVE_USD : 0)),
      ).catch(() => {});
    }
    return {
      reply: unavailableReply(bLocale),
      handoff: {
        kind: "handoff",
        reason: "unknown_question",
        summary: handoffSummary(await sellerLocaleSafe(ctx), "failure", incoming),
      },
      usage: { inputTokens: 0, outputTokens: 0, usd: 0 },
    };
  }
}
