import type Anthropic from "@anthropic-ai/sdk";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSettings } from "@/core/settings/settings";
import { startsNewDialog } from "../budget";
import { hasToolMarkup, stripToolMarkup } from "../prompt";
import {
  findStoryTag,
  findStoryTagFor,
  listStoryTags,
  storyCaptionText,
  storyProductsOf,
  type StoryTag,
} from "../story-tags";
import { findProducts, type ConsultantProduct } from "./catalog";
import { loadPricelist } from "./catalog.server";
import { storyHits } from "./story-hits";
import { currencyAsked, tengeToRubles, wantsRubles } from "./currency";
import {
  askedBefore as replyAskedBefore,
  brandCountries,
  catalogBrands,
  draftFixNote,
  draftProblems,
} from "./draft-check";
import { finalizePricelistText, withModelCategories, writesRubles } from "./finalize";
import { russianPlaceIn } from "./geo";
import { fetchImage, MAX_IMAGES_PER_TURN, type V2Image } from "./images";
import {
  formatKnowledgeForPrompt,
  formatKnowledgeIndexForPrompt,
  pickArticleForQuestion,
  searchKnowledge,
  type ConsultantKnowledgeArticle,
} from "./knowledge";
import { loadKnowledge } from "./knowledge.server";
import { mediaForProduct, type ProductMedia } from "./media";
import { loadProductMedia, productMediaAttachmentUrl } from "./media.server";
import { isOffHours, offHoursNote, pricelistHours, type ShopHours } from "./mode";
import { knowledgeAboutModels } from "./model-knowledge";
import { buildV2SystemPrompt, formatAssortmentMapForV2 } from "./prompt";
import type { PricelistPersona } from "./persona";
import { isRateFresh, type StoredVtbRate } from "./rate";
import { getUsableRate } from "./rate.server";
import { getStoreInfo, type StoreInfo } from "./store-info.server";
import { formatSynonymsForPrompt, withSynonyms } from "./synonyms";
import { executeConsultantTool, type StoryTagHit } from "./tools";
import {
  correctQuery,
  FAMILY_SET_RE,
  familySets,
  latinModelsIn,
  latinModelsNote,
  normalizeCatalogQuery,
} from "./typos";
import {
  formatProfile,
  isHandoffReason,
  mergeProfile,
  profileForManager,
  V2_TOOLS,
  type V2HandoffReason,
  type V2Profile,
} from "./v2-tools";

/**
 * Консультант «по прайсу» (BOVI) — перенос decideConsultantReplyV2 из v1
 * (src/lib/consultant-v2/engine.ts). Решает модель: что спросить, что
 * показать, когда звать человека. Код даёт данные (прайс, база знаний, курс,
 * товары публикации) и защищает: рубли считает сам, черновик сверяет с
 * прайсом один раз, из ответа вырезает разметку и пересказ пометок.
 *
 * Общее с остальными клиентами — бюджет, лимит частоты, пауза при
 * менеджере, запись истории — делает runConsultant (engine.server.ts); сюда
 * приходит уже разрешённый вызов модели `call`.
 */

export const PRICELIST_MAX_ROUNDS = 4;
export const PRICELIST_MAX_TOKENS = 800;

/**
 * Модели, на которых консультанта проверяют. Настройка магазина
 * consultant_model выбирает из них без передеплоя (как в v1); чего нет в
 * списке — модель платформы.
 */
export const PRICELIST_MODELS = [
  "claude-haiku-4-5-20251001",
  "claude-sonnet-5",
  "claude-haiku-5-5",
] as const;
export const MODEL_KEY = "consultant_model";

export { modelParams } from "@/core/ai/pure";

/** Вызов инструмента текстом (BOVI 30.09): модель переписывает ответ сама. */
/** К последнему запросу без инструментов: поиск окончен, нужен текст покупателю. */
const FINAL_ANSWER_NOTE =
  "[Поиск окончен, инструменты больше недоступны. Напишите покупателю ответ обычными словами по тому, что нашли; если отправили фото — коротко скажите, что на нём и сколько стоит.]";

/** Пометка модели: цена всё ещё не по прайсу — ответ без этих сумм. */
const priceLastTryNote = (details: string[]): string =>
  `[Суммы не совпадают с выдачей поиска: ${details.join("; ")}. Инструменты больше недоступны. Перепишите ответ покупателю: оставьте только цены, которые есть в выдаче поиска, а в чём не уверены — без суммы. Продолжите подбор одним вопросом по делу. Менеджера не обещайте.]`;

const TOOL_MARKUP_RETRY_NOTE =
  "[Вызов инструмента написан текстом, а не вызван. Если нужен поиск — вызовите инструмент. Если нет — напишите покупателю ответ обычными словами, без тегов.]";

const RUBLES_RETRY_NOTE =
  "[В ответе суммы в рублях. Напишите тот же ответ, но цены — в тенге, как в выдаче поиска. О замене на рубли покупателю не пишите.]";

/**
 * Напоминание о рублях — без слов, которые модель повторит покупателю: в v1
 * «система переведёт каждую сумму в рубли» ушло покупателям в семи ответах.
 */
const RUBLES_NOTE =
  "[Покупателю нужны рубли: тенге из вашего ответа заменятся на рубли автоматически. Пишите цены в тенге и не упоминайте ни замену, ни курс.]";

/**
 * Рубли нужны, а курса нет совсем: тенге останутся тенге (tengeToRubles без
 * курса текст не меняет). Обещать покупателю рубли нельзя — честно сказать.
 */
