import type { SellerDecisionTexts } from "./seller-decision-texts";

/**
 * Ответ продавца покупателю в Instagram/WhatsApp (Б4, Б9): итог одной отправки
 * словами для продавца. Окно канала закрыто — причина и что делать; отправка,
 * которая могла дойти (обрыв, 500), — «неизвестно», без повтора; остальное —
 * «не отправлено». Разбор отказа — только errors.ts.
 */
export type RelayOutcome = { ok: true } | { ok: false; say: string };

export async function relayToBuyer(
  send: () => Promise<{ ok: boolean; failure?: unknown }>,
  platform: string,
  st: SellerDecisionTexts,
): Promise<RelayOutcome> {
  const r = await send();
  if (r.ok) return { ok: true };
  const { classifyZernioFailure } = await import("@/channels/zernio/errors");
  const kind = classifyZernioFailure(r.failure as never);
  if (kind === "window_closed") return { ok: false, say: st.writeWindowClosed(platform) };
  if (kind === "ambiguous") return { ok: false, say: st.writeUnknown };
  return { ok: false, say: st.writeNotSent };
}
