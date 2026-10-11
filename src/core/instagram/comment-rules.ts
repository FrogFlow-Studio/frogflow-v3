/**
 * Comment-to-DM в Instagram: чистая логика без сети и базы — перенос
 * v1 `comment-dm-fallback.ts` и `zernio-post-ids.ts` по описи
 * (docs/inherited-knowledge.md). Оркестрация (Zernio API, журнал
 * `comment_dm_fallback_sends`) — в `channels/zernio/automations.server.ts`.
 */
import { UserError } from "@/core/i18n/user-error";

export type MatchMode = "exact" | "contains";

export type AutomationButton = {
  type: "url" | "postback";
  title: string;
  url?: string;
  payload?: string;
};

/**
 * Совпадает ли комментарий с ключевыми словами правила — повторяет семантику
 * Zernio ("keywords: empty = any comment triggers", "matchMode: exact,
 * contains"). Точный алгоритм Zernio не документирован детальнее этих двух
 * слов — это лучшее воспроизведение по названию режимов, а не копия.
 */
export function commentMatchesAutomation(
  text: string,
  keywords: string[] | undefined,
  matchMode: MatchMode | undefined,
): boolean {
  if (!keywords || keywords.length === 0) return true;
  const normalized = text.trim().toLowerCase();
  return keywords.some((kw) => {
    const k = kw.trim().toLowerCase();
    if (!k) return false;
    return matchMode === "exact" ? normalized === k : normalized.includes(k);
  });
}

/** Подпись поста для сравнения: регистр, пробелы и переносы, хвостовое «…» не важны. */
function captionKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(?:…|\.\.\.)$/, "")
    .trim();
}

/**
 * Под своим ли постом комментарий. Правило с id поста — строгое равенство.
 * Без id, но с подписью поста (postTitle: так у Zernio приходят правила
 * «Палитра» Копилки и «день хлеба» AATeach) — сравниваем подпись правила с
 * подписью поста комментария: одна начинается с другой (Zernio хранит подпись
 * обрезанной). Под чужими рилсами «нужно»/«хочу» иначе оформляли не тот товар
 * (10.10: Копилка #96, #108; AATeach #1361, #1371). Подписи поста в событии
 * нет (реклама, пост не подтянулся) — "unknown": решает вызывающий. Правило
 * без поста и без подписи — на все посты.
 */
export function commentOnRulePost(
  rule: { platformPostId?: string | null; postId?: string | null; postTitle?: string | null },
  commentPostId: string | null | undefined,
  commentCaption: string | null | undefined,
): boolean | "unknown" {
  const target = String(rule.platformPostId || rule.postId || "").trim();
  if (target) return Boolean(commentPostId) && target === String(commentPostId).trim();
  const title = captionKey(rule.postTitle ?? "");
  if (!title) return true;
  const caption = captionKey(commentCaption ?? "");
  if (!caption) return "unknown";
  return caption.startsWith(title) || title.startsWith(caption);
}

/**
 * Не пытаемся раньше этого возраста — даём Zernio шанс сработать первым.
 * Штатный ответ у Zernio уходит в пределах минуты; без паузы каждый новый
 * комментарий немедленно дублировался бы нашей же резервной отправкой.
 */
export const FALLBACK_MIN_AGE_MS = 5 * 60 * 1000;

/** Крон каждые 15 минут; 10 минут — длиннее одного прогона и короче следующего тика. */
export const STALE_PENDING_MS = 10 * 60 * 1000;

/** С запасом от документированного 7-дневного окна private-reply у Zernio. */
export const FALLBACK_MAX_AGE_MS = 6.5 * 24 * 60 * 60 * 1000;

/**
 * Что делать с уже существующей строкой comment_dm_fallback_sends.
 * Inbox не идемпотентен: если прошлый прогон успел отправить и умер до
 * UPDATE, человек получал то же сообщение каждые 15 минут. Один повтор
 * private-reply ещё допустим (Meta на дубль отвечает «already sent»),
 * второй и дальше — бросаем.
 */
export type StalePendingAction = "wait" | "retry" | "abandon" | "skip";