const RUBLES_NO_RATE_NOTE =
  "[Покупателю нужны рубли, но курса рубля сейчас нет: цены останутся в тенге. Пишите цены в тенге и одной фразой честно скажите, что точную сумму в рублях подтвердит менеджер. Рубли сами не считайте.]";

/**
 * Заказ без телефона не уходит менеджеру с первого раза: v1 спрашивал
 * телефон и город доставки, и менеджер получал готовый заказ.
 */
const ASK_CONTACT_RESULT = {
  ok: false,
  handed_off: false,
  note: "Заказ ещё не передан. Спросите одним сообщением телефон и как забрать: город доставки или самовывоз из бутика. Ответит — запомните (remember_customer) и передайте. Менеджера в этом ответе не обещайте.",
};

/**
 * Заказ в Instagram и WhatsApp передаётся сразу, без телефона: сам диалог —
 * связь с покупателем (ссылка в задаче). BOVI 11.10: Musi (fokkiuo77)
 * ответила «Да» на «Оформляем?», бот попросил телефон, она замолчала — и у
 * Нурдина не было ни задачи, ни уведомления. Телефон бот просит в том же
 * ответе; пришлёт позже — допишется в задачу (addContactToOpenTask).
 */
const PURCHASE_HANDED_NO_PHONE_NOTE =
  "Заказ передан менеджеру, она напишет покупателю здесь, в этом чате. Одним сообщением скажите это и попросите телефон и как забрать: город и адрес доставки или самовывоз из бутика. Способ оплаты не называйте, если его нет в базе знаний: его пришлёт менеджер.";

/** Каналы, где диалог сам — связь с покупателем: заказ не ждёт телефона. */
const CHANNELS_WITH_DIALOG_LINK = new Set(["instagram", "whatsapp"]);

/** Статья базы подкладывается к вопросу при таком совпадении и не длиннее этого (v1). */
const KNOWLEDGE_ATTACH_MIN_SCORE = 3;
const KNOWLEDGE_ATTACH_MAX_CHARS = 8000;

/** Телефон в тексте: «+7 700 253 88 88», «87002538888». */
export function phoneIn(text: string): string | undefined {
  const match = /\+?\d[\d\s\-()]{8,}\d/.exec(text ?? "");
  return match && match[0].replace(/\D/g, "").length >= 10 ? match[0].trim() : undefined;
}

/** Состояние диалога, которое читает консультант по прайсу; v2_* — имена v1 у диалогов до переезда. */
export type PricelistState = {
  recent?: { role: "customer" | "assistant"; text: string }[];
  profile?: V2Profile;
  v2_profile?: V2Profile;
  rub?: boolean;
  v2_rub?: boolean;
  contact_asked?: boolean;
  v2_contact_asked?: boolean;
  media_sent?: string[];
  v2_media_sent?: string[];
  last_product_ids?: string[];
  /** Когда бот ответил последний раз (общее состояние консультанта). */
  last_reply_at?: string;
};

/**
 * Бот уже отвечал в этом разговоре (тот же диалог, что считает план, — без
 * перерыва больше суток). BOVI 10.10: tolkin8 и lenakzm получили по четыре
 * «Здравствуйте» за пару минут — правило «только в первом сообщении» в
 * промпте модель не держала, потому что все примеры начинаются с приветствия.
 */
export function alreadyGreeted(state: PricelistState, now = Date.now()): boolean {
  const replied = (state.recent ?? []).some((t) => t.role === "assistant" && t.text.trim());
  return replied && !startsNewDialog(state.last_reply_at, now);
}

export const ALREADY_GREETED_NOTE =
  "[Вы уже отвечали покупателю в этом разговоре: не здоровайтесь снова, сразу к делу.]";

/**
 * Вложение без ссылки: Zernio прислал «фото/публикацию», а картинки нет.
 * BOVI 10.10, tolkin8: на такое вложение бот назвал одеяла Traumina из
 * последних хитов как факт — покупатель мог переслать что угодно.
 */
/** Так вложение без ссылки приходит текстом (channels/zernio/message messageAsText). */
const INVISIBLE_ATTACHMENT_TEXT = "[вложение без ссылки]";

export const INVISIBLE_ATTACHMENT_NOTE =
  "[Покупатель прислал вложение (фото или публикацию), но его не видно. Не угадывайте товар и не называйте его как факт: если по разговору есть догадка, спросите, о нём ли речь («Это … ? Если нет — пришлите скрин или название»), иначе попросите скрин или название.]";

/** Что консультанту нужно знать о магазине на один ход. */
export type PricelistData = {
  catalog: ConsultantProduct[];
  synonyms: string[][];
  shopUrl: string;
  store: StoreInfo;
  articles: ConsultantKnowledgeArticle[];
  rate: StoredVtbRate | null;
  hours: ShopHours;
  timezone: string;
  /** Образ консультанта от продавца (persona.ts); нет — подсказка BOVI. */
  persona?: PricelistPersona;
  /** Галочка «Виртуальный консультант»: часы живого консультанта; нет — галочка снята. */
  virtualIntro?: ShopHours;
  storyTags: StoryTag[];
  loadMedia: () => Promise<ProductMedia[]>;
  mediaUrl: (path: string) => string | Promise<string>;
  /** База знаний не прочиталась: отвечаем без неё, но сбой виден в журнале и последней ошибке. */
  knowledgeError?: string;
};

