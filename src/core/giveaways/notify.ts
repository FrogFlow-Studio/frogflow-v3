import { randomBytes } from "node:crypto";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Json } from "@/core/db-types";
import type { Locale } from "@/core/i18n/locale";
import { buyerLocale } from "@/core/i18n/locale";
import { blockedAmong, getCustomer, type Customer } from "@/core/customers/customers";
import { claimMarketing, loadMarketingCap } from "@/core/marketing/cap";
import { lastInboundAt } from "@/core/chat/chat";
import { replyWindow } from "@/core/chat/reply-window";
import { serverFailure } from "@/lib/server-failure";
import { listParticipants } from "./draw";
import { getGiveaway, type Giveaway } from "./giveaway";

/**
 * Сообщение участникам после выбора (К5). На каждого человека и вид
 * сообщения — одна строка `giveaway.notice` в `zernio_logs` с уникальным
 * event_id: строку вставляют ДО отправки, и пишет только тот, чья вставка
 * прошла (23505 — уже занято). Повтор крона, двойной клик и два крона разом
 * поэтому не удваивают сообщение и не выдают второй промокод.
 *
 * Виды: `prize` — победителю, `consolation` — остальным участникам.
 * Промокод приза — одноразовый (`max_uses = 1`), выписан под этого человека и
 * показан только ему в его сообщении; в таблице promo_codes колонки
 * покупателя нет (схема общая с v1), поэтому «привязка» — это строка учёта с
 * кодом и ключом покупателя, а не проверка при заказе.
 *
 * Instagram и WhatsApp: писать можно только в окне 24 часа с последнего
 * входящего. Окно закрыто — сообщения нет, продавцу уходит задание
 * «напишите вручную». Отправка, которая могла дойти (обрыв, тайм-аут, 5xx),
 * не повторяется: строка получает статус `unknown`, продавец проверяет сам.
 */
export const NOTICE_EVENT = "giveaway.notice";
export const noticeEventId = (giveawayId: string, kind: NoticeKind, userKey: string) =>
  `giveaway:${giveawayId}:notice:${kind}:${userKey}`;

export type NoticeKind = "prize" | "consolation";
/** Статус строки: claimed — вставлена, отправка идёт; остальное — итог. */
export type NoticeStatus =
  | "claimed"
  | "sent"
  /** Не отправлено, продавцу «напишите вручную» (окно закрыто, нет канала, отказ). */
  | "manual"
  /** Мог дойти (обрыв, 5xx): повторять нельзя. */
  | "unknown"
  /** Утешительное: потолок маркетинга, окно, блокировка — не отправляли. */
  | "skipped";

/** sent — принято; rejected — точно не принято; unknown — могло дойти. */
export type SendOutcome = "sent" | "rejected" | "unknown";

export type NoticeDeps = {
  /** Текст в канал покупателя (HTML Telegram; в Instagram адаптер снимает разметку). */
  send(c: Customer, html: string): Promise<SendOutcome>;
  /** Сообщение продавцу (Telegram, push). Сбой не должен бросать. */
  notifySeller(html: string): Promise<void>;
};

export type NoticeRun = {
  sent: number;
  /** Победители, которым продавец пишет сам. */
  manual: number;
  /** Отправка могла дойти — продавцу «проверьте». */
  unknown: number;
  consolationSent: number;
  consolationSkipped: number;
  /** Не успели за бюджет или упали на чтении: следующий прогон продолжит. */
  left: number;
  /** Все победители и (если включено) утешительные обработаны. */
  done: boolean;
};

/** Утешительное сообщение уходит только в первые дни после выбора: позже оно выглядит странно. */
export const CONSOLATION_DAYS = 3;
export const NOTICE_BUDGET_MS = 60_000;
const DAY_MS = 86_400_000;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

type Copy = {
  winCode: string;
  winContact: string;
  consolation: string;
  manualHead: string;
  manualWindow: string;
  manualFailed: string;
  manualNoChannel: string;
  unknownHead: string;
};

