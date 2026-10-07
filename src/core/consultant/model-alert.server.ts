import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Locale } from "@/core/i18n/locale";
import { getSettings, updateSettingAtomic } from "@/core/settings/settings";
import { sellerLocaleSafe } from "@/core/ai/seller-text";
import {
  classifyModelFailure,
  parseLastError,
  type ModelFailureKind,
} from "@/app/operator/consultant-alerts";

/**
 * Сигнал продавцу, что консультант перестал отвечать не на минуту, а
 * надолго (перенос v1 consultant-v2/model-alert.ts): ИИ-сервис отклоняет
 * запросы — оплата, ключ, лимит. 25.09 в v1 об этом узнали по журналу через
 * несколько часов, а консультант всё это время молча отдавал диалоги
 * менеджеру. Оператору о том же пишет крон здоровья
 * (app/operator/consultant-alerts); продавцу важно другое — что вопросы
 * покупателей сейчас ждут его самого.
 *
 * Вид сбоя — по `consultant_last_error`, который движок пишет при сбое и
 * стирает при удачном ответе. Не чаще раза в SELLER_ALERT_EVERY_MS на вид
 * сбоя: отметка ставится условной записью до отправки (значение маленькое —
 * не больше четырёх дат), из двух сообщений подряд продавцу пишет одно.
 */
export const SELLER_MODEL_ALERT_KEY = "consultant_model_alert_seller";
export const SELLER_ALERT_EVERY_MS = 3 * 60 * 60 * 1000;
const LAST_ERROR_KEY = "consultant_last_error";

const TEXT: Record<Locale, Record<ModelFailureKind, string>> = {
  ru: {
    billing:
      "⚠️ ИИ-консультант временно не отвечает: сервис ИИ отклоняет запросы (оплата на стороне платформы). Пока это так, каждый вопрос покупателя передаётся вам — ответьте сами.",
    auth: "⚠️ ИИ-консультант временно не отвечает: сервис ИИ не принимает ключ платформы. Пока это так, каждый вопрос покупателя передаётся вам — ответьте сами.",
    no_key:
      "⚠️ ИИ-консультант не отвечает: ключ ИИ на платформе не задан. Пока это так, вопросы покупателей передаются вам — ответьте сами.",
    limit:
      "⚠️ ИИ-консультант: сервис ИИ ограничил частоту запросов. Часть вопросов покупателей передаётся вам — ответьте сами.",
  },
  kk: {
    billing:
      "⚠️ ЖИ-кеңесші уақытша жауап бермейді: ЖИ сервисі сұрауларды қабылдамайды (платформа жағындағы төлем). Әзірге сатып алушының әр сұрағы сізге беріледі — өзіңіз жауап беріңіз.",
    auth: "⚠️ ЖИ-кеңесші уақытша жауап бермейді: ЖИ сервисі платформа кілтін қабылдамайды. Әзірге сатып алушының әр сұрағы сізге беріледі — өзіңіз жауап беріңіз.",
    no_key:
      "⚠️ ЖИ-кеңесші жауап бермейді: платформада ЖИ кілті берілмеген. Әзірге сатып алушылардың сұрақтары сізге беріледі — өзіңіз жауап беріңіз.",
    limit:
      "⚠️ ЖИ-кеңесші: ЖИ сервисі сұраулар жиілігін шектеді. Сатып алушылар сұрақтарының бір бөлігі сізге беріледі — өзіңіз жауап беріңіз.",
  },
  en: {
    billing:
      "⚠️ The AI consultant is temporarily not replying: the AI service is rejecting requests (billing on the platform side). Until this is fixed, every customer question is passed to you — please reply yourself.",
    auth: "⚠️ The AI consultant is temporarily not replying: the AI service does not accept the platform key. Until this is fixed, every customer question is passed to you — please reply yourself.",
    no_key:
      "⚠️ The AI consultant is not replying: no AI key is set on the platform. Until this is fixed, customer questions are passed to you — please reply yourself.",
    limit:
      "⚠️ AI consultant: the AI service is rate-limiting requests. Some customer questions are passed to you — please reply yourself.",
  },
  uz: {
    billing:
      "⚠️ SI maslahatchi vaqtincha javob bermayapti: SI xizmati so‘rovlarni rad etmoqda (platforma tomonidagi to‘lov). Hozircha xaridorning har bir savoli sizga uzatiladi — o‘zingiz javob bering.",
    auth: "⚠️ SI maslahatchi vaqtincha javob bermayapti: SI xizmati platforma kalitini qabul qilmayapti. Hozircha xaridorning har bir savoli sizga uzatiladi — o‘zingiz javob bering.",
    no_key:
      "⚠️ SI maslahatchi javob bermayapti: platformada SI kaliti berilmagan. Hozircha xaridorlarning savollari sizga uzatiladi — o‘zingiz javob bering.",
    limit:
      "⚠️ SI maslahatchi: SI xizmati so‘rovlar chastotasini cheklladi. Xaridorlar savollarining bir qismi sizga uzatiladi — o‘zingiz javob bering.",
  },
};

export function sellerModelAlertText(locale: Locale, kind: ModelFailureKind): string {
  return TEXT[locale][kind];
}

type Marks = Partial<Record<ModelFailureKind, string>>;

function parseMarks(raw: string | null): Marks {
  try {
    const v = raw ? (JSON.parse(raw) as unknown) : {};
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Marks) : {};
  } catch {
    return {};
  }
}

/**
 * После передачи менеджеру: если причина — долгий сбой ИИ, написать
 * продавцу (не чаще раза в три часа на вид сбоя). Ничего не бросает: сбой
 * уведомления не мешает переписке.
 */
export async function alertSellerModelFailure(
  ctx: TenantContext,
  notify: (html: string) => Promise<number>,
  now = Date.now(),
): Promise<"sent" | "none" | "throttled" | "failed"> {
  try {
    const last = parseLastError((await getSettings(ctx, [LAST_ERROR_KEY]))[LAST_ERROR_KEY]);
    const kind = classifyModelFailure(last?.detail);
    if (!last || !kind) return "none";
    // Сбой старше окна — не про это сообщение.
    if (now - Date.parse(last.at) > SELLER_ALERT_EVERY_MS) return "none";
    const nowIso = new Date(now).toISOString();
    const claimed = await updateSettingAtomic(ctx, SELLER_MODEL_ALERT_KEY, (raw) => {
      const marks = parseMarks(raw);
      const prev = Date.parse(marks[kind] ?? "");
      if (Number.isFinite(prev) && now - prev < SELLER_ALERT_EVERY_MS) return null;
      return JSON.stringify({ ...marks, [kind]: nowIso });
    });
    if (claimed === "skipped") return "throttled";
    if (claimed !== "written") return "failed";
    const sent = await notify(sellerModelAlertText(await sellerLocaleSafe(ctx), kind));
    return sent > 0 ? "sent" : "failed";
  } catch (e) {
    console.error(`[consultant:${ctx.tenant.id}] продавцу о сбое ИИ не сообщено`, e);
    return "failed";
  }
}
