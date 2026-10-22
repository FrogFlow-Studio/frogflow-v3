import { describe, expect, it } from "vitest";
import {
  buyButtonProductIds,
  commentOnRulePost,
  FALLBACK_MAX_AGE_MS,
  FALLBACK_MIN_AGE_MS,
  productMentionedInCaption,
  STALE_PENDING_MS,
  annotateCommentStatus,
  buildAutomationBody,
  commentAgeVerdict,
  commentMatchesAutomation,
  commentPrivateReplyBlockReason,
  describeAutomationTargetIds,
  describePostMediaKind,
  explainInstagramPrivateReplyError,
  fallbackRecordStatus,
  isInstagramMediaId,
  isTwoStepAcknowledgement,
  isShopStartWord,
  isZernioObjectId,
  pickZernioPostId,
  stalePendingAction,
  commentCoveredByLogs,
  commentIdsHandledByZernio,
  commenterIdsOf,
  isPrivateReplyAlreadySent,
  isGenericDmKeyword,
  logCoverage,
  logsReachBack,
  LOG_LAG_MS,
  sharedRuleKeywords,
} from "./comment-rules";

/**
 * Ошибка здесь либо пропускает резервную DM мимо реального совпадения
 * (клиент снова не получает ответ), либо шлёт её человеку, чей комментарий
 * ничего общего с правилом не имел, — обе цены высоки.
 */
describe("commentMatchesAutomation", () => {
  it("пустой список ключевых слов — совпадает любой комментарий", () => {
    expect(commentMatchesAutomation("что угодно", [], "contains")).toBe(true);
    expect(commentMatchesAutomation("что угодно", undefined, "exact")).toBe(true);
  });
  it("contains: совпадает по вхождению подстроки, без учёта регистра", () => {
    expect(commentMatchesAutomation("хочу ГОД себе", ["год"], "contains")).toBe(true);
    expect(commentMatchesAutomation("совсем другое", ["год"], "contains")).toBe(false);
  });
  it("exact: совпадает только при полном равенстве текста и ключевого слова", () => {
    expect(commentMatchesAutomation("год", ["Год"], "exact")).toBe(true);
    expect(commentMatchesAutomation("хочу год себе", ["год"], "exact")).toBe(false);
  });
  it("exact: пробелы по краям комментария не мешают совпадению", () => {
    expect(commentMatchesAutomation("  год  ", ["год"], "exact")).toBe(true);
  });
  it("совпадает любое из нескольких ключевых слов", () => {
    expect(commentMatchesAutomation("хочу цена", ["год", "цена"], "contains")).toBe(true);
  });
  it("пустая строка среди ключевых слов не совпадает со всем подряд", () => {
    expect(commentMatchesAutomation("год", ["", "цена"], "contains")).toBe(false);
  });
});

describe("commentAgeVerdict", () => {
  const now = new Date("2026-01-15T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  it("слишком новый комментарий — даём Zernio шанс сработать первым", () => {
    expect(commentAgeVerdict(ago(30_000), now)).toBe("too_new");
  });
  it("комментарий в разумном окне — можно пробовать резервную отправку", () => {
    expect(commentAgeVerdict(ago(3_600_000), now)).toBe("eligible");
  });
  it("комментарий старше 7-дневного окна private-reply — не пытаемся", () => {
    expect(commentAgeVerdict(ago(8 * 86_400_000), now)).toBe("too_old");
  });
  it("неразбираемая дата — не отправляем вслепую", () => {
    expect(commentAgeVerdict("не дата", now)).toBe("too_old");
  });
  it("границы окна согласованы с экспортированными константами", () => {
    expect(commentAgeVerdict(ago(FALLBACK_MIN_AGE_MS - 1000), now)).toBe("too_new");
    expect(commentAgeVerdict(ago(FALLBACK_MIN_AGE_MS + 1000), now)).toBe("eligible");
    expect(commentAgeVerdict(ago(FALLBACK_MAX_AGE_MS - 1000), now)).toBe("eligible");
    expect(commentAgeVerdict(ago(FALLBACK_MAX_AGE_MS + 1000), now)).toBe("too_old");
  });
});

