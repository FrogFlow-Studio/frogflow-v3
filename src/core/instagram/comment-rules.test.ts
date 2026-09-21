import { describe, expect, it } from "vitest";
import {
  FALLBACK_MAX_AGE_MS,
  FALLBACK_MIN_AGE_MS,
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
  isZernioObjectId,
  pickZernioPostId,
  stalePendingAction,
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
    expect(commentAgeVerdict(ago(60_000), now)).toBe("too_new");
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
  it("с кнопками предел 640 символов", () => {
    const buttons = [{ type: "postback" as const, title: "Купить", payload: "BUY" }];
    expect(() => buildAutomationBody({ ...base, dmMessage: "я".repeat(641), buttons })).toThrow(
      /640/,
    );
    expect(() =>
      buildAutomationBody({ ...base, dmMessage: "я".repeat(640), buttons }),
    ).not.toThrow();
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

describe("isTwoStepAcknowledgement", () => {
  it("«+», «1», «да» и пустое — это ответ на просьбу написать, а не вопрос", () => {
    expect(isTwoStepAcknowledgement("+")).toBe(true);
    expect(isTwoStepAcknowledgement(" Да ")).toBe(true);
    expect(isTwoStepAcknowledgement("")).toBe(true);
    expect(isTwoStepAcknowledgement("сколько стоит?")).toBe(false);
  });
});