export function stalePendingAction(
  row: { status: string; created_at: string; updated_at: string },
  now: Date,
  staleMs: number = STALE_PENDING_MS,
): StalePendingAction {
  if (row.status !== "pending") return "skip";
  const created = new Date(row.created_at).getTime();
  const updated = new Date(row.updated_at).getTime();
  if (Number.isNaN(created) || Number.isNaN(updated)) return "abandon";
  if (now.getTime() - updated <= staleMs) return "wait";
  // updated уже уехал от insert — этот комментарий уже подхватывали.
  if (updated - created > staleMs) return "abandon";
  return "retry";
}

/** Private-reply ИЛИ альт-канал доставили DM — для крона это успех, не повод слать ещё. */
export function fallbackRecordStatus(
  privateOk: boolean,
  altChannelStatus: string,
): "sent" | "failed" {
  return privateOk || altChannelStatus === "sent" ? "sent" : "failed";
}

export type CommentAgeVerdict = "too_new" | "too_old" | "eligible";

export function commentAgeVerdict(createdTimeIso: string, now: Date): CommentAgeVerdict {
  const created = new Date(createdTimeIso).getTime();
  if (Number.isNaN(created)) return "too_old"; // дате доверять нельзя — не отправляем вслепую
  const age = now.getTime() - created;
  if (age < FALLBACK_MIN_AGE_MS) return "too_new";
  if (age > FALLBACK_MAX_AGE_MS) return "too_old";
  return "eligible";
}

/**
 * Статус комментария относительно правила — общий для резервного крона и
 * догоняющей рассылки в панели: продавец видит, кому правило уже ответило,
 * кому не должно было (не то слово), а кому должно было, но не ответило.
 */
export type CommentReplyStatus =
  | "owner" // комментарий самого аккаунта — не адресат
  | "sent" // Zernio отправил DM
  | "failed" // Zernio пытался и не смог
  | "no_match" // правило есть, ключевые слова не совпали
  | "no_automation" // под постом нет активного правила
  | "missing"; // подходит под правило, но в логах нет — пропущено

export function annotateCommentStatus(
  comment: { id?: string; message?: string; from?: { isOwner?: boolean } },
  automation: { keywords: string[]; matchMode?: MatchMode } | null,
  sentCommentIds: Set<string>,
  failedCommentIds: Set<string>,
): CommentReplyStatus {
  if (comment.from?.isOwner) return "owner";
  const id = comment.id ?? "";
  if (id && sentCommentIds.has(id)) return "sent";
  if (!automation) return "no_automation";
  if (!commentMatchesAutomation(comment.message ?? "", automation.keywords, automation.matchMode))
    return "no_match";
  if (id && failedCommentIds.has(id)) return "failed";
  return "missing";
}

/**
 * Почему Instagram отклонит private-reply ещё до вызова: ответ в ветке,
 * старше 7 дней или Instagram сам помечает canReply=false.
 */
export type PrivateReplyBlockReason = "nested" | "too_old" | "cannot_reply";

export function commentPrivateReplyBlockReason(
  comment: { parentId?: string | null; createdTime?: string; canReply?: boolean },
  now: Date,
): PrivateReplyBlockReason | null {
  if (comment.parentId) return "nested";
  if (comment.canReply === false) return "cannot_reply";
  if (commentAgeVerdict(comment.createdTime ?? "", now) === "too_old") return "too_old";
  return null;
}

/**
 * Сырой отказ Zernio/Meta по private-reply — в текст для продавца.
 * 2534066: Meta называет две равнозначные причины (права токена ИЛИ
 * невалидный comment ID) и не говорит, какая; выдавать одну за факт нельзя —
 * живой случай опроверг версию «холодный DM».
 */
/**
 * Логи правила читаем страницами по 200, не больше пяти страниц за проход
 * (v1 0a8bba4). Одна страница из 200 на ходовом рилсе покрывала сутки-двое:
 * всё старше выглядело «пропущенным», Meta отклоняла повторный private-reply,
 * и крон слал тот же текст в открытый диалог — ровно тем, кто уже оплатил.
 */