export async function loadPricelistData(
  ctx: TenantContext,
  now = Date.now(),
): Promise<PricelistData> {
  let knowledgeError: string | undefined;
  const [snap, rate, store, articles, storyTags] = await Promise.all([
    loadPricelist(ctx, now),
    getUsableRate(ctx, now).catch(() => null),
    getStoreInfo(ctx),
    loadKnowledge(ctx).catch((e: unknown): ConsultantKnowledgeArticle[] => {
      knowledgeError = e instanceof Error ? e.message : String(e);
      return [];
    }),
    listStoryTags(ctx).catch(() => []),
  ]);
  return {
    ...(knowledgeError ? { knowledgeError } : {}),
    catalog: snap.products,
    synonyms: snap.synonyms,
    shopUrl: snap.shopUrl,
    store,
    articles,
    rate,
    hours: pricelistHours(ctx.tenant),
    timezone: ctx.timezone,
    persona: ctx.tenant.settings.consultant_pricelist?.persona,
    ...(ctx.tenant.settings.consultant_pricelist?.virtual_intro
      ? { virtualIntro: pricelistHours(ctx.tenant) }
      : {}),
    storyTags,
    loadMedia: () => loadProductMedia(ctx),
    mediaUrl: (path) => productMediaAttachmentUrl(ctx, path),
  };
}

/** Модель магазина из настройки consultant_model, если она из проверенных. */
export async function pricelistModel(ctx: TenantContext, fallback: string): Promise<string> {
  const chosen = (await getSettings(ctx, [MODEL_KEY]))[MODEL_KEY]?.trim() ?? "";
  return (PRICELIST_MODELS as readonly string[]).includes(chosen) ? chosen : fallback;
}

export type ModelRequest = {
  system: Anthropic.TextBlockParam[];
  tools: Anthropic.Tool[];
  messages: Anthropic.MessageParam[];
  max_tokens: number;
  tool_choice?: { type: "none" };
};
/** Вызов модели от runConsultant: бюджет, лимит частоты и потолок времени — там. */
export type ModelCall = (req: ModelRequest) => Promise<Anthropic.Message | "limited" | "late">;

export type PricelistInput = {
  text: string;
  state: PricelistState;
  call: ModelCall;
  story?: import("../story-tags").StoryRef;
  /** Эталонный набор: товары публикации заданы сценарием, а не отметкой. */
  storyProductIds?: string[];
  /** Фото покупателя: ссылки из директа (скачиваются здесь) или уже скачанные (Telegram). */
  imageUrls?: string[];
  images?: V2Image[];
  now?: Date;
  cacheTtl?: "5m" | "1h";
  onToolCall?: (name: string, input: Record<string, unknown>) => void;
  /** Подмена скачивания картинок в тестах. */
  fetchImage?: (url: string) => Promise<V2Image | null>;
  /** Канал диалога (telegram, instagram, whatsapp): в Instagram и WhatsApp заказ не ждёт телефона. */
  channel?: string;
};

export type PricelistHandoff = { reason: V2HandoffReason; summary: string; phone?: string };

export type PricelistDecision = {
  /** Покупателю (рубли уже переведены); пусто — модель не ответила. */
  reply: string;
  /** В историю — ответ в тенге: иначе модель восстанавливала тенге по прайсу и брала соседнюю строку. */
  historyText: string;
  handoff: PricelistHandoff | null;
  tools: string[];
  attachments: { url: string; kind: "image" | "video" }[];
  statePatch: {
    profile?: V2Profile;
    rub?: boolean;
    contact_asked?: boolean;
    media_sent?: string[];
    last_product_ids?: string[];
  };
  /** Вызов модели не состоялся: лимит частоты или потолок времени. */
  stopped: "limited" | "late" | null;
  /** Покупателю нужны рубли, а курса нет совсем: цены остались в тенге. */
  rateMissing: boolean;
  /**
   * Рубли посчитаны по курсу старше суток (источник не отвечает): к ответу
   * с рублями toTurn добавляет «цены в рублях ориентировочные».
   */
  rateApprox?: boolean;
  /**
   * Черновик не прошёл сверку цен и после переписывания: ответ с ценой не
   * по прайсу покупателю не уходит, вопрос — менеджеру.
   */
  priceBlocked: boolean;
  /** Товары, по которым покупатель просил фото или видео, но в базе их нет (спрос на медиа). */
  missingMedia?: { product: ConsultantProduct; kind: "image" | "video" }[];
};

/**
 * Что делать, если по публикации не понять товар: «что из публикации?»
 * не спрашивать, а попросить фото или название и показать хиты магазина.
 */
export function unknownStoryAdvice(hits: ConsultantProduct[]): string {
  const ask =
    "Если не понять, о каком товаре речь, не спрашивайте «что из публикации»: попросите прислать фото (скрин) или название товара";
  if (hits.length === 0) return `${ask}.`;
  const lines = hits.map(
    (p) => `• ${p.name}${p.size ? `, ${p.size}` : ""} — ${p.price_kzt.toLocaleString("ru-RU")} ₸`,
  );
  return `${ask} и в том же сообщении предложите хиты магазина с ценами:\n${lines.join("\n")}`;
}

