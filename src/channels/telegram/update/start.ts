// /start, команды, язык, главное меню и обращения к менеджеру.
import { REFERRAL_PREFIX, referralStats, registerReferral } from "@/core/referrals/referrals";
import { getProduct } from "@/core/catalog/catalog";
import { languageChoice, welcomeHtml } from "../screens";
import { showMyCourses } from "../courses";
import type { InlineButton } from "../types";
import { COPY, escapeHtml, menuActionFor } from "../copy";
import type { Locale } from "@/core/i18n/locale";
import { verticalDef } from "@/core/verticals/registry";
import { storefrontBase } from "@/core/tenant/custom-domain";
import { setState } from "@/core/customers/customers";
import { getSetting } from "@/core/settings/settings";
import { type OptOutCommand, setOptOut } from "@/core/customers/opt-out";
import { notifyAdminsHtml } from "../notify";
import type { BotCommand } from "../commands";
import { claimHandoff, HANDOFF_PREFIX } from "@/core/storefront/handoff";
import { nonceFromPayload } from "@/core/storefront/code-login";
import { parseWaitlistPayload, shouldJoinWaitlist } from "@/core/waitlist/link";
import { type Bot, send, sendMain, SHOP_ACTIONS } from "./bot";
import { showCart } from "./cart";
import { quizAsk, sendProductCard, showCategories } from "./catalog";
import { showMyOrders } from "./orders";

/** Отписка или возврат к рассылкам; ответ — одинаковый и при повторе. */
/**
 * Команда из меню бота (channels/telegram/commands) ведёт на тот же экран,
 * что кнопка главного меню; незаконченное оформление сбрасывается, как при
 * нажатии кнопки.
 */
export async function botCommand(b: Bot, command: BotCommand) {
  if (command === "stop") return optOutReply(b, "unsubscribe");
  if (command === "language") {
    if (!b.ctx.tenant.modules.multi_language) return sendMain(b);
    await send(b, b.m.chooseLanguage, { reply_markup: { inline_keyboard: languageChoice() } });
    return;
  }
  if (b.customer.state.mode && b.customer.state.mode !== "idle")
    b.customer = await setState(b.ctx, b.customer, { ...b.customer.state, mode: "idle" });
  return menuAction(b, command === "orders" ? "myOrders" : command);
}

export async function optOutReply(b: Bot, cmd: OptOutCommand) {
  await setOptOut(b.ctx, b.customer.userKey, cmd === "unsubscribe");
  await send(b, cmd === "unsubscribe" ? b.m.unsubscribed : b.m.resubscribed);
}

/**
 * Ссылка входа на витрину ?start=lg_<метка> (В5): покупатель пишет «Войти по коду»
 * на сайте, бот присылает код. Метку и код сверяет core/storefront/code-login.
 */
async function loginCodeFlow(b: Bot, nonce: string) {
  const { env } = await import("@/config/env");
  const { codeLoginOpen } = await import("@/core/storefront/code-login-gate");
  if (!(await codeLoginOpen(b.ctx))) return void (await send(b, b.m.loginCodeBad));
  const { issueLoginCode } = await import("@/core/storefront/code-login");
  const r = await issueLoginCode(b.ctx, env().SESSION_SECRET, b.customer, nonce);
  if (r.ok) {
    b.customer = r.customer;
    return void (await send(b, b.m.loginCodeMsg(r.code, r.ttlMin)));
  }
  await send(b, r.reason === "wait" ? b.m.loginCodeWait : b.m.loginCodeBad);
}