export const LOG_PAGE_SIZE = 200;
export const LOG_MAX_PAGES = 5;

/** Запас на задержку между комментарием и записью о нём в логах Zernio. */
export const LOG_LAG_MS = 10 * 60 * 1000;

export type LogCoverage = { from: number; to: number };

/**
 * За комментарии какого времени прочитанные логи отвечают: «Zernio его видел»
 * или «не видел». complete — прочитаны все логи правила, тогда за любой.
 * Порядок выдачи у Zernio не документирован — определяем по самим записям.
 * Без разбираемых дат не отвечаем ни за один комментарий — null.
 */
export function logCoverage(
  logs: ReadonlyArray<{ createdAt?: unknown }>,
  complete: boolean,
): LogCoverage | null {
  if (complete) return { from: -Infinity, to: Infinity };
  const times = logs.map((row) => Date.parse(String(row.createdAt ?? "")));
  if (times.length === 0 || times.some((t) => Number.isNaN(t))) return null;
  const first = times[0]!;
  const last = times[times.length - 1]!;
  // Новые сверху: прочитано всё от самой старой записи до сегодня.
  if (first >= last) return { from: Math.min(...times), to: Infinity };
  // Старые сверху: прочитано начало истории, про всё новее — ничего не известно.
  return { from: first, to: last - LOG_LAG_MS };
}

export function commentCoveredByLogs(
  createdTimeIso: string,
  coverage: LogCoverage | null,
): boolean {
  if (!coverage) return false;
  const created = Date.parse(createdTimeIso);
  if (Number.isNaN(created)) return false;
  return created >= coverage.from && created <= coverage.to;
}

/** Дошли ли логи до записи старше cutoff — дальше листать незачем. */
export function logsReachBack(
  logs: ReadonlyArray<{ createdAt?: unknown }>,
  cutoffMs: number,
): boolean {
  return logs.some((row) => {
    const t = Date.parse(String(row.createdAt ?? ""));
    return !Number.isNaN(t) && t <= cutoffMs;
  });
}

/**
 * Комментарии, которые Zernio уже обработал. skipped — видел и сознательно не
 * писал (этому человеку правило уже отвечало): слать за него — тот самый
 * повтор. failed — пытался и не смог: это работа резервного пути.
 */
export function commentIdsHandledByZernio(
  logs: ReadonlyArray<{ status?: unknown; commentId?: unknown }>,
): Set<string> {
  return new Set(
    logs
      .filter((row) => {
        const status = String(row.status ?? "");
        return status === "sent" || status === "skipped";
      })
      .map((row) => String(row.commentId ?? ""))
      .filter(Boolean),
  );
}

/** Авторы, которым по этому посту уже писали: второй комментарий не догоняем. */
export function commenterIdsOf(
  comments: ReadonlyArray<{ id?: string; from?: { id?: string } }>,
  commentIds: ReadonlySet<string>,
): Set<string> {
  return new Set(
    comments
      .filter((c) => c.id && commentIds.has(c.id))
      .map((c) => c.from?.id ?? "")
      .filter(Boolean),
  );
}

/** Meta отказала: на этот комментарий уже отвечали — человек сообщение получил. */
export function isPrivateReplyAlreadySent(raw: string): boolean {
  const text = raw.toLowerCase();
  return (
    text.includes("2534023") ||
    text.includes("privatereplyconsumed") ||
    text.includes("already sent a private reply")
  );
}