describe("annotateCommentStatus", () => {
  const automation = { keywords: ["год"], matchMode: "contains" as const };
  const sent = new Set(["c-sent"]);
  const failed = new Set(["c-failed"]);
  const st = (c: Parameters<typeof annotateCommentStatus>[0], a = automation) =>
    annotateCommentStatus(c, a, sent, failed);
  it("комментарий от самого аккаунта — не адресат", () => {
    expect(st({ id: "c1", message: "год", from: { isOwner: true } })).toBe("owner");
  });
  it("уже отправлено Zernio — есть в логах со статусом sent", () => {
    expect(st({ id: "c-sent", message: "год" })).toBe("sent");
  });
  it("нет привязанного правила к посту вовсе", () => {
    expect(annotateCommentStatus({ id: "c1", message: "год" }, null, sent, failed)).toBe(
      "no_automation",
    );
  });
  it("правило есть, но ключевое слово не совпало", () => {
    expect(st({ id: "c1", message: "просто спасибо" })).toBe("no_match");
  });
  it("совпало, Zernio пытался и провалил отправку — есть в логах со статусом failed", () => {
    expect(st({ id: "c-failed", message: "год" })).toBe("failed");
  });
  it("совпало, но нигде в логах не встречается — похоже, пропущено", () => {
    expect(st({ id: "c-new", message: "год" })).toBe("missing");
  });
});

describe("commentPrivateReplyBlockReason", () => {
  const now = new Date("2026-09-05T12:00:00Z");
  const hourAgo = new Date(now.getTime() - 3_600_000).toISOString();
  it("ответ в ветке — Instagram не принимает private reply", () => {
    expect(commentPrivateReplyBlockReason({ parentId: "p", createdTime: hourAgo }, now)).toBe(
      "nested",
    );
  });
  it("canReply=false — не пытаемся", () => {
    expect(commentPrivateReplyBlockReason({ createdTime: hourAgo, canReply: false }, now)).toBe(
      "cannot_reply",
    );
  });
  it("старше 7 дней — не пытаемся", () => {
    const old = new Date(now.getTime() - 8 * 86_400_000).toISOString();
    expect(commentPrivateReplyBlockReason({ createdTime: old }, now)).toBe("too_old");
  });
  it("обычный свежий комментарий к посту — можно слать", () => {
    expect(
      commentPrivateReplyBlockReason({ createdTime: hourAgo, canReply: true }, now),
    ).toBeNull();
  });
});

describe("explainInstagramPrivateReplyError", () => {
  it("2534066 отделяет private reply от публичного ответа в комментариях, не выбирая одну причину", () => {
    const explained = explainInstagramPrivateReplyError(
      'Zernio API 403: {"error":"Please check if access token has enough IG permissions granular scopes for IG private reply. Or, verify if the comment ID is valid","error_subcode":2534066}',
    );
    expect(explained).toMatch(/2534066/);
    expect(explained).toMatch(/instagram_business_manage_messages/);
    expect(explained).toMatch(/публичн/i);
    expect(explained).toMatch(/comment ID/);
    expect(explained).not.toMatch(/холодный DM этим методом Instagram не принимает/i);
  });
  it("окно 7 дней и повторный private reply получают короткий текст", () => {
    expect(explainInstagramPrivateReplyError("comment older than 7 days")).toMatch(/7 дней/);
    expect(explainInstagramPrivateReplyError("already sent a private reply")).toMatch(/уже уходил/);
  });
  it("незнакомый текст оставляем как есть", () => {
    expect(explainInstagramPrivateReplyError("rate limited")).toBe("rate limited");
  });
});

describe("stalePendingAction", () => {
  const now = new Date("2026-09-09T12:00:00Z");
  const ts = now.toISOString();
  it("sent/failed не трогаем", () => {
    expect(stalePendingAction({ status: "sent", created_at: ts, updated_at: ts }, now)).toBe(
      "skip",
    );
    expect(stalePendingAction({ status: "failed", created_at: ts, updated_at: ts }, now)).toBe(
      "skip",
    );
  });
  it("свежий pending — ждём, вдруг прогон ещё жив", () => {
    const c = new Date(now.getTime() - 120_000).toISOString();
    expect(stalePendingAction({ status: "pending", created_at: c, updated_at: c }, now)).toBe(
      "wait",
    );
  });
  it("первый зависший pending — один повтор private-reply", () => {
    const c = new Date(now.getTime() - STALE_PENDING_MS - 1000).toISOString();
    expect(stalePendingAction({ status: "pending", created_at: c, updated_at: c }, now)).toBe(
      "retry",
    );
  });
  it("pending, который уже подхватывали — больше не пишем в директ", () => {
    const c = new Date(now.getTime() - 40 * 60_000).toISOString();
    const u = new Date(now.getTime() - STALE_PENDING_MS - 1000).toISOString();
    expect(stalePendingAction({ status: "pending", created_at: c, updated_at: u }, now)).toBe(
      "abandon",
    );
  });
});

