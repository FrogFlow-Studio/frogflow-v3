/**
 * Окно ответа Instagram и WhatsApp: 24 часа с последнего ВХОДЯЩЕГО сообщения
 * покупателя (нажатие кнопки или строки списка — тоже входящее). Наши
 * исходящие окно не продлевают, поэтому last_message_at диалога (он учитывает
 * обе стороны) не годится. Zernio состояние окна не отдаёт — считаем сами по
 * журналу переписки. Telegram окна не знает.
 */
export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

export type ReplyWindow =
  | { state: "open"; closesAt: string; leftMs: number }
  /** since — когда закрылось; null — входящих в журнале нет. */
  | { state: "closed"; since: string | null };

export function replyWindow(
  platform: string,
  lastInboundAt: string | null | undefined,
  now: number,
): ReplyWindow | null {
  if (platform !== "instagram" && platform !== "whatsapp") return null;
  const at = lastInboundAt ? Date.parse(lastInboundAt) : NaN;
  if (!Number.isFinite(at)) return { state: "closed", since: null };
  const closes = at + REPLY_WINDOW_MS;
  return closes > now
    ? { state: "open", closesAt: new Date(closes).toISOString(), leftMs: closes - now }
    : { state: "closed", since: new Date(closes).toISOString() };
}

/** Остаток окна словами: часы и минуты, округление вниз (не обещаем лишнего). */
export function windowLeftParts(leftMs: number): { h: number; m: number } {
  const minutes = Math.max(0, Math.floor(leftMs / 60_000));
  return { h: Math.floor(minutes / 60), m: minutes % 60 };
}

/**
 * На сколько часы сервера расходятся с часами браузера. Окно считаем по
 * серверу: у продавца часы могут спешить или отставать, а время последнего
 * входящего записано сервером. Сейчас по серверу = Date.now() + смещение.
 */
export function serverClockOffset(serverNow: string | null | undefined, clientNow: number): number {
  const at = serverNow ? Date.parse(serverNow) : NaN;
  return Number.isFinite(at) ? at - clientNow : 0;
}

/**
 * Подсказка над полем ответа, пока окно закрыто: что произойдёт с сообщением.
 * WhatsApp с заданным шаблоном — уйдёт шаблоном; без шаблона — не уйдёт, пока
 * его не задали; Instagram шаблонов не знает. Открытое окно и Telegram — без подсказки.
 */
export type WindowNotice =
  | { key: "whatsappTemplate"; template: string }
  | { key: "whatsappNoTemplate" }
  | { key: "instagram" };

export function windowNotice(
  platform: string,
  w: ReplyWindow | null,
  template: string | null | undefined,
): WindowNotice | null {
  if (!w || w.state !== "closed") return null;
  if (platform === "instagram") return { key: "instagram" };
  if (platform !== "whatsapp") return null;
  return template ? { key: "whatsappTemplate", template } : { key: "whatsappNoTemplate" };
}