export function explainInstagramPrivateReplyError(raw: string): string {
  const text = raw.toLowerCase();
  if (
    text.includes("2534066") ||
    text.includes("granular scopes") ||
    text.includes("comment id is valid")
  )
    return (
      "Instagram отклонил private reply (код 2534066). Meta в самом тексте ошибки " +
      "называет две возможные причины разом и не уточняет, какая верна: недостаточно " +
      "прав токена на private reply (скоуп instagram_business_manage_messages) — или " +
      "невалидный comment ID/контекст. Публичный ответ в комментариях идёт другим вызовом " +
      "и скоупом (instagram_business_manage_comments), поэтому его успех не подтверждает " +
      "и не исключает ни одну из этих причин. Самое надёжное действие — переподключить " +
      "Instagram заново, явно подтвердив доступ к сообщениям на экране согласия Meta. " +
      "Если не поможет — в поддержку Zernio с этим кодом, comment ID и post ID."
    );
  if (text.includes("2534025") || text.includes("older than") || /\b7\s*day/.test(text))
    return "Instagram не принимает приватный ответ: комментарию больше 7 дней.";
  if (isPrivateReplyAlreadySent(raw))
    return "На этот комментарий приватный ответ уже уходил — Instagram даёт только один.";
  if (text.includes("1545133"))
    return (
      "Instagram с конца августа 2026 не принимает кнопки и вложения в первом DM тем, " +
      "кто не подписан. Отправьте голый текст без кнопки."
    );
  return raw;
}

/* ── Идентификаторы постов ─────────────────────────────────────────────
 * Comment-to-DM на конкретный пост требует оба id: platformPostId — media
 * id Instagram (длинная цифра), postId — id записи в Zernio (24 hex). Если
 * в правило уходит не тот — карточка выглядит живой, а комментарии рилса
 * Zernio не подписывает.
 */

export function isInstagramMediaId(value: string | null | undefined): boolean {
  return typeof value === "string" && /^\d{10,}$/.test(value.trim());
}

export function isZernioObjectId(value: string | null | undefined): boolean {
  return typeof value === "string" && /^[a-f0-9]{24}$/i.test(value.trim());
}