describe("fallbackRecordStatus", () => {
  it("альт-канал доставил — это успех, не failed", () => {
    expect(fallbackRecordStatus(false, "sent")).toBe("sent");
    expect(fallbackRecordStatus(true, "skipped")).toBe("sent");
    expect(fallbackRecordStatus(false, "failed")).toBe("failed");
    expect(fallbackRecordStatus(false, "skipped")).toBe("failed");
  });
});

describe("идентификаторы постов", () => {
  it("берёт analytics.postId — в доке Zernio это id поста", () => {
    expect(
      pickZernioPostId({
        postId: "65f1c0a9e2b5af0012ab34cd",
        latePostId: "late",
        id: "17942086977344770",
      }),
    ).toBe("65f1c0a9e2b5af0012ab34cd");
  });
  it("не подставляет Instagram media id вместо id Zernio", () => {
    expect(
      pickZernioPostId({
        postId: "17942086977344770",
        _id: "18121857844889708",
        id: "17942086977344770",
        latePostId: "6a9b970a83a464fd98bd41b4",
      }),
    ).toBeNull();
  });
  it("не берёт latePostId — это id издателя, не поста", () => {
    expect(pickZernioPostId({ latePostId: "65f1c0a9e2b5af0012ab34cd" })).toBeNull();
  });
  it("принимает _id из GET /posts", () => {
    expect(pickZernioPostId({ _id: "65f1c0a9e2b5af0012ab34cd" })).toBe("65f1c0a9e2b5af0012ab34cd");
  });
  it("отличает media id Instagram от ObjectId Zernio", () => {
    expect(isInstagramMediaId("17942086977344770")).toBe(true);
    expect(isInstagramMediaId("65f1c0a9e2b5af0012ab34cd")).toBe(false);
    expect(isZernioObjectId("65f1c0a9e2b5af0012ab34cd")).toBe(true);
    expect(isZernioObjectId("17942086977344770")).toBe(false);
  });
  it("помечает правило, где в postId лежит Instagram id, и правило без postId", () => {
    expect(describeAutomationTargetIds("17942086977344770", "17942086977344770")).toMatch(
      /Instagram id/,
    );
    expect(describeAutomationTargetIds("17942086977344770", null)).toMatch(/нет id Zernio/);
    expect(describeAutomationTargetIds("17942086977344770", "65f1c0a9e2b5af0012ab34cd")).toBe(
      "target=17942086977344770 zernioPost=65f1c0a9e2b5af0012ab34cd",
    );
  });
  it("отделяет Reels от фото", () => {
    expect(describePostMediaKind({ mediaProductType: "REELS" })).toBe("Reels");
    expect(describePostMediaKind({ mediaType: "image" })).toBe("Фото");
    expect(describePostMediaKind({ _isStory: true })).toBe("Stories");
  });
});

/**
 * Сборка тела запроса к автоматизации — место, где легко навредить в обе
 * стороны: не вычистишь null — уйдёт «на все посты» как значение поля;
 * вычистишь слишком усердно — продавец не сможет очистить публичный ответ.
 */
