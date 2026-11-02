import { deliveryResult, issueCabinetLink, type DeliveryChannel } from "../core/access/access";
import { openCase, type SendOutcome } from "../core/cases/cases";
import type { V4Db } from "../core/db";
import type { Job, JobHandler } from "./runner";

/**
 * Задача «deliver»: покупатель получает ссылку в свой кабинет с купленным
 * (решение 12) — в тот канал, где он писал последним, на своём языке.
 *
 * «Один раз»: до отправки ставится отметка claim_delivery (migrations/v4/012);
 * кто её не получил — не шлёт. Отправка, которая могла дойти (unknown),
 * не повторяется: итог пишет delivery_result, и неудача или неизвестность
 * открывают продавцу дело «материал не дошёл» с кнопкой «Отправить снова».
 * Повтор задачи (ok: false) — только когда до отправки не дошло.
 */

type Lang = "ru" | "kk" | "en" | "uz";

/** Куда писать покупателю: id в канале, переписка и аккаунт Zernio (Instagram, WhatsApp; v4/015). */
export type BuyerAddress = {
  externalId: string;
  conversationId: string | null;
  accountId: string | null;
};

export type BuyerSender = (
  channel: Exclude<DeliveryChannel, "email">,
  to: BuyerAddress,
  text: string,
  signal: AbortSignal,
) => Promise<SendOutcome>;

const TEXT: Record<Lang, { file: string; club: string }> = {
  ru: {
    file: "Спасибо за покупку! «{title}» — ваши материалы по ссылке:\n{url}\nСсылка действует 30 дней.",
    club: "Спасибо! Доступ в «{title}» открыт до {until}. Всё купленное — по ссылке:\n{url}",
  },
  kk: {
    file: "Сатып алғаныңызға рахмет! «{title}» — материалдарыңыз сілтемеде:\n{url}\nСілтеме 30 күн жарамды.",
    club: "Рахмет! «{title}» қолжетімділігі {until} дейін ашық. Сатып алғандарыңыздың бәрі сілтемеде:\n{url}",
  },
  en: {
    file: "Thank you for your purchase! «{title}» — your materials are here:\n{url}\nThe link works for 30 days.",
    club: "Thank you! Access to «{title}» is open until {until}. Everything you bought is here:\n{url}",
  },
  uz: {
    file: "Xaridingiz uchun rahmat! «{title}» — materiallaringiz havolada:\n{url}\nHavola 30 kun amal qiladi.",
    club: "Rahmat! «{title}»ga kirish {until} gacha ochiq. Barcha xaridlaringiz havolada:\n{url}",
  },
};

export function deliveryText(
  lang: Lang,
  kind: "file" | "club",
  p: { title: string; url: string; until: Date | null },
): string {
  const until = p.until
    ? p.until.toLocaleDateString({ ru: "ru-RU", kk: "kk-KZ", en: "en-GB", uz: "uz-UZ" }[lang])
    : "";
  return TEXT[lang][kind]
    .replace("{title}", p.title)
    .replace("{url}", p.url)
    .replace("{until}", until);
}

/** Прошлая попытка взяла отметку и не записала итог дольше этого — считаем «неизвестно». */
const STALE_CLAIM_MS = 5 * 60_000;

export function deliverHandler(deps: {
  db: V4Db;
  send: BuyerSender;
  /** Адрес кабинета по токену: `${appUrl}/c/${botId}/${token}`. */
  cabinetUrl: (botId: string, token: string) => string;
  now?: () => number;
}): JobHandler {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  return async (job: Job, signal) => {
    const botId = job.botId;
    const accessId = typeof job.payload.access_id === "string" ? job.payload.access_id : null;
    if (!botId || !accessId)
      return { ok: false, error: "задача без bot_id/access_id", retryInSec: 3600 };
    const plan = (await db.call("delivery_plan", { p_bot_id: botId, p_access_id: accessId }))[0]
      ?.delivery_plan as Record<string, unknown> | null | undefined;
    // Доступа нет или он уже закрыт — выдавать нечего.
    if (!plan || plan.status !== "active") return { ok: true };
    const channel = plan.channel as Exclude<DeliveryChannel, "email"> | null;
    if (!channel) {
      const c = await openCase(db, {
        botId,
        kind: "delivery_failed",
        dedupeKey: `access:${accessId}`,
        by: "delivery",
        buyerId: String(plan.buyer_id),
        orderId: (plan.order_id as string | null) ?? undefined,
        detail: { access_id: accessId, reason: "no_channel" },
      });
      if (!c.ok) return { ok: false, error: `open_case: ${c.code}` };
      return { ok: true };
    }
    if (plan.delivered) return { ok: true };
    if (plan.claimed_at) {
      // Кто-то начал отправку и не записал итог. Свежая — ждём; старая — «могло дойти».
      if (now() - Date.parse(String(plan.claimed_at)) < STALE_CLAIM_MS)
        return { ok: false, error: "отправка уже идёт", retryInSec: 360 };
      const r = await deliveryResult(db, {
        botId,
        accessId,
        channel,
        status: "unknown",
        error: "прошлая попытка прервалась после начала отправки",
      });
      return r.ok ? { ok: true } : { ok: false, error: `delivery_result: ${r.code}` };
    }

    // До отметки — всё, что может упасть без последствий для покупателя.
    const link = await issueCabinetLink(db, botId, String(plan.buyer_id));
    const lang = (["ru", "kk", "en", "uz"] as const).find((l) => l === plan.language) ?? "ru";
    const text = deliveryText(lang, plan.kind === "club" ? "club" : "file", {
      title: String(plan.title),
      url: deps.cabinetUrl(botId, link.token),
      until: plan.ends_at ? new Date(String(plan.ends_at)) : null,
    });

    const claimed = await db.call("claim_delivery", {
      p_bot_id: botId,
      p_access_id: accessId,
      p_channel: channel,
    });
    if (!claimed[0]?.claim_delivery)
      return { ok: false, error: "отправка уже идёт", retryInSec: 360 };

    let outcome: SendOutcome;
    try {
      outcome = await deps.send(
        channel,
        {
          externalId: String(plan.external_id),
          conversationId: (plan.conversation_id as string | null) ?? null,
          accountId: (plan.account_id as string | null) ?? null,
        },
        text,
        signal,
      );
    } catch {
      outcome = "unknown";
    }
    const r = await deliveryResult(db, { botId, accessId, channel, status: outcome });
    // Итог не записался — повтор задачи увидит старую отметку и запишет «неизвестно».
    return r.ok
      ? { ok: true }
      : { ok: false, error: `delivery_result: ${r.code}`, retryInSec: 360 };
  };
}