function asId(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

/** Id записи поста в Zernio: только 24-hex; media id и latePostId отбрасываем. */
export function pickZernioPostId(post: {
  postId?: unknown;
  _id?: unknown;
  id?: unknown;
  _zernioPostId?: unknown;
  latePostId?: unknown;
}): string | null {
  for (const value of [post._zernioPostId, post.postId, post._id, post.id]) {
    const id = asId(value);
    if (isZernioObjectId(id)) return id;
  }
  return null;
}

export function describeAutomationTargetIds(
  platformPostId?: string | null,
  postId?: string | null,
): string {
  const target = platformPostId?.trim() || "нет";
  const zernio = postId?.trim() || "нет";
  let flag = "";
  if (!postId?.trim()) flag = " [нет id Zernio — правило могли сохранить без обязательного postId]";
  else if (isInstagramMediaId(postId) || postId.trim() === platformPostId?.trim())
    flag = " [в postId лежит Instagram id, а не id поста Zernio]";
  else if (!isZernioObjectId(postId)) flag = " [postId не похож на id Zernio]";
  return `target=${target} zernioPost=${zernio}${flag}`;
}

/** Подпись типа медиа в селекте — чтобы не выбрать фото вместо рилса с тем же текстом. */
export function describePostMediaKind(post: {
  mediaProductType?: unknown;
  mediaType?: unknown;
  type?: unknown;
  _isStory?: unknown;
}): string {
  if (post._isStory === true) return "Stories";
  const raw = [post.mediaProductType, post.mediaType, post.type]
    .map((v) => (typeof v === "string" ? v.trim().toLowerCase() : ""))
    .find(Boolean);
  if (!raw) return "";
  if (raw.includes("reel")) return "Reels";
  if (raw.includes("carousel") || raw.includes("album")) return "Карусель";
  if (raw.includes("video")) return "Видео";
  if (raw.includes("image") || raw.includes("photo") || raw === "feed") return "Фото";
  if (raw.includes("story")) return "Stories";
  return raw;
}

/* ── Тело правила для Zernio ─────────────────────────────────────────── */

/** Предел длины первого сообщения (private-reply без кнопок). */
export const DM_LIMIT_PLAIN = 1000;

export type AutomationInput = {
  accountId: string;
  profileId?: string;
  name: string;
  trigger?: "comment" | "story_reply";
  platformPostId?: string | null;
  postId?: string | null;
  postTitle?: string;
  keywords?: string[];
  matchMode?: MatchMode;
  dmMessage?: string;
  buttons?: AutomationButton[];
  commentReply?: string;
  dmMessageVariations?: string[];
  commentReplyVariations?: string[];
  linkTracking?: boolean;
  clickTag?: string;
  isActive?: boolean;
  /** Наши поля, Zernio их не знает — хранятся в мета. */
  twoStepDm?: boolean;
  secondDmMessage?: string;
  secondDmButtons?: AutomationButton[];
  unresolvedPrompt?: string;
  /** Призыв ответить в конце первого сообщения двухшагового правила; "" — без призыва. */
  replyPrompt?: string;
};

/**
 * Тело запроса к автоматизации Zernio. null у id поста опускаем — это «все
 * посты»; пустую строку сохраняем — ею продавец очищает поле; пустой список
 * ключевых слов значащий — «любой комментарий». В двухшаговом режиме первое
 * сообщение уходит чистым текстом без кнопок (Meta пессимизирует кнопки в
 * первом DM), кнопки — вторым сообщением из мета.
 */
export function buildAutomationBody(data: Partial<AutomationInput>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) continue;
    if (
      key === "twoStepDm" ||
      key === "secondDmMessage" ||
      key === "secondDmButtons" ||
      key === "unresolvedPrompt" ||
      key === "replyPrompt"
    )
      continue;
    if ((key === "platformPostId" || key === "postId") && value === "") continue;
    body[key] = value;
  }
  // Первое сообщение (private-reply) — всегда без кнопок: Instagram не показывает
  // их тем, кто не подписан, а отказ тратит единственный ответ на комментарий.
  // Кнопки уходят вторым сообщением (channels/zernio/automations: sendSecondStep).
  delete body.buttons;
  if (Array.isArray(body.keywords))
    body.keywords = (body.keywords as string[]).map((k) => k.toLowerCase().trim()).filter(Boolean);

  const dmMessage = typeof body.dmMessage === "string" ? body.dmMessage : "";
  if (!dmMessage.trim())
    throw new UserError(
      "err.instagram.dmRequired",
      "Текст сообщения в Direct обязателен — без него автоматизации нечего отправить.",
    );

  const limit = DM_LIMIT_PLAIN;
  if (dmMessage.length > limit)
    throw new UserError(
      "err.instagram.dmTooLong",
      "Сообщение в Direct — {length} символов, предел {limit}. Сократите текст.",
      { length: dmMessage.length, limit },
    );
  for (const field of ["dmMessageVariations", "commentReplyVariations"] as const) {
    const variations = body[field];
    if (!Array.isArray(variations)) continue;
    if ((variations as string[]).some((t) => t.length > limit))
      throw new UserError(
        "err.instagram.variantTooLong",
        "Один из вариантов текста длиннее {limit} символов. Сократите его.",
        { limit },
      );
  }
  return body;
}

/**
 * Второе сообщение незнакомому покупателю уходит только после его ответа
 * (написать первым в Instagram нельзя), поэтому первое по умолчанию просит
 * ответить. «+» распознаёт isTwoStepAcknowledgement.
 */
export const DEFAULT_REPLY_PROMPT =
  "👉 Ответьте на это сообщение «+» (подойдёт любое слово), и я сразу пришлю кнопку, чтобы получить материал.";

/**
 * Прежние призывы по умолчанию. Правило, у которого в мете стоит один из них,
 * при чтении получает новый (upgradeReplyPrompt); первые сообщения, ушедшие
 * до замены, по-прежнему узнаются как призыв (второй шаг, пауза продавца).
 * Копилка, 09.10: на «Ответьте «+» в этот чат, и я пришлю ссылку» ответили
 * 74 из 237 комментаторов — «ссылка» не говорит, что придёт, и «+» читается
 * как единственный верный ответ.
 */
export const LEGACY_REPLY_PROMPTS = ["Ответьте «+» в этот чат, и я пришлю ссылку 👇"] as const;

/** Призывы, которыми может кончаться первое сообщение правила с призывом `prompt`. */
export function replyPromptsOf(prompt: string | null | undefined): string[] {
  const p = (prompt ?? DEFAULT_REPLY_PROMPT).trim();
  if (!p) return [];
  return p === DEFAULT_REPLY_PROMPT ? [p, ...LEGACY_REPLY_PROMPTS] : [p];
}

