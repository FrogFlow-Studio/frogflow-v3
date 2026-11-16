/**
 * Студия 3D-печати в Telegram (ниша print3d, core/print3d). Клиенту ничего
 * нажимать не нужно: после оформления в студии он пишет боту номер заказа с
 * чека — бот находит строку таблицы, отвечает карточкой (с фото, если оно
 * есть) и кладёт копию в рабочую группу (app_settings.admin_chat_id).
 *
 * Бот отвечает сам только дважды за всю историю клиента: просьба прислать
 * номер (один раз) и карточка (один раз на заказ). Всё остальное, что пишет
 * клиент, молча уходит в рабочую группу; мастер отвечает свайпом, и бот
 * пересылает ответ клиенту. Так бот не влезает в живой разговор.
 */
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Locale } from "@/core/i18n/locale";
import { adminRecipients } from "@/core/notify/recipients";
import {
  addWait,
  bindOrder,
  dropWait,
  listWaits,
  waitExpired,
  claimReady,
  listBindings,
  listReadySent,
  loadPrint3dOrders,
  orderOfClient,
  print3dConfig,
} from "@/core/print3d/orders.server";
import {
  clientCard,
  clientRefOf,
  findOrderByPhone,
  findOrderInText,
  groupCardBound,
  groupMessageHeader,
  groupReadyFailed,
  groupReadySent,
  groupWaiting,
  waitingCandidate,
  groupTakenNumber,
  isReadyStatus,
  normOrderNo,
  photoUrl,
  PRINT3D_STAFF,
  PRINT3D_TEXTS,
  type ClientWho,
  type Print3dOrder,
} from "@/core/print3d/sheet";
import { serverFailure } from "@/lib/server-failure";
import { sellerLocale } from "@/core/catalog/low-stock";
import type { TelegramApi } from "./api";
import type { TelegramMessage } from "./types";

export function isPrint3d(ctx: TenantContext): boolean {
  return ctx.tenant.vertical === "print3d";
}

/** Рабочая группа: чаты-группы из admin_chat_id; нет групп — все продавцы в личке. */
async function workChats(ctx: TenantContext): Promise<string[]> {
  const all = await adminRecipients(ctx);
  const groups = all.filter((id) => id.startsWith("-"));
  return groups.length ? groups : all;
}

async function toWorkChats(
  ctx: TenantContext,
  send: (chatId: string) => Promise<unknown>,
): Promise<void> {
  for (const chatId of await workChats(ctx)) await send(chatId);
}

/** Карточка: фото с подписью, если фото есть и Telegram его взял; иначе текстом. */
async function sendCard(
  api: TelegramApi,
  chatId: number | string,
  text: string,
  photo: string | null,
): Promise<boolean> {
  if (photo && text.length <= 1024) {
    const r = await api.call("sendPhoto", { chat_id: chatId, photo, caption: text });
    if (r.ok) return true;
    // Фото не скачалось (закрытая ссылка Диска) — отказ точный, текст без фото не дубль.
  }
  const r = await api.call("sendMessage", { chat_id: chatId, text });
  return r.ok;
}

function whoOf(msg: TelegramMessage): ClientWho {
  const f = msg.from!;
  return {
    id: String(f.id),
    name: [f.first_name, f.last_name].filter(Boolean).join(" "),
    username: f.username,
  };
}

/** Сообщение клиента — в рабочую группу: текст с подписью или копия вложения с подписью. */
async function copyToWork(
  ctx: TenantContext,
  api: TelegramApi,
  msg: TelegramMessage,
  header: string,
): Promise<void> {
  const text = msg.text?.trim();
  await toWorkChats(ctx, async (chatId) => {
    if (text) {
      await api.call("sendMessage", { chat_id: chatId, text: `${header}\n\n${text}` });
      return;
    }
    const caption = [header, msg.caption?.trim()].filter(Boolean).join("\n\n").slice(0, 1024);
    const r = await api.call("copyMessage", {
      chat_id: chatId,
      from_chat_id: msg.chat.id,
      message_id: msg.message_id,
      caption,
    });
    // Стикер и прочее без подписи: копия без неё, подпись отдельным сообщением.
    if (!r.ok) {
      await api.call("copyMessage", {
        chat_id: chatId,
        from_chat_id: msg.chat.id,
        message_id: msg.message_id,
      });
      await api.call("sendMessage", { chat_id: chatId, text: header });
    }
  });
}