describe("buildAutomationBody", () => {
  const base = { accountId: "acc-1", name: "Правило", dmMessage: "Привет!", keywords: ["хочу"] };
  it("опускает null у идентификаторов поста — это автоматизация на все посты", () => {
    const body = buildAutomationBody({ ...base, platformPostId: null, postId: null });
    expect(body).not.toHaveProperty("platformPostId");
    expect(body).not.toHaveProperty("postId");
  });
  it("сохраняет пустую строку — ею оператор очищает поле", () => {
    const body = buildAutomationBody({ ...base, commentReply: "", clickTag: "" });
    expect(body.commentReply).toBe("");
    expect(body.clickTag).toBe("");
  });
  it("сохраняет пустой список ключевых слов — это «любой комментарий»", () => {
    expect(buildAutomationBody({ ...base, keywords: [] }).keywords).toEqual([]);
  });
  it("приводит ключевые слова к нижнему регистру и убирает пустые", () => {
    expect(
      buildAutomationBody({ ...base, keywords: ["Хочу", "  ЦЕНА  ", "", "   "] }).keywords,
    ).toEqual(["хочу", "цена"]);
  });
  it("требует текст сообщения — без него отправлять нечего", () => {
    expect(() => buildAutomationBody({ ...base, dmMessage: "   " })).toThrow(/обязателен/i);
  });
  it("кнопки не уходят в первое сообщение и предел — 1000 символов, как без кнопок", () => {
    const buttons = [{ type: "postback" as const, title: "Купить", payload: "BUY" }];
    const body = buildAutomationBody({ ...base, dmMessage: "я".repeat(1000), buttons });
    expect(body).not.toHaveProperty("buttons");
    expect(() => buildAutomationBody({ ...base, dmMessage: "я".repeat(1001), buttons })).toThrow(
      /1000/,
    );
  });
  it("без кнопок предел 1000 символов", () => {
    expect(() => buildAutomationBody({ ...base, dmMessage: "я".repeat(1001) })).toThrow(/1000/);
    expect(() => buildAutomationBody({ ...base, dmMessage: "я".repeat(1000) })).not.toThrow();
  });
  it("проверяет длину и у вариантов текста — они ротируются наравне с основным", () => {
    expect(() => buildAutomationBody({ ...base, dmMessageVariations: ["я".repeat(1001)] })).toThrow(
      /вариантов/i,
    );
  });
  it("двухшаговый режим: кнопки не уходят в первое сообщение, наши поля — не в Zernio", () => {
    const body = buildAutomationBody({
      ...base,
      twoStepDm: true,
      buttons: [{ type: "url", title: "Бот", url: "https://t.me/x" }],
      secondDmMessage: "второе",
      unresolvedPrompt: "напишите нам",
    });
    expect(body).not.toHaveProperty("buttons");
    expect(body).not.toHaveProperty("twoStepDm");
    expect(body).not.toHaveProperty("secondDmMessage");
    expect(body).not.toHaveProperty("unresolvedPrompt");
  });
});

describe("isShopStartWord", () => {
  it("«/start», «Старт», «каталог» — зов магазина; «+» и вопрос — нет", () => {
    expect(isShopStartWord("/start")).toBe(true);
    expect(isShopStartWord(" Старт ")).toBe(true);
    expect(isShopStartWord("каталог")).toBe(true);
    expect(isShopStartWord("+")).toBe(false);
    expect(isShopStartWord("сколько стоит?")).toBe(false);
  });
});

describe("isTwoStepAcknowledgement", () => {
  it("«+», «1», «да» и пустое — это ответ на просьбу написать, а не вопрос", () => {
    expect(isTwoStepAcknowledgement("+")).toBe(true);
    expect(isTwoStepAcknowledgement("++")).toBe(true);
    expect(isTwoStepAcknowledgement("+++")).toBe(true);
    expect(isTwoStepAcknowledgement("+7 777")).toBe(false);
    expect(isTwoStepAcknowledgement(" Да ")).toBe(true);
    expect(isTwoStepAcknowledgement("")).toBe(true);
    expect(isTwoStepAcknowledgement("сколько стоит?")).toBe(false);
  });
});

describe("logCoverage / commentCoveredByLogs", () => {
  const hour = 60 * 60 * 1000;
  const now = Date.parse("2026-09-24T12:00:00Z");
  const at = (hoursAgo: number) => new Date(now - hoursAgo * hour).toISOString();

  it("прочитаны все логи — отвечаем за любой комментарий", () => {
    const coverage = logCoverage([{ createdAt: at(1) }], true);
    expect(commentCoveredByLogs(at(150), coverage)).toBe(true);
  });

  it("живой случай: 200 логов за последние сутки — комментарий трёхдневной давности не наш", () => {
    const logs = Array.from({ length: 200 }, (_, i) => ({ createdAt: at(i * 0.1) }));
    const coverage = logCoverage(logs, false);
    expect(commentCoveredByLogs(at(72), coverage)).toBe(false);
    expect(commentCoveredByLogs(at(5), coverage)).toBe(true);
    // Свежий комментарий, на который Zernio так и не ответил, — ради него крон и есть.
    expect(commentCoveredByLogs(at(0.5), coverage)).toBe(true);
  });

  it("старые сверху: про всё новее последней прочитанной записи не знаем", () => {
    const logs = [{ createdAt: at(100) }, { createdAt: at(90) }, { createdAt: at(80) }];
    const coverage = logCoverage(logs, false);
    expect(commentCoveredByLogs(at(95), coverage)).toBe(true);
    expect(commentCoveredByLogs(at(10), coverage)).toBe(false);
    expect(coverage?.to).toBe(Date.parse(at(80)) - LOG_LAG_MS);
  });

  it("без разбираемых дат не отвечаем ни за один комментарий", () => {
    expect(logCoverage([{ createdAt: "вчера" }], false)).toBeNull();
    expect(commentCoveredByLogs(at(1), null)).toBe(false);
  });

  it("logsReachBack — есть запись не новее границы", () => {
    const logs = [{ createdAt: at(1) }, { createdAt: at(200) }];
    expect(logsReachBack(logs, now - 156 * hour)).toBe(true);
    expect(logsReachBack([{ createdAt: at(1) }], now - 156 * hour)).toBe(false);
  });
});