/** Первое сообщение с призывом в конце (если его там ещё нет). */
export function withReplyPrompt(dm: string, prompt: string | null | undefined): string {
  const p = prompt?.trim();
  if (!p) return dm;
  const base = dm.trimEnd();
  return base.endsWith(p) ? base : `${base}\n\n${p}`;
}

/** Текст продавца без призыва — для формы: при сохранении призыв добавится снова. */
export function stripReplyPrompt(dm: string, prompt: string | null | undefined): string {
  const p = prompt?.trim();
  if (!p) return dm;
  const base = dm.trimEnd();
  return base.endsWith(p) ? base.slice(0, -p.length).trimEnd() : dm;
}

/** Текст второго сообщения по умолчанию (двухшаговый режим). */
export const DEFAULT_SECOND_DM = "Для перехода в бот и получения материалов нажмите кнопку ниже 👇";

/**
 * Первое сообщение покупателя в Direct после двухшагового правила — часто
 * это «+», «1», «да»: он выполнил просьбу «напишите нам», и отвечать на это
 * консультантом или магазином не нужно.
 */
/**
 * Слово, которым покупатель зовёт магазин в переписке. При включённом
 * магазине оно идёт боту, даже сразу после второго сообщения: «/start» —
 * явная просьба показать каталог, а не «принято» (Educational Bot, 29.09:
 * «/start» после автоматизации оставался без ответа).
 */
export function isShopStartWord(text: string | null | undefined): boolean {
  const t = (text ?? "").trim().toLowerCase();
  return ["старт", "/start", "start", "купить", "материалы", "каталог"].includes(t);
}

export function isTwoStepAcknowledgement(text: string | null | undefined): boolean {
  const t = (text ?? "").trim().toLowerCase();
  return (
    !t ||
    ["+", ".", "1", "да", "ссылка", "материалы", "купить", "старт", "/start", "хочу"].includes(t)
  );
}

/**
 * Повторный комментарий «ничего нет / не пришло» под постом: первое
 * сообщение ушло, но покупатель его не видит — у неподписанных оно лежит в
 * папке «Запросы» (Копилка, 09.10: _queen_lebed_, _nonna2015_; на первое
 * ответили 52 из 221, из ответивших 57 из 62 — подписчики).
 */
const NOT_RECEIVED_RE = new RegExp(
  [
    "ничего\\s+нет",
    "нет\\s+ничего",
    "ничего\\s+не\\s+(пришл|приход|получ|вижу|видно)",
    "не\\s+(пришл|приходит|получил|вижу\\s+сообщ)",
    "где\\s+(сообщени|ссылк)",
    "ештеңе\\s+(жоқ|келмед)",
    "келмеді",
    "hech\\s+narsa\\s+yo",
    "kelmadi",
    "nothing\\s+(came|here|received)",
    "(didn.?t|did\\s+not|haven.?t)\\s+(get|receive)",
    "not\\s+received",
  ].join("|"),
  "i",
);

export function isNotReceivedComment(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && t.length <= 120 && NOT_RECEIVED_RE.test(t);
}

export type HintLang = "ru" | "kk" | "en" | "uz";

