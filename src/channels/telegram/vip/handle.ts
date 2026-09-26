import { env } from "@/config/env";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { isBlocked } from "@/core/customers/customers";
import { adminRecipients } from "@/core/notify/recipients";
import { imageUrl } from "@/core/catalog/catalog";
import { isLocale, localeNames, SUPPORTED_LOCALES, type Locale } from "@/core/i18n/locale";
import { fmt, formatDateTime, memberStatusIsInGroup } from "@/core/vip/pure";
import {
  activateSubscription,
  activeSubscription,
  assignMemberTariff,
  attachProof,
  entryTariff,
  getTariff,
  hadPaidAccess,
  memberAssignedTariff,
  memberLocale,
  pendingSubscription,
  rejectSubscription,
  renewTariffs,
  setMemberLocale,
  startPending,
  vipSettings,
  type MemberUser,
  type TariffRow,
} from "@/core/vip/vip";
import { telegramApi, type TelegramApi } from "../api";
import { escapeHtml } from "../copy";
import type { TelegramUpdate, TelegramUser } from "../types";
import { vipCopy, type VipCopyKey } from "./copy";
import { vipGroupApi } from "./group";

/**
 * VIP-бот клиента (второй токен): тарифы, чек, статус, продление — в личке.
 * Перенос handleVipUpdate из v1: в группе бот молчит (он там админ и видит
 * всё), язык покупателя хранится в профиле и выбирается явно, заявка одна
 * на человека, повторные чеки не спамят администратора чаще раза в минуту.
 */
export function vipTelegramApi(ctx: TenantContext): TelegramApi {
  return telegramApi(ctx.secrets.vipToken(), env().TELEGRAM_API_BASE);
}

type Vip = {
  ctx: TenantContext;
  api: TelegramApi;
  chatId: number;
  from: TelegramUser;
  locale: Locale;
};

const c = (v: Vip) => vipCopy[v.locale];

function isButton(text: string, key: VipCopyKey): boolean {
  return SUPPORTED_LOCALES.some((l) => vipCopy[l][key] === text);
}

