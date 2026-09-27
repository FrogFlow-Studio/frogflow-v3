import { createHash } from "node:crypto";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { updateSettingAtomic } from "@/core/settings/settings";
import { isClosedStage, leadKey, parseLead, type Lead } from "./stages";

/**
 * Заявки, которые появляются в воронке сами. Сейчас источник один —
 * передача менеджеру от ИИ-консультанта (Telegram, Instagram, WhatsApp):
 * v2 её нигде больше не хранит, только шлёт уведомление продавцу.
 *
 * На покупателя одна заявка (id из его user_key): повторная передача
 * дописывает суть в заметку и не сбивает этап, который выставил продавец;
 * после закрытой заявки новая передача открывает её заново как «Новую».
 */
export function handoffLeadId(userKey: string): string {
  return `ai-${createHash("sha256").update(userKey).digest("hex").slice(0, 32)}`;
}

export type HandoffInfo = {
  kind: "handoff" | "lead";
  reason: string;
  customerName?: string;
  customerContact?: string;
  summary: string;
};

const NOTE_MAX = 1000;

function appendNote(prev: string | null, line: string): string {
  const next = prev ? `${prev}\n${line}` : line;
  // Длинная история — оставляем свежий хвост.
  return next.length > NOTE_MAX ? next.slice(next.length - NOTE_MAX) : next;
}

/** Завести или обновить заявку по передаче; ошибки глотает — ответ покупателю важнее. */
export async function leadFromHandoff(
  ctx: TenantContext,
  customer: Customer,
  handoff: HandoffInfo,
  now = new Date(),
): Promise<void> {
  if (!ctx.tenant.modules.crm_pipeline) return;
  try {
    const id = handoffLeadId(customer.userKey);
    const at = now.toISOString();
    const name =
      handoff.customerName?.trim() ||
      [customer.firstName, customer.lastName].filter(Boolean).join(" ") ||
      (customer.username ? `@${customer.username}` : "");
    const contact =
      handoff.customerContact?.trim() ||
      customer.contactPhone ||
      (customer.username ? `@${customer.username}` : "");
    const line = `${handoff.reason}: ${handoff.summary}`.trim();
    await updateSettingAtomic(ctx, leadKey(id), (raw) => {
      const cur = parseLead(raw);
      if (cur && !isClosedStage(cur.stage)) {
        const next: Lead = {
          ...cur,
          contact: cur.contact || contact.slice(0, 120),
          note: appendNote(cur.note, line),
          updated_at: at,
        };
        return JSON.stringify(next);
      }
      const fresh = parseLead(
        JSON.stringify({
          id,
          stage: "new",
          name: name.slice(0, 120),
          contact: (contact || `id ${customer.telegramId}`).slice(0, 120),
          source: "handoff",
          amount: null,
          currency: null,
          note: appendNote(null, line),
          owner: cur?.owner ?? null,
          user_key: customer.userKey,
          created_at: at,
          updated_at: at,
          closed_at: null,
        }),
      );
      return fresh ? JSON.stringify(fresh) : null;
    });
  } catch (e) {
    console.warn(`[pipeline] заявка из передачи не записалась: ${String(e)}`);
  }
}