/** Язык подсказки — по тексту комментария; по умолчанию русский. */
export function commentLang(text: string): HintLang {
  if (/[әғқңөұүһі]/i.test(text)) return "kk";
  if (/[а-яё]/i.test(text)) return "ru";
  if (/\b(yo.?q|kelmadi|hech|narsa|olmadim)\b|[og][\u2018\u2019'`]/i.test(text)) return "uz";
  return /[a-z]/i.test(text) ? "en" : "ru";
}

/** Публичный ответ на «ничего нет»: сообщение уже в Direct, ищите в «Запросах». */
export const REQUESTS_HINT: Record<HintLang, string> = {
  ru: "Сообщение уже у вас в Direct 📩 Если его нет во входящих, загляните в папку «Запросы» и ответьте на него «+».",
  kk: "Хабарлама Direct-те тұр 📩 Кіріс хаттарда болмаса, «Сұраулар» бумасын қарап, оған «+» деп жауап беріңіз.",
  en: "The message is already in your Direct 📩 If it's not in your inbox, check the Requests folder and reply «+» to it.",
  uz: "Xabar allaqachon Direct’da 📩 Kiruvchilarda bo‘lmasa, «So‘rovlar» papkasini oching va unga «+» deb javob bering.",
};

/** Служебные слова не говорят, о каком товаре речь. */
const MENTION_STOPWORDS = new Set([
  "для",
  "или",
  "про",
  "при",
  "без",
  "под",
  "над",
  "вам",
  "вас",
  "все",
  "всё",
  "всю",
  "этим",
  "этом",
  "как",
  "что",
  "and",
  "the",
  "for",
  "цена",
  "цене",
  "цену",
]);

/**
 * Начала слов, которые ничего не называют: призыв под постом («Пишите слово
 * НУЖНО в комментариях, отправлю в личные сообщения информацию по получению
 * памяток» — так у AATeach почти все подписи) и общие слова названий
 * («Наглядность», «Комплект», «Памятки»).
 */
const MENTION_GENERIC_PREFIXES = [
  "пиши",
  "напиши",
  "слов",
  "кодов",
  "коммент",
  "видео",
  "рилс",
  "отправ",
  "личн",
  "сообщ",
  "директ",
  "direct",
  "информ",
  "получ",
  "приобрет",
  "подробн",
  "нужн",
  "хочу",
  "ссылк",
  "кнопк",
  "заказ",
  "купи",
  "оплат",
  "комплект",
  "памят",
  "наглядн",
  "набор",
  "пособ",
  "материал",
  "товар",
  "шаблон",
  "файл",
  "папк",
  "телеграм",
  "telegram",
];

/**
 * Слова, которые что-то называют: без регистра, «ё», эмодзи, знаков, номеров
 * и кодов («430.»), служебных слов и призыва под постом.
 */
function mentionWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(
      (w) =>
        w.length >= 3 &&
        !/\p{N}/u.test(w) &&
        !MENTION_STOPWORDS.has(w) &&
        !MENTION_GENERIC_PREFIXES.some((g) => w.startsWith(g)),
    );
}

/**
 * Одно слово в разных формах — общее начало: «хлеб»/«хлеба», «папка»/«папки»,
 * «профориентатора»/«профориентационная» (у длинных слов хватает шести букв).
 */
function sameStem(a: string, b: string): boolean {
  const n = Math.min(a.length, b.length);
  const need = Math.min(n, Math.max(3, Math.min(n - 2, 6)));
  return a.slice(0, need) === b.slice(0, need);
}

/**
 * Упоминается ли товар кнопки «Купить» в подписи поста правила: хоть одно
 * значимое слово названия есть в подписи с точностью до окончания.
 * Подсказка продавцу при сохранении, не запрет: правило «тестовый» под постом
 * «Папка профориентатора» продавало «Спряжение глаголов» (Копилка, #126, 11.10).
 * Подпись, где кроме призыва ничего нет («Пишите слово НУЖНО… по получению
 * памяток»), товар не называет — сравнивать не с чем, считаем «упоминается»:
 * иначе предупреждение горело у AATeach под каждым правилом (11.10).
 */
export function productMentionedInCaption(productName: string, caption: string): boolean {
  const captionWords = mentionWords(caption);
  if (captionWords.length < 2) return true;
  const nameWords = mentionWords(productName);
  if (!nameWords.length) return true;
  return nameWords.some((w) => captionWords.some((c) => sameStem(w, c)));
}

/** id товара кнопки «Купить» (payload `PROD:<id>`), по порядку кнопок. */
export function buyButtonProductIds(buttons: readonly AutomationButton[]): string[] {
  return buttons
    .filter((b) => b.type === "postback" && b.payload?.startsWith("PROD:"))
    .map((b) => b.payload!.slice("PROD:".length).trim())
    .filter(Boolean);
}