describe("commentIdsHandledByZernio / commenterIdsOf", () => {
  it("sent и skipped — обработано Zernio, failed — нет", () => {
    const ids = commentIdsHandledByZernio([
      { status: "sent", commentId: "a" },
      { status: "skipped", commentId: "b" },
      { status: "failed", commentId: "c" },
    ]);
    expect([...ids].sort()).toEqual(["a", "b"]);
  });

  it("авторы обработанных комментариев", () => {
    const comments = [
      { id: "a", from: { id: "u1" } },
      { id: "b", from: { id: "u2" } },
    ];
    expect([...commenterIdsOf(comments, new Set(["a"]))]).toEqual(["u1"]);
  });
});

describe("isPrivateReplyAlreadySent", () => {
  it("отказ Meta «уже отвечали» узнаём по коду и по тексту", () => {
    expect(isPrivateReplyAlreadySent("(#10) ... error_subcode 2534023")).toBe(true);
    expect(isPrivateReplyAlreadySent("You have already sent a private reply")).toBe(true);
    expect(isPrivateReplyAlreadySent("2534066 comment id is valid")).toBe(false);
  });
});

describe("«ничего нет» под постом", () => {
  it("узнаёт жалобу на четырёх языках и не трогает обычные комментарии", async () => {
    const { isNotReceivedComment, commentLang } = await import("./comment-rules");
    for (const t of [
      "@kopilka_rusoveda нет ничего",
      "Ничего нет",
      "не пришло",
      "ничего не пришло(",
      "где ссылка?",
      "ештеңе жоқ",
      "келмеді",
      "hech narsa yo'q",
      "nothing came",
      "I didn't get it",
    ])
      expect(isNotReceivedComment(t.toLowerCase()), t).toBe(true);
    for (const t of ["палитра", "хочу", "+", "очень нужно, спасибо", "цена?"])
      expect(isNotReceivedComment(t), t).toBe(false);
    expect(commentLang("Ничего нет")).toBe("ru");
    expect(commentLang("ештеңе жоқ")).toBe("kk");
    expect(commentLang("hech narsa yo'q")).toBe("uz");
    expect(commentLang("nothing came")).toBe("en");
  });
});

describe("commentOnRulePost: под своим ли постом комментарий", () => {
  it("id поста у правила — строгое равенство", () => {
    expect(commentOnRulePost({ platformPostId: "1" }, "1", "x")).toBe(true);
    expect(commentOnRulePost({ platformPostId: "1" }, "2", "x")).toBe(false);
    expect(commentOnRulePost({ platformPostId: "1" }, null, "x")).toBe(false);
  });
  it("без id — по подписи: одна начинается с другой, регистр, пробелы и «…» не важны", () => {
    const rule = { postTitle: "Пишите слово НУЖНО в комментариях ➡️ отправлю 🍁…" };
    expect(
      commentOnRulePost(rule, "p", "пишите слово нужно в\nкомментариях ➡️ отправлю 🍁 ещё текст"),
    ).toBe(true);
    expect(commentOnRulePost(rule, "p", "Пишите слово НУЖНО в комментариях ➡️ отправлю 💐")).toBe(
      false,
    );
    expect(commentOnRulePost(rule, "p", "Пишите слово НУЖНО")).toBe(true);
  });
  it("подписи в событии нет — unknown; правило без поста и подписи — на все посты", () => {
    expect(commentOnRulePost({ postTitle: "Палитра" }, "p", null)).toBe("unknown");
    expect(commentOnRulePost({ postTitle: "Палитра" }, "p", "  ")).toBe("unknown");
    expect(commentOnRulePost({}, "p", "что угодно")).toBe(true);
    expect(commentOnRulePost({ platformPostId: null, postTitle: null }, null, null)).toBe(true);
  });
});