const COPY: Record<Locale, Copy> = {
  ru: {
    winCode:
      "🎉 Вы победили в розыгрыше «{title}»!\nПриз: {prize}\n\nПромокод: <code>{code}</code> — скидка {percent}%, действует до {date}, подходит один раз. Введите его при заказе.",
    winContact:
      "🎉 Вы победили в розыгрыше «{title}»!\nПриз: {prize}\n\nПродавец свяжется с вами сам.",
    consolation:
      "Спасибо, что участвовали в розыгрыше «{title}»! В этот раз приз достался другим, а вам — промокод <code>{code}</code>: скидка {percent}% до {date}, на один заказ.",
    manualHead: "🎁 Розыгрыш «{title}»: напишите победителям вручную —",
    manualWindow: "окно ответа закрыто (24 часа с последнего сообщения)",
    manualFailed: "сообщение не принято",
    manualNoChannel: "нет канала для сообщения",
    unknownHead:
      "🎁 Розыгрыш «{title}»: не удалось понять, дошло ли сообщение. Проверьте и при необходимости напишите сами —",
  },
  kk: {
    winCode:
      "🎉 Сіз «{title}» ұтыс ойынында жеңдіңіз!\nЖүлде: {prize}\n\nПромокод: <code>{code}</code> — {percent}% жеңілдік, {date} дейін жарамды, бір рет қолданылады. Тапсырыс кезінде енгізіңіз.",
    winContact:
      "🎉 Сіз «{title}» ұтыс ойынында жеңдіңіз!\nЖүлде: {prize}\n\nСатушы сізбен өзі хабарласады.",
    consolation:
      "«{title}» ұтыс ойынына қатысқаныңызға рахмет! Бұл жолы жүлде басқаларға бұйырды, ал сізге промокод: <code>{code}</code> — {percent}% жеңілдік, {date} дейін, бір тапсырысқа.",
    manualHead: "🎁 «{title}» ұтыс ойыны: жеңімпаздарға өзіңіз жазыңыз —",
    manualWindow: "жауап терезесі жабық (соңғы хабарламадан 24 сағат)",
    manualFailed: "хабарлама қабылданбады",
    manualNoChannel: "хабарлама жіберетін арна жоқ",
    unknownHead:
      "🎁 «{title}» ұтыс ойыны: хабарлама жеткені белгісіз. Тексеріп, қажет болса өзіңіз жазыңыз —",
  },
  en: {
    winCode:
      "🎉 You won the giveaway “{title}”!\nPrize: {prize}\n\nPromo code: <code>{code}</code> — {percent}% off, valid until {date}, works once. Enter it when you order.",
    winContact:
      "🎉 You won the giveaway “{title}”!\nPrize: {prize}\n\nThe seller will contact you.",
    consolation:
      "Thank you for joining the giveaway “{title}”! The prize went to others this time, but here is a promo code for you: <code>{code}</code> — {percent}% off until {date}, for one order.",
    manualHead: "🎁 Giveaway “{title}”: write to the winners yourself —",
    manualWindow: "the reply window is closed (24 hours since their last message)",
    manualFailed: "the message was not accepted",
    manualNoChannel: "no channel to message them",
    unknownHead:
      "🎁 Giveaway “{title}”: it is unclear whether the message arrived. Check and write yourself if needed —",
  },
  uz: {
    winCode:
      "🎉 Siz «{title}» o'yinida g'olib bo'ldingiz!\nSovrin: {prize}\n\nPromokod: <code>{code}</code> — {percent}% chegirma, {date} gacha amal qiladi, bir marta ishlatiladi. Buyurtma paytida kiriting.",
    winContact:
      "🎉 Siz «{title}» o'yinida g'olib bo'ldingiz!\nSovrin: {prize}\n\nSotuvchi siz bilan o'zi bog'lanadi.",
    consolation:
      "«{title}» o'yinida qatnashganingiz uchun rahmat! Bu safar sovrin boshqalarga nasib etdi, sizga esa promokod: <code>{code}</code> — {percent}% chegirma, {date} gacha, bitta buyurtma uchun.",
    manualHead: "🎁 «{title}» o'yini: g'oliblarga o'zingiz yozing —",
    manualWindow: "javob oynasi yopiq (oxirgi xabardan 24 soat)",
    manualFailed: "xabar qabul qilinmadi",
    manualNoChannel: "xabar yuboradigan kanal yo'q",
    unknownHead:
      "🎁 «{title}» o'yini: xabar yetib borgani noma'lum. Tekshiring, kerak bo'lsa o'zingiz yozing —",
  },
};

