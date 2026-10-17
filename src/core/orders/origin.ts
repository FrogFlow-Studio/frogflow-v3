import type { TenantContext } from "@/core/tenant/resolve.server";
import type { OrderRow } from "./order-model";
import type { OrderEvent } from "./events";
import { getSetting } from "@/core/settings/settings";

/**
 * Источник заказа («Экран: Почему бот так ответил»):
 * 1. Instagram Direct: по кодовому слову «Хлеб» (правило «день хлеба»)
 * 2. Instagram: ответ «+» на комментарий под рилсом (правило «...»)
 * 3. Instagram Direct (каталог / корзина)
 * 4. Витрина (сайт)
 * 5. Telegram-бот
 * 6. Заведён вручную продавцом
 */

export type OrderOriginType =
  | "instagram_keyword"
  | "instagram_comment"
  | "instagram_direct"
  | "web"
  | "telegram"
  | "manual"
  | "other";

export type OrderOrigin = {
  type: OrderOriginType;
  label: string;
  channel: string;
  ruleId?: string | null;
  ruleName?: string | null;
  keyword?: string | null;
  postTitle?: string | null;
  commentId?: string | null;
  triggerTime?: string | null;
  explanation?: string | null;
};

/** Окно поиска цепочки сообщений до заказа: до 72 часов. */
const REACTION_WINDOW_MS = 72 * 60 * 60_000;

export type AutomationRuleInfo = {
  id?: string;
  _id?: string;
  name?: string;
  keywords?: string[];
  postTitle?: string;
};