function menu(locale: Locale) {
  const t = vipCopy[locale];
  return {
    keyboard: [
      [{ text: t.btnRenew }, { text: t.btnStatus }],
      [{ text: t.btnId }, { text: t.btnHelp }],
      [{ text: t.btnLang }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

async function say(v: Vip, text: string, extra: Record<string, unknown> = {}) {
  await v.api.call("sendMessage", { chat_id: v.chatId, text, parse_mode: "HTML", ...extra });
}

async function sayMenu(v: Vip, text: string) {
  await say(v, text, { reply_markup: menu(v.locale) });
}

async function askLanguage(v: Vip) {
  await v.api.call("sendMessage", {
    chat_id: v.chatId,
    text: vipCopy.ru.chooseLanguage,
    reply_markup: {
      inline_keyboard: SUPPORTED_LOCALES.map((l) => [
        { text: localeNames[l], callback_data: `vip_locale:${l}` },
      ]),
    },
  });
}

async function inGroup(v: Vip): Promise<boolean> {
  const { groupId } = await vipSettings(v.ctx);
  if (!groupId) return false;
  const m = await vipGroupApi(v.api).member(groupId, v.from.id);
  return memberStatusIsInGroup(m?.status);
}

async function showStatus(v: Vip) {
  const t = c(v);
  const active = await activeSubscription(v.ctx, v.from.id);
  if (active) {
    await sayMenu(
      v,
      `${t.statusTitle}\n\n${t.statusActive}\n${t.statusTariff} ${escapeHtml(active.vip_tariffs?.name ?? "—")}\n${t.statusValidUntil} <b>${escapeHtml(formatDateTime(active.expires_at, v.ctx.timezone))}</b>\n\n${fmt(t.statusRenewHint, { btn: t.btnRenew })}`,
    );
    return;
  }
  const pending = await pendingSubscription(v.ctx, v.from.id);
  if (pending) {
    await sayMenu(
      v,
      `${t.statusTitle}\n\n${t.statusPending}\n${t.statusTariff} ${escapeHtml(pending.vip_tariffs?.name ?? "—")}\n\n${t.statusPendingHint}`,
    );
    return;
  }
  await sayMenu(
    v,
    `${t.statusTitle}\n\n${t.statusNone}\n${fmt(t.statusNoneHint, { btn: t.btnRenew })}`,
  );
}

async function showHelp(v: Vip) {
  const t = c(v);
  await sayMenu(
    v,
    `${t.helpTitle}\n\n${fmt(t.helpRenewLine, { btn: t.btnRenew })}\n${fmt(t.helpStatusLine, { btn: t.btnStatus })}\n${fmt(t.helpIdLine, { btn: t.btnId })}\n${t.helpPhotoLine}\n\n${t.helpCommandsLine}`,
  );
}

async function showMyId(v: Vip) {
  const t = c(v);
  const un = v.from.username ? `\n${t.myIdUsername} @${escapeHtml(v.from.username)}` : "";
  await sayMenu(v, `${t.myIdLabel} <code>${v.from.id}</code>${un}\n\n${t.myIdHint}`);
}

function tariffButton(t: TariffRow) {
  return { text: `${t.name} — ${t.price} ${t.currency}`, callback_data: `buy_tariff:${t.id}` };
}

async function showTariffs(v: Vip, opts: { renew?: boolean; inGroup?: boolean } = {}) {
  const t = c(v);
  const tariffs = await renewTariffs(v.ctx);
  if (tariffs.length === 0) {
    await say(v, opts.renew ? t.tariffsEmptyRenew : t.tariffsEmptyDefault);
    return;
  }
  const intro = opts.inGroup
    ? t.tariffsIntroInGroup
    : opts.renew
      ? t.tariffsIntroRenew
      : t.tariffsIntroDefault;
  await say(v, intro, { reply_markup: { inline_keyboard: tariffs.map((x) => [tariffButton(x)]) } });
}

async function showEntryOffer(v: Vip) {
  const t = c(v);
  const entry = await entryTariff(v.ctx);
  if (!entry) return showTariffs(v);
  await say(
    v,
    `${t.entryTitle}\n\n${fmt(t.entryDesc, { days: String(entry.duration_days) })}\n${t.entryPriceLabel} <b>${escapeHtml(String(entry.price))} ${escapeHtml(entry.currency)}</b>\n\n${t.entryAfterPay}\n${t.entryFurtherRenew}`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: fmt(t.entryPayButton, { price: String(entry.price), currency: entry.currency }),
              callback_data: `buy_tariff:${entry.id}`,
            },
          ],
        ],
      },
    },
  );
}

async function sendPaymentInstructions(v: Vip, text: string, qrPath: string) {
  if (qrPath) {
    const photo = imageUrl(v.ctx, qrPath);
    if (text.length <= 1024) {
      const r = await v.api.call("sendPhoto", {
        chat_id: v.chatId,
        photo,
        caption: text,
        parse_mode: "HTML",
      });
      if (r.ok) return;
    } else {
      await v.api.call("sendPhoto", { chat_id: v.chatId, photo });
    }
  }
  await say(v, text);
}