const fill = (tpl: string, vars: Record<string, string | number>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));

const dateOf = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
};

/** Одноразовый промокод на процент скидки; занятый код — другой, до трёх раз. */
export async function issueGiveawayPromo(
  ctx: TenantContext,
  percent: number,
  validUntil: Date,
): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = `GW-${randomBytes(5).toString("hex").toUpperCase().slice(0, 8)}`;
    const { error } = await ctx.db.from("promo_codes").insert({
      bot_id: ctx.tenant.id,
      code,
      discount_type: "percent",
      discount_value: percent,
      max_uses: 1,
      valid_until: validUntil.toISOString(),
      is_active: true,
    });
    if (!error) return code;
    if (error.code !== "23505") throw serverFailure(`Розыгрыш: выпуск промокода: ${error.message}`);
  }
  throw serverFailure("Розыгрыш: код промокода не подобрался");
}

async function insertNotice(
  ctx: TenantContext,
  g: Giveaway,
  kind: NoticeKind,
  userKey: string,
  status: NoticeStatus,
  extra: Record<string, Json>,
  now: Date,
): Promise<boolean> {
  const { error } = await ctx.db.from("zernio_logs").insert({
    bot_id: ctx.tenant.id,
    event_id: noticeEventId(g.id, kind, userKey),
    event_type: NOTICE_EVENT,
    status,
    payload: {
      giveaway_id: g.id,
      user_key: userKey,
      kind,
      at: now.toISOString(),
      ...extra,
    } as Json,
  });
  if (!error) return true;
  if (error.code === "23505") return false;
  throw serverFailure(`Розыгрыш: отметка сообщения не записана: ${error.message}`);
}

async function settleNotice(
  ctx: TenantContext,
  g: Giveaway,
  kind: NoticeKind,
  userKey: string,
  status: NoticeStatus,
  extra: Record<string, Json>,
  now: Date,
): Promise<void> {
  const { error } = await ctx.db
    .from("zernio_logs")
    .update({
      status,
      payload: {
        giveaway_id: g.id,
        user_key: userKey,
        kind,
        at: now.toISOString(),
        ...extra,
      } as Json,
    })
    .eq("event_id", noticeEventId(g.id, kind, userKey))
    .eq("status", "claimed");
  if (error) console.error(`[giveaway:${ctx.tenant.id}] итог отметки ${userKey}: ${error.message}`);
}

/** Сбросить свою вставку, когда ничего не отправлено и не выдано: следующий прогон попробует снова. */
async function releaseNotice(
  ctx: TenantContext,
  g: Giveaway,
  kind: NoticeKind,
  userKey: string,
): Promise<void> {
  const { error } = await ctx.db
    .from("zernio_logs")
    .delete()
    .eq("event_id", noticeEventId(g.id, kind, userKey))
    .eq("status", "claimed");
  if (error)
    console.error(`[giveaway:${ctx.tenant.id}] отметка не снята ${userKey}: ${error.message}`);
}

const isZernio = (c: Customer) => c.platform === "instagram" || c.platform === "whatsapp";

/**
 * Разослать сообщения по выбранному розыгрышу. Безопасно вызывать сколько
 * угодно раз: уже обработанные пропускаются по строкам учёта. `left > 0` —
 * бюджет вышел или чтение упало, нужен ещё прогон.
 */