export async function startFlow(b: Bot, payload = "") {
  const loginNonce = nonceFromPayload(payload);
  if (loginNonce) return loginCodeFlow(b, loginNonce);
  // Откуда пришёл покупатель — первая ссылка /start, для карточки покупателя (core/customers/card).
  if (payload && !b.customer.state.first_source)
    b.customer = await setState(b.ctx, b.customer, {
      ...b.customer.state,
      first_source: payload.slice(0, 64),
    });
  if (payload.startsWith(REFERRAL_PREFIX)) {
    const gift = await registerReferral(
      b.ctx,
      b.customer.telegramId,
      payload.slice(REFERRAL_PREFIX.length),
    ).catch((e) => {
      // /start не должен молчать из-за сбоя реферала: продолжаем без подарка.
      console.error(`[telegram] реферал: ${String(e)}`);
      return null;
    });
    if (gift) await send(b, b.m.referralWelcome(gift.percent, gift.code));
    payload = "";
  }
  // Ссылка розыгрыша ?start=gw_<id> (модуль giveaways): участие в один шаг.
  if (payload.startsWith("gw_") && b.ctx.tenant.modules.giveaways) {
    const { giveawayEntry, giveawayIdFrom } = await import("../giveaway");
    const gid = giveawayIdFrom(payload);
    if (gid) return giveawayEntry(b.ctx, b.api, b.chatId, b.customer, b.locale, gid);
  }
  // Ссылка продавца ?start=bday: покупатель сам вводит день рождения (модуль funnel).
  if (payload === "bday" && b.ctx.tenant.modules.funnel) {
    b.customer = await setState(b.ctx, b.customer, {
      ...b.customer.state,
      mode: "awaiting_birthday",
    });
    return void (await send(b, b.m.birthdayAsk));
  }
  if (payload.startsWith(HANDOFF_PREFIX)) {
    const r = await claimHandoff(b.ctx, b.customer, payload.slice(HANDOFF_PREFIX.length));
    if (!b.customer.state.locale)
      await applyLocale(b, b.ctx.tenant.settings.default_locale ?? "ru");
    if (r === "ok" || r === "claimed") return showCart(b);
    await send(b, b.m.cartEmpty);
    return;
  }
  // Ссылка «Сообщить о поступлении» с сайта: товар без остатка — в лист ожидания, иначе карточка.
  const waitId = b.ctx.tenant.modules.waitlist ? parseWaitlistPayload(payload) : null;
  if (waitId) {
    if (!b.customer.state.locale)
      await applyLocale(b, b.ctx.tenant.settings.default_locale ?? "ru");
    const p = await getProduct(b.ctx, waitId);
    if (p && shouldJoinWaitlist(b.ctx.tenant.modules.stock, p)) {
      const { joinWaitlist } = await import("@/core/waitlist/waitlist");
      b.customer = await joinWaitlist(b.ctx, b.customer, p.id);
      return void (await send(b, b.m.waitlistJoined));
    }
    if (p) return sendProductCard(b, p);
    // Скрытый или удалённый товар: ни карточки, ни записи в лист ожидания.
    return void (await send(b, b.m.unavailable));
  }
  if (payload.startsWith("p_")) {
    if (!b.customer.state.locale)
      await applyLocale(b, b.ctx.tenant.settings.default_locale ?? "ru");
    const p = await getProduct(b.ctx, payload.slice(2));
    if (p) return sendProductCard(b, p);
    return void (await send(b, b.m.unavailable));
  }
  if (b.ctx.tenant.modules.multi_language) {
    await send(b, b.m.chooseLanguage, { reply_markup: { inline_keyboard: languageChoice() } });
    return;
  }
  await applyLocale(b, b.ctx.tenant.settings.default_locale ?? "ru");
}

export async function applyLocale(b: Bot, locale: Locale) {
  b.customer = await setState(b.ctx, b.customer, { ...b.customer.state, locale, mode: "idle" });
  b.locale = locale;
  b.m = COPY[locale];
  const shopName = (await getSetting(b.ctx, "shop_name")) ?? b.ctx.tenant.name;
  await sendMain(b, welcomeHtml(b.ctx.tenant, shopName, locale));
}

export async function menuAction(b: Bot, action: ReturnType<typeof menuActionFor>) {
  // Консультант без товаров: каталог, поиск и корзина — пусты; свежее меню без них.
  if (!b.sells && SHOP_ACTIONS.has(action)) return sendMain(b);
  switch (action) {
    case "quiz":
      return b.ctx.tenant.modules.quiz ? quizAsk(b, 0, true) : showCategories(b, null, 0);
    case "catalog":
      return showCategories(b, null, 0);
    case "search":
      b.customer = await setState(b.ctx, b.customer, { ...b.customer.state, mode: "search" });
      await send(b, b.m.searchPrompt);
      return;
    case "cart":
      return showCart(b);
    case "myOrders":
      return showMyOrders(b);
    case "myCourses":
      return b.ctx.tenant.modules.courses ? showMyCourses(b) : showMyOrders(b);
    case "instruction": {
      const v = verticalDef(b.ctx.tenant.vertical).locales[b.locale];
      const caption =
        (await getSetting(b.ctx, "instruction_caption")) ??
        v.instructionDefaultCaption ??
        b.m.instructionDefault;
      await send(b, escapeHtml(caption));
      return;
    }
    case "information": {
      if (!b.ctx.tenant.modules.legal_docs) return sendMain(b);
      const base = `${storefrontBase(b.ctx.tenant, b.ctx.appUrl)}/legal`;
      const buttons: InlineButton[][] = [
        [
          { text: b.m.infoOfferBtn, url: `${base}/offer` },
          { text: b.m.infoPrivacyBtn, url: `${base}/privacy` },
        ],
        [
          { text: b.m.infoRequisitesBtn, url: `${base}/requisites` },
          { text: b.m.infoAboutBtn, url: `${base}/about` },
        ],
      ];
      const botName = b.ctx.tenant.settings.telegram?.username;
      if (b.ctx.tenant.modules.referral && botName)
        buttons.push([
          {
            text: b.m.inviteFriendBtn,
            url: `https://t.me/${botName}?start=${REFERRAL_PREFIX}${b.customer.telegramId}`,
          },
        ]);
      await send(b, b.m.infoText, { reply_markup: { inline_keyboard: buttons } });
      return;
    }
    case "invite": {
      const botName = b.ctx.tenant.settings.telegram?.username;
      if (!b.ctx.tenant.modules.referral || !botName) return sendMain(b);
      const link = `https://t.me/${botName}?start=${REFERRAL_PREFIX}${b.customer.telegramId}`;
      const stats = await referralStats(b.ctx, b.customer.telegramId);
      const codes = stats.codes
        .map((c) => `<code>${escapeHtml(c.code)}</code>${c.used ? ` — ${b.m.inviteCodeUsed}` : ""}`)
        .join("\n");
      await send(b, b.m.inviteScreen(link, stats.came, stats.bought, codes), {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: b.m.inviteShareBtn,
                url: `https://t.me/share/url?url=${encodeURIComponent(link)}`,
              },
            ],
          ],
        },
      });
      return;
    }
    case "myTickets":
      return b.ctx.tenant.modules.helpdesk ? showMyTickets(b) : sendMain(b);
    case "contact": {
      if (b.ctx.tenant.modules.helpdesk) {
        b.customer = await setState(b.ctx, b.customer, {
          ...b.customer.state,
          mode: "awaiting_ticket",
        });
        await send(b, b.m.ticketPrompt);
        return;
      }
      if (await contactManagerHandoff(b)) return;
      const link = await getSetting(b.ctx, "admin_contact_link");
      await send(b, link ? b.m.contactAuthor(escapeHtml(link)) : b.m.contactNotSet);
      return;
    }
  }
}