async function buyTariff(v: Vip, tariffId: string) {
  const t = c(v);
  const tariff = await getTariff(v.ctx, tariffId);
  if (!tariff) return say(v, t.tariffNotFoundShort);
  if (!tariff.is_active) return say(v, t.tariffInactive);
  if (tariff.is_entry && (await hadPaidAccess(v.ctx, v.from.id))) {
    await say(v, t.entryOnlyForNew);
    return showTariffs(v, { renew: true, inGroup: await inGroup(v) });
  }
  const user: MemberUser = v.from;
  if (tariff.is_public === false && !tariff.is_entry)
    await assignMemberTariff(v.ctx, v.from.id, user, tariff.id, "deep_link");
  const settings = await vipSettings(v.ctx);
  try {
    await startPending(v.ctx, v.from.id, user, tariff.id);
  } catch (e) {
    console.error("[vip] start pending failed", e);
    return say(v, t.createRequestFailed);
  }
  const text =
    `${t.paymentChosenLabel} <b>${escapeHtml(tariff.name)}</b>\n${t.paymentDueLabel} <b>${escapeHtml(String(tariff.price))} ${escapeHtml(tariff.currency)}</b>\n\n` +
    `${escapeHtml(settings.instructions || t.defaultPaymentInstructions)}\n\n${t.paymentAfterPay}`;
  await sendPaymentInstructions(v, text, settings.qrPath);
}

/** /start, /start renew, «Продлить». */
async function startFlow(v: Vip, renew: boolean) {
  const t = c(v);
  const pending = await pendingSubscription(v.ctx, v.from.id);
  if (pending) {
    await sayMenu(
      v,
      `${t.startPendingTitle}\n${t.statusTariff} ${escapeHtml(pending.vip_tariffs?.name ?? "—")}\n\n${t.startPendingNoNewNeeded}\n${t.startPendingSendProof}\n${fmt(t.startPendingStatusHint, { btn: t.btnStatus })}`,
    );
    return;
  }
  const had = await hadPaidAccess(v.ctx, v.from.id);
  const member = await inGroup(v);
  const wantRenew = renew && had;
  await sayMenu(
    v,
    wantRenew ? (member ? t.startRenewInGroup : t.startRenewNotInGroup) : t.startWelcome,
  );
  const assigned = await memberAssignedTariff(v.ctx, v.from.id);
  if (assigned && !assigned.is_entry && (wantRenew || had)) {
    const line = `<b>${escapeHtml(assigned.name)}</b> — ${escapeHtml(String(assigned.price))} ${escapeHtml(assigned.currency)}`;
    await say(
      v,
      member
        ? `${t.assignedRenewInGroup}\n${line}`
        : `${t.assignedRenewNotInGroup}\n${line}\n\n${t.assignedAfterPay}`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: fmt(t.payButton, {
                  price: String(assigned.price),
                  currency: assigned.currency,
                }),
                callback_data: `buy_tariff:${assigned.id}`,
              },
            ],
            [{ text: t.otherPublicTariffs, callback_data: "buy_renew_public" }],
          ],
        },
      },
    );
    return;
  }
  if (wantRenew || had) return showTariffs(v, { renew: true, inGroup: member });
  return showEntryOffer(v);
}