export async function notifyGiveaway(
  ctx: TenantContext,
  giveawayId: string,
  deps: NoticeDeps,
  opts: { now?: () => number; budgetMs?: number } = {},
): Promise<NoticeRun> {
  const clock = opts.now ?? Date.now;
  const started = clock();
  const budget = opts.budgetMs ?? NOTICE_BUDGET_MS;
  const run: NoticeRun = {
    sent: 0,
    manual: 0,
    unknown: 0,
    consolationSent: 0,
    consolationSkipped: 0,
    left: 0,
    done: true,
  };
  const g = await getGiveaway(ctx, giveawayId);
  if (!g || g.status !== "drawn" || !g.result) return run;
  const shopLocale = ctx.tenant.settings.default_locale;
  const sellerCopy = COPY[shopLocale ?? "ru"];
  const manualLines: string[] = [];
  const unknownLines: string[] = [];
  const over = () => clock() - started >= budget;
  const label = (c: Customer | null, userKey: string) =>
    c?.username ? `@${esc(c.username)}` : esc(c?.firstName ?? userKey);

  const winnerKeys = new Set(g.result.winners.map((w) => w.userKey));

  for (const w of g.result.winners) {
    if (over()) {
      run.left++;
      continue;
    }
    try {
      const c = await getCustomer(ctx, w.userKey);
      const who = label(c, w.userKey);
      const lang = buyerLocale(c?.state, shopLocale);
      const copy = COPY[lang];
      let reason: string | null = null;
      if (!c || (c.platform === "telegram" ? !c.telegramId : !isZernio(c))) {
        reason = sellerCopy.manualNoChannel;
      } else if (isZernio(c)) {
        const win = replyWindow(c.platform, await lastInboundAt(ctx, c.telegramId), clock());
        if (win?.state !== "open") reason = sellerCopy.manualWindow;
      }
      if (reason) {
        // Сообщения не будет: строка-задание, продавцу — в общий список.
        if (
          await insertNotice(ctx, g, "prize", w.userKey, "manual", { reason }, new Date(clock()))
        ) {
          run.manual++;
          manualLines.push(`• ${who} — ${reason}`);
        }
        continue;
      }
      if (!c) continue;
      if (!(await insertNotice(ctx, g, "prize", w.userKey, "claimed", {}, new Date(clock()))))
        continue;
      let code: string | null = null;
      const until = new Date(clock() + g.promoDays * DAY_MS);
      if (g.prizePromoPercent > 0) {
        try {
          code = await issueGiveawayPromo(ctx, g.prizePromoPercent, until);
        } catch (e) {
          // Промокод не выписался — ничего не отправлено: снимаем отметку, повторим в следующий прогон.
          await releaseNotice(ctx, g, "prize", w.userKey);
          throw e;
        }
      }
      const html = code
        ? fill(copy.winCode, {
            title: esc(g.title),
            prize: esc(g.prize),
            code,
            percent: g.prizePromoPercent,
            date: dateOf(until.toISOString()),
          })
        : fill(copy.winContact, { title: esc(g.title), prize: esc(g.prize) });
      const outcome = await deps.send(c, html);
      const extra: Record<string, Json> = code ? { promo_code: code } : {};
      if (outcome === "sent") {
        await settleNotice(ctx, g, "prize", w.userKey, "sent", extra, new Date(clock()));
        run.sent++;
      } else if (outcome === "rejected") {
        await settleNotice(
          ctx,
          g,
          "prize",
          w.userKey,
          "manual",
          { ...extra, reason: "rejected" },
          new Date(clock()),
        );
        run.manual++;
        manualLines.push(`• ${who} — ${sellerCopy.manualFailed}${code ? ` (${code})` : ""}`);
      } else {
        await settleNotice(ctx, g, "prize", w.userKey, "unknown", extra, new Date(clock()));
        run.unknown++;
        unknownLines.push(`• ${who}${code ? ` — ${code}` : ""}`);
      }
    } catch (e) {
      console.error(`[giveaway:${ctx.tenant.id}] победитель ${w.userKey}`, e);
      run.left++;
    }
  }

  if (
    g.consolationPercent > 0 &&
    clock() - Date.parse(g.result.drawnAt) < CONSOLATION_DAYS * DAY_MS
  ) {
    try {
      await consolation(ctx, g, deps, winnerKeys, run, over, clock);
    } catch (e) {
      console.error(`[giveaway:${ctx.tenant.id}] утешительные`, e);
      run.left++;
    }
  }

  const head = (tpl: string) => fill(tpl, { title: esc(g.title) });
  if (manualLines.length)
    await deps.notifySeller(`${head(sellerCopy.manualHead)}\n${manualLines.join("\n")}`);
  if (unknownLines.length)
    await deps.notifySeller(`${head(sellerCopy.unknownHead)}\n${unknownLines.join("\n")}`);
  run.done = run.left === 0;
  return run;
}