describe("productMentionedInCaption — товар кнопки «Купить» и подпись поста", () => {
  it("Копилка #126: «Спряжение глаголов» под постом «Папка профориентатора» — не упомянут", () => {
    expect(
      productMentionedInCaption(
        "Спряжение глаголов",
        "📂 Папка профориентатора: всё для классного часа…",
      ),
    ).toBe(false);
  });

  it("эмодзи, регистр, знаки и окончания не мешают", () => {
    expect(productMentionedInCaption("Палитра", "🎨 ПАЛИТРА! Пишите «Палитра»")).toBe(true);
    expect(productMentionedInCaption("Набор «Хлеб»", "Ко дню хлеба — набор")).toBe(true);
    expect(productMentionedInCaption("Профориентационная папка", "📂 Папка профориентатора")).toBe(
      true,
    );
    expect(productMentionedInCaption("Ёжик", "Пособие «Ежик» для малышей")).toBe(true);
  });

  it("AATeach 11.10: подпись — только призыв «НУЖНО», товар с номером — не предупреждаем", () => {
    expect(
      productMentionedInCaption(
        "430. Наглядность ЕДИНИЦЫ ИЗМЕРЕНИЯ",
        "📐Пишите слово НУЖНО в комментариях под этим видео и я отправлю вам в личные сообщения всю информацию по получению памяток",
      ),
    ).toBe(true);
    expect(
      productMentionedInCaption(
        "Комплект «Осень»",
        "Пишите слово НУЖНО в комментариях ➡️ в личные сообщения отправлю всю информацию по получению комплекта 🍁",
      ),
    ).toBe(true);
  });

  it("номер и общие слова названия не считаются, значимые — считаются", () => {
    expect(
      productMentionedInCaption(
        "430. Наглядность ЕДИНИЦЫ ИЗМЕРЕНИЯ",
        "📐 Памятки «Единицы измерения» для начальной школы. Пишите НУЖНО",
      ),
    ).toBe(true);
    expect(
      productMentionedInCaption(
        "430. Наглядность ЕДИНИЦЫ ИЗМЕРЕНИЯ",
        "Папка классного руководителя на весь год",
      ),
    ).toBe(false);
  });

  it("служебные слова названия совпадением не считаются", () => {
    expect(
      productMentionedInCaption("Карточки для чтения", "Шаблоны для учителя начальных классов"),
    ).toBe(false);
  });

  it("подписи нет — сравнивать не с чем, предупреждения нет", () => {
    expect(productMentionedInCaption("Палитра", "")).toBe(true);
    expect(productMentionedInCaption("Палитра", "🎨✨")).toBe(true);
  });
});

describe("buyButtonProductIds", () => {
  it("берёт id только из postback-кнопок PROD:", () => {
    expect(
      buyButtonProductIds([
        { type: "url", title: "Сайт", url: "https://x" },
        { type: "postback", title: "Каталог", payload: "CATALOG" },
        { type: "postback", title: "Купить", payload: "PROD:42" },
      ]),
    ).toEqual(["42"]);
  });
});

describe("isGenericDmKeyword & sharedRuleKeywords — проверка кодовых слов в форме правила", () => {
  it("«+», «нужно», «хочу», «цена» — общие для Direct; название и номер материала — нет", () => {
    for (const kw of ["+", "+++", "нужно", "Нужна", "хочу", "цена", "купить", "да"])
      expect(isGenericDmKeyword(kw), kw).toBe(true);
    for (const kw of ["Палитра", "405", "день хлеба", "хочу палитру"])
      expect(isGenericDmKeyword(kw), kw).toBe(false);
    expect(isGenericDmKeyword("   ")).toBe(false);
  });

  it("находит пересечения ключевых слов только с активными правилами того же аккаунта", () => {
    const rules = [
      {
        id: "r1",
        name: "489 Подвеска",
        accountId: "acc-1",
        isActive: true,
        keywords: ["+", "нужно"],
      },
      {
        id: "r2",
        name: "488 Осень",
        accountId: "acc-1",
        isActive: true,
        keywords: ["НУЖНО", "осень"],
      },
      { id: "r3", name: "Старое", accountId: "acc-1", isActive: false, keywords: ["осень"] },
      { id: "r4", name: "Чужой аккаунт", accountId: "acc-2", isActive: true, keywords: ["осень"] },
    ];
    expect(
      sharedRuleKeywords(["Нужно", "осень", "уникальное"], rules, {
        id: "r1",
        accountId: "acc-1",
      }),
    ).toEqual([
      { keyword: "Нужно", rules: ["488 Осень"] },
      { keyword: "осень", rules: ["488 Осень"] },
    ]);
  });
});
