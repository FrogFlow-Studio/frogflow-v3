/**
 * Второе сообщение двухшагового правила не ушло в старую переписку. У AATeach
 * 10.10 так было 24 раза: покупатель уже писал в Direct давно, бот сразу
 * слал «Купить» в ту переписку, Instagram отказывал, а журнал говорил
 * «Проверьте подключение Instagram» — подключение было в порядке. Здесь
 * правдивая запись для журнала и тот же выбор текстом, без кнопок.
 */
import type { Locale } from "@/core/i18n/locale";
import type { DmButton } from "./api.server";
import { classifyZernioFailure, type ZernioFailure } from "./errors";

function codeOf(f: ZernioFailure | undefined): string {
  if (f?.platformCode != null)
    return ` (код Meta ${f.platformCode}${f.platformSubcode ? `/${f.platformSubcode}` : ""})`;
  if (f?.code) return ` (${f.code})`;
  return f?.status ? ` (HTTP ${f.status})` : "";
}

const LATER = "Второе сообщение с кнопками уйдёт, как только покупатель ответит в Direct.";

/** Запись журнала: что случилось на самом деле и что будет дальше. */
export function secondStepFailureText(
  f: ZernioFailure | undefined,
  text: "sent" | "failed" | "skipped",
): string {
  const kind = classifyZernioFailure(f);
  if (kind === "window_closed")
    return `Instagram не дал написать в старую переписку: покупатель не писал в Direct больше суток. ${LATER}`;
  if (kind === "rate_limited") return `Instagram временно ограничил отправку. ${LATER}`;
  if (kind === "ambiguous")
    return "Instagram не подтвердил отправку второго сообщения: оно могло дойти. Проверьте переписку; при ответе покупателя бот пришлёт его снова.";
  if (text === "sent")
    return `Instagram не принял кнопки в старой переписке${codeOf(f)} — тот же выбор ушёл текстом. ${LATER}`;
  if (text === "failed")
    return `Instagram не принял сообщение в старой переписке ни с кнопками, ни текстом${codeOf(f)}. ${LATER}`;
  return `Instagram не принял второе сообщение в старой переписке${codeOf(f)}. ${LATER}`;
}

/** Повторить без кнопок можно только после точного отказа: дошедшее не дублируем. */
export function textFallbackAllowed(f: ZernioFailure | undefined): boolean {
  return classifyZernioFailure(f) === "permanent";
}

const REPLY_PLUS: Record<Locale, string> = {
  ru: "Чтобы купить, ответьте на это сообщение «+».",
  kk: "Сатып алу үшін осы хабарламаға «+» деп жауап беріңіз.",
  en: "To buy, reply “+” to this message.",
  uz: "Sotib olish uchun ushbu xabarga «+» deb javob bering.",
};
/** Текст правила зовёт нажать кнопку — без кнопки он врёт, поэтому не берём его. */
const MENTIONS_BUTTON = /кнопк|түйме|tugma|button|👇|⬇/iu;

/**
 * Второе сообщение без кнопок: ссылки — адресом, «Купить» и прочие
 * postback — «ответьте «+»» (ответ откроет переписку, и придут кнопки или
 * сразу заказ, deliverPendingTwoStepDm).
 */
export function secondStepAsText(locale: Locale, secondText: string, buttons: DmButton[]): string {
  const lines: string[] = [];
  const head = secondText.trim();
  if (head && !MENTIONS_BUTTON.test(head)) lines.push(head);
  for (const b of buttons) if (b.type === "url" && b.url) lines.push(`${b.title}: ${b.url}`);
  if (buttons.some((b) => b.type === "postback")) lines.push(REPLY_PLUS[locale]);
  return lines.join("\n\n");
}