async function consolation(
  ctx: TenantContext,
  g: Giveaway,
  deps: NoticeDeps,
  winnerKeys: Set<string>,
  run: NoticeRun,
  over: () => boolean,
  clock: () => number,
): Promise<void> {
  const others = (await listParticipants(ctx, g.id)).filter((p) => !winnerKeys.has(p.userKey));
  const blocked = await blockedAmong(
    ctx,
    others.flatMap((p) => (p.telegramId ? [p.telegramId] : [])),
  );
  const cap = await loadMarketingCap(ctx);
  const shopLocale = ctx.tenant.settings.default_locale;
  for (let i = 0; i < others.length; i++) {
    const p = others[i]!;
    if (over()) {
      run.left += others.length - i;
      return;
    }
    // Уже обработан (строка есть) — не трогаем: ни чтения покупателя, ни сообщения.
    const { data: seen, error } = await ctx.db
      .from("zernio_logs")
      .select("id")
      .eq("event_id", noticeEventId(g.id, "consolation", p.userKey))
      .maybeSingle();
    if (error) throw serverFailure(`Розыгрыш: отметка сообщения не прочиталась: ${error.message}`);
    if (seen) continue;
    const now = () => new Date(clock());
    const skip = async (why: string) => {
      if (await insertNotice(ctx, g, "consolation", p.userKey, "skipped", { why }, now()))
        run.consolationSkipped++;
    };
    if (p.telegramId && blocked.has(p.telegramId)) {
      await skip("blocked");
      continue;
    }
    const c = await getCustomer(ctx, p.userKey);
    if (!c) {
      await skip("no_customer");
      continue;
    }
    if (isZernio(c)) {
      const win = replyWindow(c.platform, await lastInboundAt(ctx, c.telegramId), clock());
      if (win?.state !== "open") {
        await skip("window_closed");
        continue;
      }
    }
    if (!(await insertNotice(ctx, g, "consolation", p.userKey, "claimed", {}, now()))) continue;
    try {
      // Потолок маркетинга занимает условная запись по короткому полю; не заняли — не шлём.
      const claimed = await claimMarketing(ctx, c.userKey, c.state as Json, cap, now());
      if (!claimed) {
        await settleNotice(ctx, g, "consolation", p.userKey, "skipped", { why: "cap" }, now());
        run.consolationSkipped++;
        continue;
      }
      const until = new Date(clock() + g.promoDays * DAY_MS);
      let code: string;
      try {
        code = await issueGiveawayPromo(ctx, g.consolationPercent, until);
      } catch (e) {
        // Метку маркетинга не откатываем: сообщение не уйдёт сегодня, повтор — в следующий прогон.
        await releaseNotice(ctx, g, "consolation", p.userKey);
        throw e;
      }
      const html = fill(COPY[buyerLocale(c.state, shopLocale)].consolation, {
        title: esc(g.title),
        code,
        percent: g.consolationPercent,
        date: dateOf(until.toISOString()),
      });
      const outcome = await deps.send(c, html);
      // Утешительное — не задание продавцу: что бы ни вышло, повторов нет.
      await settleNotice(
        ctx,
        g,
        "consolation",
        p.userKey,
        outcome === "sent" ? "sent" : outcome === "rejected" ? "skipped" : "unknown",
        { promo_code: code },
        now(),
      );
      if (outcome === "sent") run.consolationSent++;
      else run.consolationSkipped++;
    } catch (e) {
      console.error(`[giveaway:${ctx.tenant.id}] утешительное ${p.userKey}`, e);
      run.left++;
    }
  }
}