async function downloadFile(
  api: TelegramApi,
  fileId: string,
): Promise<{ bytes: Uint8Array; mime: string; ext: string } | null> {
  const info = await api.call<{ file_path?: string }>("getFile", { file_id: fileId });
  const path = info.result?.file_path;
  if (!info.ok || !path) return null;
  const res = await fetch(api.fileUrl(path), { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) return null;
  const mime = res.headers.get("content-type") ?? "application/octet-stream";
  const ext =
    path.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase() ??
    (mime === "application/pdf" ? "pdf" : "jpg");
  return { bytes: new Uint8Array(await res.arrayBuffer()), mime, ext };
}

async function receiveProof(v: Vip, fileId: string, kind: "photo" | "document") {
  const t = c(v);
  const pending = await pendingSubscription(v.ctx, v.from.id);
  if (!pending) return say(v, t.noPendingTariff);
  const resubmit = Boolean(pending.payment_proof_path);
  const notify = !resubmit || Date.now() - new Date(pending.updated_at).getTime() >= 60_000;
  await say(
    v,
    resubmit ? (notify ? t.proofResubmitNotified : t.proofResubmitQuiet) : t.proofReceived,
  );

  const file = await downloadFile(v.api, fileId);
  const saved = file ? await attachProof(v.ctx, pending.id, file) : null;
  if (!notify) return;

  const tariff = pending.vip_tariffs;
  const name =
    [pending.first_name, pending.last_name].filter(Boolean).join(" ").trim() ||
    (pending.username ? `@${pending.username}` : "");
  const buyer = name ? `${escapeHtml(name)} (ID ${v.from.id})` : `ID ${v.from.id}`;
  const text =
    `🆕 <b>Оплата VIP-подписки${resubmit ? " (повторный чек)" : ""}</b>\n\n` +
    `Пользователь: <a href="tg://user?id=${v.from.id}">${buyer}</a>\n` +
    `Тариф: <b>${escapeHtml(tariff?.name ?? "")}</b>\nСумма: <b>${escapeHtml(String(tariff?.price ?? ""))} ${escapeHtml(tariff?.currency ?? "")}</b>\n\n` +
    `Проверьте чек и подтвердите подписку.${saved ? "" : "\n\n⚠️ Чек не сохранён в хранилище — смотрите файл в этом сообщении."}`;
  const reply_markup = {
    inline_keyboard: [
      [
        { text: "✅ Подтвердить", callback_data: `vip_confirm:${pending.id}` },
        { text: "❌ Отклонить", callback_data: `vip_reject:${pending.id}` },
      ],
    ],
  };
  const admins = await adminRecipients(v.ctx);
  if (admins.length === 0)
    console.warn(`[vip:${v.ctx.tenant.id}] некому отправить чек — admin_chat_id пуст`);
  for (const chatId of admins) {
    // file_id документа не отправляется как фото и наоборот.
    await v.api.call(kind === "document" ? "sendDocument" : "sendPhoto", {
      chat_id: chatId,
      [kind === "document" ? "document" : "photo"]: fileId,
      caption: text.slice(0, 1024),
      parse_mode: "HTML",
      reply_markup,
    });
  }
}

async function requireAdmin(v: Vip): Promise<boolean> {
  const admins = await adminRecipients(v.ctx);
  if (admins.length === 0) {
    await say(
      v,
      "Ошибка: не настроены получатели уведомлений (Telegram ID в настройках). Подтверждение из Telegram отключено.",
    );
    return false;
  }
  if (!admins.includes(String(v.from.id))) {
    await say(v, "⛔ Только администратор может подтверждать или отклонять оплату.");
    return false;
  }
  return true;
}

export async function handleVipUpdate(
  ctx: TenantContext,
  api: TelegramApi,
  update: TelegramUpdate,
): Promise<void> {
  try {
    await vipUpdate(ctx, api, update);
  } catch (e) {
    // Обновление уже засчитано (dedupe): без отчёта сбой пропал бы молча.
    const { reportError } = await import("@/lib/errors");
    await reportError(e, {
      where: "telegram.vip",
      botId: ctx.tenant.id,
      extra: {
        update_id: update.update_id,
        kind: update.callback_query ? "callback" : update.message ? "message" : "other",
      },
    });
  }
}

async function vipUpdate(ctx: TenantContext, api: TelegramApi, update: TelegramUpdate) {
  const msg = update.message;
  if (msg) {
    if (!msg.from || (msg.chat.type && msg.chat.type !== "private")) return;
    if (await isBlocked(ctx, msg.from.id)) return;
    const stored = await memberLocale(ctx, msg.from.id);
    const v: Vip = { ctx, api, chatId: msg.chat.id, from: msg.from, locale: stored ?? "ru" };
    const text = (msg.text ?? "").trim();
    const t = c(v);

    if (text.startsWith("/start")) {
      const payload = text.split(/\s+/).slice(1).join(" ").trim();
      if (payload.startsWith("t_") && /^[0-9a-f-]{36}$/i.test(payload.slice(2))) {
        await sayMenu(v, t.vipMenuPinned);
        const tariff = await getTariff(ctx, payload.slice(2));
        if (!tariff || !tariff.is_active) await say(v, t.tariffLinkNotFound);
        else {
          if (tariff.is_public === false && !tariff.is_entry)
            await assignMemberTariff(ctx, v.from.id, v.from, tariff.id, "deep_link");
          await buyTariff(v, tariff.id);
        }
      } else {
        await startFlow(v, payload === "renew");
      }
      if (!stored) await askLanguage(v);
      return;
    }
    if (isButton(text, "btnLang") || text === "/language") return askLanguage(v);
    if (text === "/id" || text.startsWith("/id@") || isButton(text, "btnId")) return showMyId(v);
    if (isButton(text, "btnRenew") || text === "/renew") return startFlow(v, true);
    if (isButton(text, "btnStatus") || text === "/status") return showStatus(v);
    if (isButton(text, "btnHelp") || text === "/help") return showHelp(v);
    if (msg.photo?.length)
      return receiveProof(v, msg.photo[msg.photo.length - 1]!.file_id, "photo");
    if (msg.document) return receiveProof(v, msg.document.file_id, "document");
    return;
  }

  const cq = update.callback_query;
  if (!cq?.from || !cq.message?.chat?.id) return;
  const data = cq.data ?? "";
  await api.call("answerCallbackQuery", { callback_query_id: cq.id });
  const adminAction = data.startsWith("vip_confirm:") || data.startsWith("vip_reject:");
  if (!adminAction && (await isBlocked(ctx, cq.from.id))) return;
  const locale = adminAction ? "ru" : ((await memberLocale(ctx, cq.from.id)) ?? "ru");
  const v: Vip = { ctx, api, chatId: cq.message.chat.id, from: cq.from, locale };

  if (data.startsWith("vip_locale:")) {
    const l = data.slice("vip_locale:".length);
    if (!isLocale(l)) return;
    await setMemberLocale(ctx, cq.from.id, cq.from, l);
    v.locale = l;
    return sayMenu(v, vipCopy[l].languageSaved);
  }
  if (data.startsWith("buy_tariff:")) return buyTariff(v, data.slice("buy_tariff:".length));
  if (data === "buy_renew") return startFlow(v, true);
  if (data === "buy_renew_public") {
    const t = c(v);
    const pending = await pendingSubscription(ctx, cq.from.id);
    if (pending)
      return sayMenu(
        v,
        `${t.alreadyPendingPublic}${pending.vip_tariffs?.name ? ` (${escapeHtml(pending.vip_tariffs.name)})` : ""}.\n${t.sendProofIfNotYet}`,
      );
    return showTariffs(v, { renew: true, inGroup: await inGroup(v) });
  }
  if (adminAction) {
    if (!(await requireAdmin(v))) return;
    const id = data.slice(data.indexOf(":") + 1);
    const clear = () =>
      cq.message?.message_id
        ? api.call("editMessageReplyMarkup", {
            chat_id: v.chatId,
            message_id: cq.message.message_id,
            reply_markup: { inline_keyboard: [] },
          })
        : Promise.resolve();
    try {
      if (data.startsWith("vip_confirm:")) {
        const r = await activateSubscription(ctx, vipGroupApi(api), id);
        await say(
          v,
          r.deliveryFailed
            ? "✅ Подписка подтверждена.\n\n⚠️ Ссылку не удалось отправить пользователю (заблокировал бота?). Используйте «Переотправить» в разделе VIP панели."
            : "✅ Подписка подтверждена.",
        );
      } else {
        const r = await rejectSubscription(ctx, vipGroupApi(api), id);
        await say(
          v,
          r.alreadyProcessed ? "Заявка уже обработана или не найдена." : "❌ Подписка отклонена.",
        );
      }
      await clear();
    } catch (e) {
      await say(v, `Ошибка: ${escapeHtml(e instanceof Error ? e.message : String(e))}`);
    }
  }
}
