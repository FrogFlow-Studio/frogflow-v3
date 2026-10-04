import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { SHOP_SLUG_RE } from "@/core/tenant/slug";
import { shownError } from "@/lib/shown-error";
import type { Locale } from "@/core/i18n/locale";

/**
 * Вход на витрину по коду из бота (В5, core/storefront/code-login). Работает
 * там же, где вход через Telegram: клиент на v2, оформление с сайта и вход
 * включены. Почта ничего не открывает: владение доказывает код, который бот
 * присылает в уже известный ему чат.
 */
const slug = z.string().regex(SHOP_SLUG_RE);

async function shopT(ctx: { tenant: { settings: { default_locale?: Locale } } }) {
  const { storefrontT } = await import("@/app/i18n/storefront");
  return storefrontT(ctx.tenant.settings.default_locale ?? "ru");
}

/** Магазин, где вход по коду есть, или null. Клиент прежней платформы — null (servedByV2 в storefrontOpen). */
async function codeCtx(s: string) {
  const { resolveTenant, tenantContext } = await import("@/core/tenant/resolve.server");
  const { storefrontOpen } = await import("@/core/storefront/access");
  const t = await resolveTenant({ by: "slug", value: s });
  if (!t || !storefrontOpen(t, "web_checkout")) return null;
  const ctx = tenantContext(t);
  const { tgLoginAvailable } = await import("./tg-login.server");
  return (await tgLoginAvailable(ctx)) ? ctx : null;
}

/** Ссылка в бот с новой меткой и текст для Instagram/WhatsApp, если они подключены. */
export const codeLoginStartFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ slug }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await codeCtx(data.slug);
    if (!ctx) throw notFound();
    const t = await shopT(ctx);
    const { clientIp } = await import("@/app/auth/login-guard.server");
    const { takeWeb } = await import("@/core/storefront/checkout-guard");
    if (!(await takeWeb(ctx, "codeStart", clientIp() ?? "unknown")))
      throw shownError(t("error.tooManyRequests"));
    const { newLoginNonce, LOGIN_START_PREFIX } = await import("@/core/storefront/code-login");
    const nonce = newLoginNonce();
    const { setLoginNonce } = await import("./code-login.server");
    setLoginNonce(ctx, nonce);
    const bot = ctx.tenant.settings.telegram?.username;
    const direct = (ctx.tenant.settings.zernio?.accounts ?? []).some(
      (a) => !a.expired && (a.platform === "instagram" || a.platform === "whatsapp"),
    );
    return {
      botLink: bot ? `https://t.me/${bot}?start=${LOGIN_START_PREFIX}${nonce}` : null,
      directText: direct ? `вход ${nonce}` : null,
    };
  });

const MESSAGE_KEY = {
  unknown: "login.code.unknown",
  expired: "login.code.expired",
  used: "login.code.used",
  locked: "login.code.locked",
} as const;

export const codeLoginFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        slug,
        code: z
          .string()
          .trim()
          .regex(/^\d{6}$/),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await codeCtx(data.slug);
    if (!ctx) throw notFound();
    const t = await shopT(ctx);
    const { clientIp } = await import("@/app/auth/login-guard.server");
    const { takeWeb } = await import("@/core/storefront/checkout-guard");
    if (!(await takeWeb(ctx, "codeTry", clientIp() ?? "unknown")))
      throw shownError(t("error.tooManyRequests"));
    const { readLoginNonce, clearLoginNonce } = await import("./code-login.server");
    const nonce = readLoginNonce(ctx);
    if (!nonce) throw shownError(t("login.code.noLink"));
    const { env } = await import("@/config/env");
    const { checkLoginCode } = await import("@/core/storefront/code-login");
    const r = await checkLoginCode(ctx, env().SESSION_SECRET, nonce, data.code);
    if (!r.ok) {
      if (r.reason === "wrong") throw shownError(t("login.code.wrong", { n: r.left }));
      throw shownError(t(MESSAGE_KEY[r.reason]));
    }
    const { startBuyerSession } = await import("./tg-login.server");
    startBuyerSession(ctx, r.telegramId);
    clearLoginNonce(ctx);
    const { getCustomerByTelegramId } = await import("@/core/customers/customers");
    const c = await getCustomerByTelegramId(ctx, r.telegramId);
    return {
      name:
        [c?.firstName, c?.lastName].filter(Boolean).join(" ") ||
        (c?.username ? `@${c.username}` : "Telegram"),
    };
  });