/** Товары публикации — пометкой для модели. Покупатель её не видит. Цены — в тенге. */
async function storyNote(
  data: PricelistData,
  input: PricelistInput,
  loadImage: (url: string) => Promise<V2Image | null>,
): Promise<{ note: string; products: ConsultantProduct[]; image?: V2Image }> {
  const story = input.story;
  if (!story?.storyId && !story?.mediaUrl && !input.storyProductIds) {
    return { note: "", products: [] };
  }
  const products: ConsultantProduct[] = [];
  if (input.storyProductIds) {
    const ids = new Set(input.storyProductIds);
    products.push(...data.catalog.filter((p) => ids.has(p.id)));
  } else {
    const tag = findStoryTagFor(data.storyTags, story);
    for (const tagged of tag ? storyProductsOf(tag) : []) {
      const byId = tagged.id ? data.catalog.find((p) => p.id === tagged.id) : undefined;
      const found = byId ?? findProducts({ query: tagged.name }, data.catalog).shown[0];
      if (found && !products.some((p) => p.id === found.id)) products.push(found);
    }
  }
  if (products.length === 0) {
    // Отметки нет — модель смотрит на саму публикацию. Видео (рилс) и
    // устаревшая ссылка не скачаются — тогда подпись, если Zernio её прислал.
    // Не понять, о чём речь, — не «что из публикации?» (покупатель не знает,
    // что ответить, и уходит), а фото или название и хиты магазина.
    const image = story?.mediaUrl ? await loadImage(story.mediaUrl) : null;
    const caption = storyCaptionText(story?.caption);
    const captionLine = caption ? ` Подпись публикации: «${caption}».` : "";
    const fallback = unknownStoryAdvice(storyHits(data.storyTags, data.catalog));
    if (image) {
      return {
        note: `[Покупатель пишет из публикации (сторис или рилс); товары к ней не привязаны.${captionLine} Картинка публикации — ниже: поймите, что на ней, и найдите похожее поиском. ${fallback}]`,
        products,
        image,
      };
    }
    if (caption) {
      return {
        note: `[Покупатель пишет из публикации (сторис или рилс); товары к ней не привязаны.${captionLine} Поймите по подписи, о каких товарах речь, найдите их поиском и назовите цены. ${fallback}]`,
        products,
      };
    }
    return {
      note: `[Покупатель пишет из публикации (сторис или рилс), но товары к ней не привязаны, и что на ней — не видно. ${fallback}]`,
      products,
    };
  }
  const lines = products.map(
    (p) => `• ${p.name}${p.size ? `, ${p.size}` : ""} — ${p.price_kzt.toLocaleString("ru-RU")} ₸`,
  );
  return {
    note: `[Покупатель пишет из публикации (сторис или рилс). Товары в ней:\n${lines.join("\n")}]`,
    products,
  };
}

/** История диалога для модели: чередование ролей, первым — покупатель. */
function historyMessages(
  recent: PricelistState["recent"],
  incoming: string,
): Anthropic.MessageParam[] {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const t of [...(recent ?? []).slice(-16), { role: "customer" as const, text: incoming }]) {
    const content = t.text?.trim();
    if (!content) continue;
    const role = t.role === "customer" ? ("user" as const) : ("assistant" as const);
    if (!out.length && role === "assistant") continue;
    const last = out[out.length - 1];
    if (last?.role === role) last.content = `${last.content}\n\n${content}`;
    else out.push({ role, content });
  }
  return out;
}

/** Срок кеша хвоста переписки (см. call в decide). */
export const TAIL_CACHE_TTL = "5m" as const;

/** Точка кеша на последнем сообщении: следующий раунд читает историю из кеша. */
function withTailCache(
  messages: Anthropic.MessageParam[],
  ttl: "5m" | "1h",
): Anthropic.MessageParam[] {
  if (!messages.length) return messages;
  const last = messages[messages.length - 1]!;
  const blocks: Anthropic.ContentBlockParam[] =
    typeof last.content === "string" ? [{ type: "text", text: last.content }] : [...last.content];
  const tail = blocks[blocks.length - 1];
  if (!tail) return messages;
  blocks[blocks.length - 1] = {
    ...tail,
    cache_control: { type: "ephemeral", ttl },
  } as Anthropic.ContentBlockParam;
  return [...messages.slice(0, -1), { ...last, content: blocks }];
}

export async function decidePricelistReply(
  data: PricelistData,
  input: PricelistInput,
): Promise<PricelistDecision> {
  return withSynonyms(data.synonyms, () => decide(data, input));
}