/**
 * «💬 Связаться с менеджером» у консультанта по прайсу без модуля «Поддержка»
 * (партия 3.3): как передача консультанта — задача в админке, пауза бота,
 * карточка продавцу; покупателю — «передам вопрос менеджеру» (и ссылка для
 * связи, если продавец её задал). Консультант уже на паузе — менеджер позван:
 * второй задачи и карточки нет. Не консультант по прайсу — false, как раньше.
 */
async function contactManagerHandoff(b: Bot): Promise<boolean> {
  const { pricelistMode } = await import("@/core/consultant/pricelist/mode");
  if (!pricelistMode(b.ctx.tenant)) return false;
  const { consultantEnabled, isPaused, pauseConsultant } =
    await import("@/core/consultant/engine.server");
  if (!(await consultantEnabled(b.ctx))) return false;
  const { handoffReply, contactButtonText } = await import("@/core/consultant/messages");
  const link = await getSetting(b.ctx, "admin_contact_link");
  const reply = [
    escapeHtml(handoffReply(b.locale)),
    link ? b.m.contactAuthor(escapeHtml(link)) : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  if (isPaused(b.customer)) {
    await send(b, reply);
    return true;
  }
  const { sellerLocaleSafe } = await import("@/core/ai/seller-text");
  const seller = contactButtonText(await sellerLocaleSafe(b.ctx));
  b.customer = await pauseConsultant(b.ctx, b.customer);
  if (b.ctx.tenant.modules.manager_chat) {
    const { connect } = await import("@/core/chat/chat");
    await connect(b.ctx, b.customer.telegramId).catch(() => {});
  }
  // Задача — до карточки: сбой отправки её не теряет.
  const { taskFromHandoff, telegramDialogLink } = await import("@/core/consultant/tasks");
  await taskFromHandoff(
    b.ctx,
    b.customer,
    { reason: "human_requested", summary: seller.summary },
    { channel: "telegram", link: telegramDialogLink(b.customer.username) },
  );
  const { pauseHours } = await import("@/core/consultant/pause");
  const who =
    [b.customer.firstName, b.customer.lastName].filter(Boolean).join(" ") ||
    (b.customer.username ? `@${b.customer.username}` : `id ${b.customer.telegramId}`);
  await notifyAdminsHtml(
    b.ctx,
    [
      seller.title,
      `Telegram · 👤 ${escapeHtml(who)}${b.customer.username ? ` · @${escapeHtml(b.customer.username)}` : ""}`,
      "",
      seller.hint(pauseHours(b.ctx.tenant)),
    ].join("\n"),
    { kind: "handoff" },
  ).catch(() => 0);
  await send(b, reply);
  return true;
}

/** «Мои обращения»: свои номера и статусы; в открытое можно дописать. */
async function showMyTickets(b: Bot) {
  const { myTickets } = await import("@/core/helpdesk/mine");
  const { myTicketsText, DATE_LOCALE } = await import("../copy");
  const list = await myTickets(b.ctx, b.customer.telegramId);
  const text = myTicketsText(b.m, list, {
    html: true,
    date: (iso) =>
      new Date(iso).toLocaleDateString(DATE_LOCALE[b.locale] ?? "ru-RU", {
        day: "numeric",
        month: "short",
        timeZone: b.ctx.timezone,
      }),
  });
  await send(b, text, {
    ...(list.canAppend
      ? {
          reply_markup: {
            inline_keyboard: [[{ text: b.m.myTicketsAppendBtn, callback_data: "tkadd" }]],
          },
        }
      : {}),
  });
}