export async function resolveOrderOrigin(
  ctx: TenantContext,
  order: Pick<
    OrderRow,
    "id" | "platform" | "username" | "user_key" | "zernio_conversation_id" | "created_at"
  >,
  events?: OrderEvent[],
  opts: { rules?: AutomationRuleInfo[] } = {},
): Promise<OrderOrigin> {
  // 1. Проверяем уже зафиксированный источник в событии placed (новые заказы)
  const placed = events?.find((e) => e.kind === "placed");
  if (placed?.payload?.origin && typeof placed.payload.origin === "object") {
    const o = placed.payload.origin as Record<string, unknown>;
    const type = (typeof o.type === "string" ? o.type : "other") as OrderOriginType;
    const label = typeof o.label === "string" ? o.label : "";
    const channel = typeof o.channel === "string" ? o.channel : order.platform;
    const ruleName = typeof o.ruleName === "string" ? o.ruleName : null;
    const keyword = typeof o.keyword === "string" ? o.keyword : null;
    const postTitle = typeof o.postTitle === "string" ? o.postTitle : null;
    const explanation = typeof o.explanation === "string" ? o.explanation : null;
    if (label) {
      return {
        type,
        label,
        channel,
        ruleId: typeof o.ruleId === "string" ? o.ruleId : null,
        ruleName,
        keyword,
        postTitle,
        commentId: typeof o.commentId === "string" ? o.commentId : null,
        triggerTime: typeof o.triggerTime === "string" ? o.triggerTime : null,
        explanation,
      };
    }
  }

  // 2. Стандартные платформы (не Instagram)
  if (order.platform === "manual") {
    return {
      type: "manual",
      label: "Заведён вручную продавцом",
      channel: "manual",
      explanation:
        "Заказ заведён менеджером или владельцем магазина вручную через панель управления",
    };
  }

  if (order.platform === "web") {
    return {
      type: "web",
      label: "Витрина (сайт)",
      channel: "web",
      explanation: "Покупатель оформил заказ на сайте интернет-витрины",
    };
  }

  if (order.platform === "telegram") {
    return {
      type: "telegram",
      label: "Telegram-бот",
      channel: "telegram",
      explanation: "Покупатель оформил заказ через интерактивного Telegram-бота",
    };
  }

  if (order.platform !== "instagram") {
    return {
      type: "other",
      label: order.platform,
      channel: order.platform,
      explanation: `Заказ из канала ${order.platform}`,
    };
  }

  // 3. Instagram: ищем цепочку реакции бота в zernio_logs
  const orderTime = new Date(order.created_at).getTime();
  const since = new Date(orderTime - REACTION_WINDOW_MS).toISOString();
  const until = new Date(orderTime + 5 * 60_000).toISOString();

  try {
    const { data: logs, error } = await ctx.db
      .from("zernio_logs")
      .select("id, event_id, event_type, created_at, payload")
      .eq("bot_id", ctx.tenant.id)
      .in("event_type", ["two_step_dm_sent", "two_step_dm_pending"])
      .gte("created_at", since)
      .lte("created_at", until)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) {
      console.warn(`[orders:origin] ошибка поиска логов для заказа #${order.id}: ${error.message}`);
    }

    const orderUser = order.username?.toLowerCase().trim();
    const orderKey = order.user_key?.trim();
    const orderConv = order.zernio_conversation_id?.trim();

    const matchedLog = (logs ?? []).find((row) => {
      const p = row.payload as {
        username?: string;
        authorId?: string;
        automationId?: string;
        via?: string;
      } | null;
      if (!p) return false;

      if (orderUser && p.username && p.username.toLowerCase().trim() === orderUser) return true;
      if (orderKey && p.authorId && p.authorId === orderKey) return true;
      if (orderConv && row.event_id && row.event_id.includes(orderConv)) return true;
      return false;
    });

    if (matchedLog) {
      const p = matchedLog.payload as {
        username?: string;
        authorId?: string;
        automationId?: string;
        via?: string;
      };
      const autoId = p.automationId ?? "";
      const isKeyword =
        p.via === "dm_keyword" ||
        (matchedLog.event_id ? matchedLog.event_id.includes(":kw:") : false);

      // Пробуем сопоставить с правилами магазина
      let ruleName: string | null = null;
      let keyword: string | null = null;
      let postTitle: string | null = null;

      if (opts.rules?.length) {
        const rule = opts.rules.find((a) => String(a.id || a._id || "") === autoId);
        if (rule) {
          ruleName = rule.name ?? null;
          keyword = rule.keywords?.[0] ?? null;
          postTitle = rule.postTitle ?? null;
        }
      }

      if (!ruleName) {
        try {
          const raw = await getSetting(ctx, "ig_comment_automations_meta");
          if (raw) {
            const meta = JSON.parse(raw) as Record<string, { secondDmMessage?: string }>;
            if (meta[autoId]) {
              ruleName = `правило ${autoId.slice(0, 8)}`;
            }
          }
        } catch {
          // ignore
        }
      }
      if (!ruleName && autoId) {
        ruleName = `правило ${autoId.slice(0, 8)}`;
      }

      if (isKeyword) {
        const kwLabel = keyword ? `«${keyword}»` : "";
        const rLabel = ruleName ? ` (правило «${ruleName}»)` : "";
        const label = `Instagram Direct: по кодовому слову ${kwLabel}${rLabel}`.trim();
        return {
          type: "instagram_keyword",
          label,
          channel: "instagram",
          ruleId: autoId || null,
          ruleName,
          keyword,
          postTitle,
          triggerTime: matchedLog.created_at,
          explanation: `Покупатель написал в Direct кодовое слово${keyword ? ` «${keyword}»` : ""}, сработало правило${ruleName ? ` «${ruleName}»` : ""}. Бот отправил кнопку/ссылку на оформление заказа.`,
        };
      } else {
        const rLabel = ruleName ? ` (правило «${ruleName}»)` : "";
        const pLabel = postTitle ? ` под «${postTitle}»` : " под рилсом";
        const label = `Instagram: ответ «+» на комментарий${pLabel}${rLabel}`.trim();
        return {
          type: "instagram_comment",
          label,
          channel: "instagram",
          ruleId: autoId || null,
          ruleName,
          keyword,
          postTitle,
          triggerTime: matchedLog.created_at,
          explanation: `Покупатель оставил комментарий${postTitle ? ` под «${postTitle}»` : " под публикацией"}, получил в Direct первое сообщение и ответил «+», после чего бот выдал кнопку/ссылку на товар.`,
        };
      }
    }
  } catch (e) {
    console.warn(`[orders:origin] сбой разрешения источника для #${order.id}:`, e);
  }

  // Если логов двухшаговой автоматизации не найдено — заказ из корзины/каталога Direct
  return {
    type: "instagram_direct",
    label: "Instagram Direct (каталог / корзина)",
    channel: "instagram",
    explanation:
      "Покупатель открыл каталог или корзину в Direct и оформил заказ без перехода по специальному правилу комментариев",
  };
}