async function decide(data: PricelistData, input: PricelistInput): Promise<PricelistDecision> {
  const { catalog, articles, rate: rateRow } = data;
  const { state, text } = input;
  const rate = rateRow?.rate ?? null;
  const loadImage = input.fetchImage ?? fetchImage;
  const ttl = input.cacheTtl ?? "1h";
  const savedProfile = state.profile ?? state.v2_profile;
  const mediaSentBefore = state.media_sent ?? state.v2_media_sent ?? [];

  // Для проверки черновика: страны марок, марки прайса, чем подтверждаются
  // свойства товара, и что писал покупатель (высота его матраса).
  const draftCtx = {
    brandCountries: brandCountries(data.synonyms),
    brands: catalogBrands(catalog),
    evidence: [
      ...catalog.map((p) => `${p.name} ${p.category ?? ""}`),
      ...articles.map((a) => `${a.title} ${a.content}`),
    ].join("\n"),
    customerText: [
      ...(state.recent ?? []).filter((t) => t.role === "customer").map((t) => t.text),
      text,
    ].join("\n"),
    askedBefore: replyAskedBefore(state.recent ?? []),
  };
  const system = buildV2SystemPrompt({
    catalogSection: formatAssortmentMapForV2(catalog),
    knowledgeSection: formatKnowledgeIndexForPrompt(articles),
    brandsSection: formatSynonymsForPrompt(data.synonyms),
    shopUrl: data.shopUrl,
    store: data.store,
    persona: data.persona,
    virtualIntro: data.virtualIntro,
  });

  // Покупатель сам назвал Россию или российский город — страна и город в
  // профиль кодом: 27.09 модель их не запомнила, и цены ушли в тенге.
  const place = savedProfile?.country || savedProfile?.city ? null : russianPlaceIn(text);
  const knownProfile = place ? mergeProfile(savedProfile, place) : savedProfile;

  // Всё, что известно к этому сообщению, — пометками перед словами покупателя.
  const notes: string[] = [];
  const profileNote = formatProfile(knownProfile);
  if (profileNote) notes.push(profileNote);
  const greeted = alreadyGreeted(state, (input.now ?? new Date()).getTime());
  if (greeted) notes.push(ALREADY_GREETED_NOTE);
  if (text.includes(INVISIBLE_ATTACHMENT_TEXT)) notes.push(INVISIBLE_ATTACHMENT_NOTE);
  const story = await storyNote(data, input, loadImage);
  if (story.note) notes.push(story.note);
  const article = text.trim()
    ? pickArticleForQuestion(text, articles, catalog, KNOWLEDGE_ATTACH_MIN_SCORE)
    : null;
  const known =
    article && article.content.length <= KNOWLEDGE_ATTACH_MAX_CHARS
      ? formatKnowledgeForPrompt([article])
      : "";
  if (known) notes.push(`[Из базы знаний — покупатель этого не видит:\n${known}]`);
  // «Чем отличаются Макс и Лондон?» — статья о названных моделях (или о
  // моделях последней выдачи).
  const aboutModels = knowledgeAboutModels(text, catalog, articles, {
    recentProductNames: (state.last_product_ids ?? [])
      .slice(0, 4)
      .map((id) => catalog.find((p) => p.id === id)?.name)
      .filter((name): name is string => Boolean(name)),
    attached: known,
  });
  if (aboutModels) notes.push(aboutModels);
  const rubles = wantsRubles(text, state, knownProfile);
  const rateMissing = rubles && !(rate && rate > 0);
  const rateApprox =
    rubles && !rateMissing && !isRateFresh(rateRow, (input.now ?? new Date()).getTime());
  if (rubles) notes.push(rateMissing ? RUBLES_NO_RATE_NOTE : RUBLES_NOTE);
  if (isOffHours(input.now ?? new Date(), data.hours, data.timezone))
    notes.push(offHoursNote(data.hours));
  // Марка русскими буквами («акванова Маск») — подсказка, что в прайсе латиницей.
  const latinNote = latinModelsNote(text, catalog);
  if (latinNote) notes.push(latinNote);
  // Фото покупателя — модели картинкой рядом с текстом.
  const ready = [...(story.image ? [story.image] : []), ...(input.images ?? [])].slice(
    0,
    MAX_IMAGES_PER_TURN,
  );
  const fetched = await Promise.all(
    (input.imageUrls ?? []).slice(0, MAX_IMAGES_PER_TURN - ready.length).map((u) => loadImage(u)),
  );
  const images = [...ready, ...fetched.filter((img): img is V2Image => img !== null)];
  const sentPhoto = (input.imageUrls?.length ?? 0) + (input.images?.length ?? 0) > 0;
  const customerPhotos = images.length - (story.image ? 1 : 0);
  if (customerPhotos > 0) {
    notes.push(
      "[Покупатель прислал фото — оно ниже. Поймите, что на нём, и найдите похожее поиском.]",
    );
  } else if (sentPhoto) {
    notes.push(
      "[Покупатель прислал фото, но оно не загрузилось. Попросите написать, что за товар интересует.]",
    );
  }
  const userTurn = [...notes, text.trim() || "Здравствуйте"].join("\n\n");
  const messages = historyMessages(state.recent, userTurn);
  if (images.length > 0) {
    const last = messages[messages.length - 1]!;
    last.content = [
      ...images.map(
        (img) =>
          ({
            type: "image",
            source: { type: "base64", media_type: img.mediaType, data: img.data },
          }) as Anthropic.ImageBlockParam,
      ),
      { type: "text", text: typeof last.content === "string" ? last.content : userTurn },
    ];
  }

  const tools = V2_TOOLS.map((tool, i) =>
    i === V2_TOOLS.length - 1
      ? { ...tool, cache_control: { type: "ephemeral" as const, ttl } }
      : tool,
  ) as unknown as Anthropic.Tool[];
  const systemBlocks: Anthropic.TextBlockParam[] = [
    { type: "text", text: system, cache_control: { type: "ephemeral", ttl } },
  ];

  let profile: V2Profile | undefined = knownProfile;
  let handoff: PricelistHandoff | null = null;
  const products: ConsultantProduct[] = [...story.products];
  const toolsUsed: string[] = [
    ...(sentPhoto ? [`photo:${customerPhotos}`] : []),
    ...(story.image ? ["story_image"] : []),
    ...(aboutModels ? ["kb_models"] : []),
  ];
  let lastText = "";
  let stopped: "limited" | "late" | null = null;
  let maxRounds = PRICELIST_MAX_ROUNDS;
  let rublesRetried = false;
  let markupRetried = false;
  let draftChecked = false;
  // Что модель сделала в этот ход — для проверки «уточнение без поиска».
  const turnDraftCtx = () => ({
    ...draftCtx,
    searched: toolsUsed.some((t) => t.startsWith("search_products")),
    photo: customerPhotos > 0,
  });
  let contactAsked = false;
  const attachments: PricelistDecision["attachments"] = [];
  const missingMedia: { product: ConsultantProduct; kind: "image" | "video" }[] = [];
  const mediaSent: string[] = [];
  let mediaList: ProductMedia[] | undefined;
  const call = async (extra: Partial<ModelRequest> = {}) => {
    const got = await input.call({
      system: systemBlocks,
      tools,
      // Хвост — в пятиминутный кеш: он читается раундами этого хода (секунды),
      // а следующий ход собирает сообщения заново (пометки к реплике, сдвиг
      // окна истории) и часовую запись хвоста уже не читает. Инструменты и
      // система с прайсом — в часовом (ttl): они одинаковы от хода к ходу.
      messages: withTailCache(messages, TAIL_CACHE_TTL),
      max_tokens: PRICELIST_MAX_TOKENS,
      ...extra,
    });
    if (typeof got === "string") stopped = got;
    return typeof got === "string" ? null : got;
  };
  const textOf = (content: Anthropic.ContentBlock[]) =>
    content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

  // Последним в истории — результаты инструментов, а ответа на них ещё нет.
  let toolsPending = false;
  let refused = false;
  for (let round = 0; round < maxRounds; round++) {
    const res = await call();
    if (!res) break;
    // Модель отказалась отвечать (stop_reason "refusal", у Claude 4.5+ и Haiku 5.5
    // без серверного запасного варианта): ответа нет — диалог менеджеру.
    if (res.stop_reason === "refusal") {
      refused = true;
      toolsUsed.push("refusal");
      break;
    }
    const content = res.content ?? [];
    messages.push({ role: "assistant", content });
    const said = textOf(content);
    if (said) lastText = said;
    const calls = content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    toolsPending = false;
    if (calls.length === 0) {
      if (!markupRetried && hasToolMarkup(lastText)) {
        markupRetried = true;
        maxRounds++;
        toolsUsed.push("fix:tool_markup");
        messages.push({ role: "user", content: TOOL_MARKUP_RETRY_NOTE });
        continue;
      }
      if (!rublesRetried && writesRubles(lastText)) {
        rublesRetried = true;
        maxRounds++;
        toolsUsed.push("fix:rubles_by_model");
        messages.push({ role: "user", content: RUBLES_RETRY_NOTE });
        continue;
      }
      // Черновик сверяется с данными один раз: при расхождении модель
      // переписывает сама (может и поискать заново).
      if (!draftChecked && !handoff && lastText) {
        draftChecked = true;
        const problems = draftProblems(lastText, catalog, turnDraftCtx());
        if (problems.length) {
          maxRounds += 2;
          toolsUsed.push(`fix:draft:${[...new Set(problems.map((p) => p.kind))].join("+")}`);
          messages.push({ role: "user", content: draftFixNote(problems) });
          continue;
        }
      }
      break;
    }

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const c of calls) {
      const args = (c.input ?? {}) as Record<string, unknown>;
      // В журнал — и что искали: иначе не понять, почему поиск был пуст.
      const asked =
        typeof args.query === "string"
          ? args.query
          : typeof args.product_id === "string"
            ? args.product_id
            : "";
      toolsUsed.push(asked ? `${c.name} «${asked.slice(0, 60)}»` : c.name);
      input.onToolCall?.(c.name, args);
      let result: unknown;
      if (c.name === "remember_customer") {
        profile = mergeProfile(profile, args);
        result = { ok: true };
      } else if (c.name === "send_product_photo") {
        result = await sendPhoto(args);
      } else if (c.name === "handoff_to_manager") {
        const reason = isHandoffReason(args.reason) ? args.reason : "human";
        const phone =
          (typeof args.customer_phone === "string" && args.customer_phone.trim()) ||
          phoneIn(text) ||
          undefined;
        const askedBefore = state.contact_asked ?? state.v2_contact_asked;
        const dialogIsContact = CHANNELS_WITH_DIALOG_LINK.has(input.channel ?? "");
        if (
          reason === "purchase" &&
          !dialogIsContact &&
          !phone &&
          !profile?.phone &&
          !askedBefore &&
          !contactAsked
        ) {
          contactAsked = true;
          toolsUsed.push("ask_contact");
          result = ASK_CONTACT_RESULT;
        } else {
          handoff = {
            reason,
            summary: typeof args.summary === "string" ? args.summary.trim() : "",
            phone,
          };
          const noPhone = reason === "purchase" && !phone && !profile?.phone;
          if (noPhone && dialogIsContact) toolsUsed.push("handoff_without_phone");
          result = {
            ok: true,
            note:
              reason === "wholesale"
                ? "Передано менеджеру с пометкой «опт». Напишите покупателю одной фразой, что условия пришлёт менеджер; если он не сказал, что и сколько нужно, — попросите написать."
                : noPhone && dialogIsContact
                  ? PURCHASE_HANDED_NO_PHONE_NOTE
                  : "Менеджер подключится. Напишите покупателю одну короткую фразу об этом.",
          };
        }
      } else {
        result = await dataTool(c.name, args);
      }
      results.push({ type: "tool_result", tool_use_id: c.id, content: JSON.stringify(result) });
    }
    messages.push({ role: "user", content: results });
    toolsPending = true;
    // Модель уже написала фразу покупателю вместе с передачей — дальше незачем.
    if (handoff && lastText) break;
  }

  // Ходы кончились, а модель всё ещё ищет: ещё один запрос без инструментов —
  // ответ по тому, что уже найдено (v1 25.09: покупателю ушло «Поищу иначе:»).
  if (refused) {
    handoff = handoff ?? { reason: "no_answer", summary: "" };
    lastText = "";
  } else if (toolsPending && !stopped && !(handoff && lastText)) {
    toolsUsed.push("fix:final_without_tools");
    // Без просьбы модель на этом запросе может вернуть пустой текст: она уже
    // «ответила» фото (BOVI 09.10 22:34: нашла и отправила полотенце для
    // волос, текста не дала — покупателю ушло «передаю менеджеру»).
    const last = messages.at(-1);
    if (last?.role === "user" && Array.isArray(last.content))
      last.content.push({ type: "text", text: FINAL_ANSWER_NOTE });
    const res = await call({ tool_choice: { type: "none" } });
    if (res) lastText = textOf(res.content ?? []);
  }
  // Модель ещё искала, а вызовы кончились (лимит частоты, потолок времени):
  // её последний текст — фраза перед поиском («Сейчас посмотрю…»), а не
  // ответ. Покупателю — передача менеджеру (toTurn). Готовый черновик, который
  // не успели переписать, уходит, как раньше: цену в нём сверяет код ниже.
  if (stopped && toolsPending) lastText = "";

  // Разметка вызова не уходит покупателю никогда: вырезается, а если кроме
  // неё ничего не было — вопрос менеджеру (BOVI 30.09: «<invoke name=…>»).
  if (hasToolMarkup(lastText)) {
    toolsUsed.push("fix:tool_markup_stripped");
    lastText = stripToolMarkup(lastText);
    if (!lastText && !handoff) handoff = { reason: "no_answer", summary: "" };
  }
  if (rublesRetried && writesRubles(lastText)) toolsUsed.push("fix:rubles_by_model_again");
  let priceBlocked = false;
  if (toolsUsed.some((t) => t.startsWith("fix:draft:")) && !handoff) {
    const left = draftProblems(lastText, catalog, turnDraftCtx());
    if (left.length)
      toolsUsed.push(`fix:draft_again:${[...new Set(left.map((p) => p.kind))].join("+")}`);
    // Цена не по прайсу и после переписывания: последнее слово — модели
    // (BOVI 19–25.10: на «200/220», «Белый» покупатель получал «передам
    // менеджеру», хотя модель нашла товар). Ещё один ответ без инструментов:
    // без сомнительных сумм. Не помогло — покупателю не уходит (как
    // checkReplyFacts у общего консультанта): вопрос менеджеру.
    const prices = left.filter((p) => p.kind === "price");
    if (prices.length) {
      const fixed = await priceLastTry(prices);
      if (fixed) lastText = fixed;
      else {
        priceBlocked = true;
        handoff = { reason: "no_answer", summary: "" };
        lastText = "";
      }
    }
  }
  const tengeText = finalizePricelistText(lastText, catalog, { greeted });
  const reply = rubles ? tengeToRubles(tengeText, rate) : tengeText;

  // В состояние — только выбор покупателя (рубли, тенге), не вывод из профиля.
  const rubChoice = currencyAsked(text) ?? state.rub ?? state.v2_rub;
  // Товары этого хода — первыми: менеджер видит в карточке то, о чём говорили сейчас.
  const turnIds = [...new Set(products.map((p) => p.id))];
  const lastIds = turnIds.length
    ? [...new Set([...turnIds, ...(handoff ? (state.last_product_ids ?? []) : [])])].slice(0, 12)
    : undefined;
  const finalHandoff = handoff as PricelistHandoff | null;
  if (finalHandoff) {
    // Карточка менеджеру: суть от модели и что известно о покупателе.
    finalHandoff.summary = [finalHandoff.summary, profileForManager(profile)]
      .filter(Boolean)
      .join("\n");
    finalHandoff.phone ??= profile?.phone;
  }
  return {
    reply,
    historyText: tengeText,
    handoff: finalHandoff,
    tools: toolsUsed,
    attachments,
    statePatch: {
      profile,
      ...(rubChoice !== undefined ? { rub: rubChoice } : {}),
      contact_asked: finalHandoff ? undefined : contactAsked || undefined,
      ...(mediaSent.length ? { media_sent: [...mediaSentBefore, ...mediaSent].slice(-30) } : {}),
      ...(lastIds ? { last_product_ids: lastIds } : {}),
    },
    stopped,
    rateMissing,
    ...(rateApprox ? { rateApprox } : {}),
    priceBlocked,
    ...(missingMedia.length ? { missingMedia } : {}),
  };

  async function priceLastTry(prices: { detail: string }[]): Promise<string> {
    if (stopped) return "";
    toolsUsed.push("fix:price_last_try");
    if (messages.at(-1)?.role !== "assistant")
      messages.push({ role: "assistant", content: lastText });
    messages.push({ role: "user", content: priceLastTryNote(prices.map((p) => p.detail)) });
    const res = await call({ tool_choice: { type: "none" } });
    // Сбой или лимит на этом запросе — не повод держать ход: ответ решён ниже.
    stopped = null;
    const text = res ? textOf(res.content ?? []) : "";
    if (!text || hasToolMarkup(text)) return "";
    if (draftProblems(text, catalog, turnDraftCtx()).some((p) => p.kind === "price")) return "";
    return text;
  }

  async function sendPhoto(args: Record<string, unknown>): Promise<unknown> {
    // Фото товара из фотобазы магазина (панель → «Фото товаров»).
    const id = typeof args.product_id === "string" ? args.product_id : "";
    let product = catalog.find((p) => p.id === id) ?? products.find((p) => p.id === id);
    if (!product && state.last_product_ids?.length) {
      for (const lastId of state.last_product_ids) {
        const foundProd = catalog.find((p) => p.id === lastId);
        if (foundProd) {
          product = foundProd;
          break;
        }
      }
    }
    if (!product && id) {
      const cleanId = id.toLowerCase().replace(/[^a-zа-я0-9]/gi, " ");
      const words = cleanId.split(/\s+/).filter((w) => w.length > 2);
      if (words.length) {
        product =
          catalog.find((p) => {
            const pName = p.name.toLowerCase();
            const pId = p.id.toLowerCase();
            return words.every((w) => pName.includes(w) || pId.includes(w));
          }) ??
          products.find((p) => {
            const pName = p.name.toLowerCase();
            const pId = p.id.toLowerCase();
            return words.every((w) => pName.includes(w) || pId.includes(w));
          });
      }
    }
    if (!product) {
      return { found: false, error: "нет позиции с таким product_id — сначала найдите её поиском" };
    }
    mediaList ??= await data.loadMedia().catch(() => []);
    // Просят видео — только видео: 25.09 на «Видео нет?» бот повторно
    // отправил то же фото и позвал менеджера.
    const wanted = args.kind === "video" ? "video" : args.kind === "photo" ? "image" : null;
    const found = mediaForProduct(mediaList, product).filter((m) => !wanted || m.kind === wanted);
    // Одно фото — на всю модель: 25.09 к 70х120 то же фото считалось «нет фото».
    const alreadySent = new Set([...mediaSentBefore, ...mediaSent]);
    const fresh = found.filter((m) => !alreadySent.has(m.path));
    if (fresh.length) {
      attachments.push(
        ...(await Promise.all(
          fresh.map(async (m) => ({ url: await data.mediaUrl(m.path), kind: m.kind })),
        )),
      );
      mediaSent.push(...fresh.map((m) => m.path));
      products.push(product);
      return { found: true, sent: fresh.length, kinds: fresh.map((m) => m.kind) };
    }
    if (found.length) {
      return {
        found: true,
        already_sent: true,
        note: "Этот файл покупатель уже получил — он для всей модели, других нет. Скажите, что фото выше; менеджера из-за этого не зовите.",
      };
    }
    missingMedia.push({ product, kind: wanted === "video" ? "video" : "image" });
    return {
      found: false,
      product: product.name,
      shop_url: data.shopUrl,
      ...(wanted === "video" ? { kind: "video" } : {}),
    };
  }

  async function dataTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    try {
      // Карточки — в тенге: рубли переводит код после ответа.
      const toolCtx = {
        country: "KZ" as const,
        catalog,
        shopUrl: data.shopUrl,
        excludeIds: state.last_product_ids,
        rate: rateRow,
        searchKnowledge: async (q: string) => searchKnowledge(q, articles),
        findStory: async (storyId: string | null, url: string | null) =>
          storyHit(findStoryTag(data.storyTags, storyId, url)),
      };
      // «Пододеяльник» в запросе — «подод», как в прайсе.
      const query = typeof args.query === "string" ? args.query : null;
      const callInput =
        name === "search_products" && query
          ? { ...args, query: normalizeCatalogQuery(query, catalog) }
          : args;
      // Семейный комплект — по названию в прайсе («2 подод»).
      const family =
        name === "search_products" && query && FAMILY_SET_RE.test(query) ? familySets(catalog) : [];
      let executed = family.length
        ? {
            result: {
              products: family.slice(0, 12).map((p) => ({ ...p, price_rub: null })),
              returned: Math.min(family.length, 12),
              total_matches: family.length,
              note: "Семейные комплекты: в каждом два пододеяльника («2 подод» — пишите «пододеяльника» полностью).",
            } as unknown,
            products: family,
            handoff: false,
          }
        : await executeConsultantTool(name, callInput, toolCtx);
      if (family.length) toolsUsed.push("fix:family_sets");
      // Пустой поиск по слову с опечаткой («палатенца») — повтор по слову из прайса.
      let corrected: string | null = null;
      if (
        name === "search_products" &&
        executed.products.length === 0 &&
        typeof callInput.query === "string"
      ) {
        const latin = latinModelsIn(callInput.query, catalog);
        corrected =
          correctQuery(callInput.query, catalog) ?? (latin.length ? latin.join(" ") : null);
        if (corrected) {
          const retry = await executeConsultantTool(
            name,
            { ...callInput, query: corrected },
            toolCtx,
          );
          if (retry.products.length > 0) {
            executed = retry;
            toolsUsed.push("fix:typo");
          } else {
            corrected = null;
          }
        }
      }
      products.push(...executed.products);
      const cards = withModelCategories(executed.result);
      return corrected && cards && typeof cards === "object"
        ? { ...(cards as Record<string, unknown>), query_corrected_to: corrected }
        : cards;
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }
}

function storyHit(tag: StoryTag | null): StoryTagHit | null {
  if (!tag) return null;
  return {
    story_id: tag.story_id,
    product_id: tag.product_id,
    product_name: tag.product_name,
    product_price_kzt: tag.price,
    notes: tag.notes,
  };
}

/** Причина передачи → причина в уведомлении и воронке, как у остальных клиентов. */
export const HANDOFF_REASON_LABEL: Record<V2HandoffReason, string> = {
  purchase: "purchase",
  wholesale: "wholesale",
  complaint: "complaint",
  human: "human_requested",
  photo: "photo",
  no_answer: "unknown_question",
};