/** Вставка «один раз» для просьбы прислать номер — в app_settings, как привязка. */
async function askOnce(ctx: TenantContext, clientId: string): Promise<boolean> {
  const { error } = await ctx.db.from("app_settings").insert({
    bot_id: ctx.tenant.id,
    key: `print3d_asked:${clientId}`,
    value: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (!error) return true;
  if ((error as { code?: string }).code === "23505") return false;
  throw serverFailure(`Просьба о номере заказа: ${error.message}`);
}

/**
 * Личное сообщение клиента студии. Возвращает true, если сообщение
 * обработано (дальше обычный бот не идёт — у студии нет каталога и кассы).
 */
export async function print3dPrivateMessage(
  ctx: TenantContext,
  api: TelegramApi,
  msg: TelegramMessage,
  locale: Locale,
  contactPhone: string | null,
): Promise<boolean> {
  if (!isPrint3d(ctx) || !msg.from) return false;
  const who = whoOf(msg);
  const client = { platform: "telegram" as const, id: who.id };
  const m = PRINT3D_TEXTS[locale];
  const text = msg.text?.trim() ?? "";
  const sl = await sellerLocale(ctx);

  // /start — просьба прислать номер (не чаще одного раза; повторный /start молчит).
  if (text.startsWith("/start")) {
    if (await askOnce(ctx, who.id))
      await api.call("sendMessage", { chat_id: msg.chat.id, text: m.askNumber });
    return true;
  }

  const load = await loadPrint3dOrders(ctx);
  const orders: Print3dOrder[] = load.ok ? load.orders : [];
  // Номер с чека в тексте; иначе телефон: контакт кнопкой или уже известный боту.
  // Чужой контакт (переслали карточку знакомого) — не телефон клиента: по нему не ищем.
  const ownContact = msg.contact && msg.contact.user_id === msg.from.id ? msg.contact : null;
  const phone = ownContact?.phone_number ?? contactPhone;
  const found =
    (text && findOrderInText(text, orders)) || (phone && findOrderByPhone(phone, orders)) || null;

  if (found) {
    const res = await bindOrder(ctx, found.no, client);
    if (res.kind === "bound") {
      await sendCard(api, msg.chat.id, clientCard(found, locale), photoUrl(found.photo));
      const photo = photoUrl(found.photo);
      await toWorkChats(ctx, (chatId) =>
        sendCard(api, chatId, groupCardBound(found, who, sl), photo),
      );
      // Клиент написал не только номер («Здравствуйте, заказ 1234, а можно…») — мастеру и текст.
      if (normOrderNo(text) !== found.no)
        await copyToWork(ctx, api, msg, groupMessageHeader(who, found.no, sl));
      return true;
    }
    if (res.kind === "taken") {
      if (await askOnce(ctx, `taken:${found.no}:${who.id}`))
        await api.call("sendMessage", { chat_id: msg.chat.id, text: m.takenNumber });
      await toWorkChats(ctx, (chatId) =>
        api.call("sendMessage", { chat_id: chatId, text: groupTakenNumber(found.no, who, sl) }),
      );
      return true;
    }
    // Тот же клиент прислал номер ещё раз — не повторяем карточку, сообщение мастеру.
  }

  // Номера ещё нет в таблице: мастер мог попросить написать раньше, чем внёс строку.
  // Запоминаем — крон пришлёт карточку, когда строка появится.
  const candidate = found ? null : waitingCandidate(text);
  if (candidate && (await addWait(ctx, candidate, client))) {
    await api.call("sendMessage", { chat_id: msg.chat.id, text: m.waiting(candidate) });
    await toWorkChats(ctx, (chatId) =>
      api.call("sendMessage", { chat_id: chatId, text: groupWaiting(candidate, who, sl) }),
    );
    return true;
  }

  const bound = orderOfClient(await listBindings(ctx), client);
  await copyToWork(ctx, api, msg, groupMessageHeader(who, found?.no ?? bound, sl));
  // Заказа не нашли и клиент ещё ни к чему не привязан — один раз просим номер.
  if (!found && !bound && (await askOnce(ctx, who.id)))
    await api.call("sendMessage", { chat_id: msg.chat.id, text: m.askNumber });
  return true;
}

/**
 * Мастер ответил свайпом в рабочей группе (или продавец в личке) на
 * сообщение с меткой клиента — бот копирует ответ клиенту (текст, фото,
 * файл). true — сообщение было ответом клиенту.
 */
export async function print3dWorkReply(
  ctx: TenantContext,
  api: TelegramApi,
  msg: TelegramMessage,
): Promise<boolean> {
  if (!isPrint3d(ctx) || !msg.reply_to_message || !msg.from) return false;
  const clientId = clientRefOf(msg.reply_to_message.text ?? msg.reply_to_message.caption);
  if (!clientId) return false;
  const staff = await adminRecipients(ctx);
  const fromStaff =
    staff.includes(String(msg.chat.id)) &&
    (msg.chat.type !== "private" || staff.includes(String(msg.from.id)));
  if (!fromStaff) return false;
  const st = PRINT3D_STAFF[await sellerLocale(ctx)];
  const r = await api.call("copyMessage", {
    chat_id: clientId,
    from_chat_id: msg.chat.id,
    message_id: msg.message_id,
  });
  await api.call("sendMessage", {
    chat_id: msg.chat.id,
    text: r.ok ? st.relaySent : st.relayFailed,
    reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true },
  });
  return true;
}

export type ReadyRun =
  | { skipped: string }
  | { ok: true; sent: number; failed: number; cards: number }
  | { ok: false; reason: string };

/**
 * Крон (минутная сетка рассылок), два дела:
 * 1. Номера, которых не было в таблице, когда клиент их прислал: строка
 *    появилась — привязываем и шлём карточку (как при первом сообщении).
 *    Не появилась за 3 дня — ожидание снимаем.
 * 2. Если продавец включил «заказ готов»: заказы со статусом «готово», клиент
 *    которых уже писал боту, получают одно сообщение «можно забирать».
 * Отметки ставятся до отправки; отправку, которая могла дойти, не повторяем.
 */
export async function runPrint3dReadyFor(
  ctx: TenantContext,
  api: TelegramApi | null,
  localeOfClient: (telegramId: string) => Promise<Locale>,
  budget: { deadline: number } = { deadline: Date.now() + 30_000 },
  now = new Date(),
): Promise<ReadyRun> {
  if (!isPrint3d(ctx)) return { skipped: "not print3d" };
  if (!api) return { skipped: "no telegram bot" };
  const [cfg, waits] = await Promise.all([print3dConfig(ctx), listWaits(ctx)]);
  if (!cfg.readyNotify && !waits.length) return { skipped: "nothing to do" };
  const load = await loadPrint3dOrders(ctx);
  if (!load.ok) return { ok: false, reason: load.reason };
  const byNo = new Map(load.orders.map((o) => [o.no, o]));
  const sl = await sellerLocale(ctx);
  let cards = 0;
  for (const w of waits) {
    if (Date.now() > budget.deadline) break;
    const o = byNo.get(w.no);
    if (!o) {
      if (waitExpired(w, now)) await dropWait(ctx, w.no);
      continue;
    }
    // Ожидание снимаем первым: второй крон его уже не увидит, а привязка — вставка один раз.
    await dropWait(ctx, w.no);
    if (w.client.platform !== "telegram") continue;
    const res = await bindOrder(ctx, o.no, { platform: "telegram", id: w.client.id }, now);
    if (res.kind !== "bound") continue;
    const locale = await localeOfClient(w.client.id);
    const photo = photoUrl(o.photo);
    await sendCard(api, w.client.id, clientCard(o, locale), photo);
    const who: ClientWho = { id: w.client.id, name: "" };
    await toWorkChats(ctx, (chatId) => sendCard(api, chatId, groupCardBound(o, who, sl), photo));
    cards++;
  }
  if (!cfg.readyNotify) return { ok: true, sent: 0, failed: 0, cards };
  const ready = load.orders.filter((o) => isReadyStatus(o.status));
  if (!ready.length) return { ok: true, sent: 0, failed: 0, cards };
  const [bindings, done] = await Promise.all([listBindings(ctx), listReadySent(ctx)]);
  let sent = 0;
  let failed = 0;
  for (const o of ready) {
    if (Date.now() > budget.deadline) break;
    const b = bindings.get(o.no);
    if (!b || b.platform !== "telegram" || done.has(o.no)) continue;
    if (!(await claimReady(ctx, o.no))) continue;
    const locale = await localeOfClient(b.id);
    const r = await api.call("sendMessage", {
      chat_id: b.id,
      text: PRINT3D_TEXTS[locale].ready(o.no),
    });
    if (r.ok) sent++;
    else failed++;
    // Мастеру видно и успех, и отказ: при отказе он звонит клиенту сам.
    const note = r.ok ? groupReadySent(o.no, b.id, sl) : groupReadyFailed(o.no, b.id, sl);
    await toWorkChats(ctx, (chatId) => api.call("sendMessage", { chat_id: chatId, text: note }));
  }
  return { ok: true, sent, failed, cards };
}
