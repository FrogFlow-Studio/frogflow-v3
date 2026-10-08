import { env } from "@/config/env";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { shownError } from "@/lib/shown-error";

/**
 * Админка продавца: вход и выход продавца (пароль, Telegram).
 * Каждая серверная функция начинается с гварда (requireAdmin…): контекст
 * арендатора берётся из сессии, подключение к базе — под его ролью.
 */

export const adminLogin = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ username: z.string().min(1), password: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { resolveAdminLogin, checkAdminPassword } = await import("./admin.server");
    const { appSession } = await import("@/app/auth/session.server");
    const { issueSession, operatorSessionMark } = await import("@/app/auth/session-id");
    const { clientIp, loginLocked, recordLogin, loginDelay } =
      await import("@/app/auth/login-guard.server");
    const ip = clientIp();
    await loginDelay();
    // Один вход на всех: данные оператора платформы открывают панель оператора.
    {
      const { isOperatorUsername, verifyOperator, operatorStamp } =
        await import("@/app/operator/credentials.server");
      if (await isOperatorUsername(data.username)) {
        if (await loginLocked("operator", ip))
          throw new Error("Слишком много неудачных попыток. Попробуйте через 15 минут.");
        // Магазин с тем же логином входит своим паролем (auth/login-route).
        const { routeOperatorName } = await import("@/app/auth/login-route");
        const route = await routeOperatorName({
          operator: () => verifyOperator(data.username, data.password),
          shop: async () => {
            const shop = await resolveAdminLogin(data.username);
            return Boolean(shop && checkAdminPassword(shop, data.password));
          },
        });
        if (route !== "shop") {
          if (route !== "operator") {
            await recordLogin("operator", ip, false, data.username);
            return { ok: false as const };
          }
          // С двухшаговым входом сессию выдаёт только страница входа оператора,
          // где спрашивают код; здесь — лишь отправляем туда. Вход ещё не
          // состоялся, поэтому и удачным он не записывается.
          const { twoFactorStatus } = await import("@/app/operator/two-factor.server");
          if ((await twoFactorStatus()).enabled)
            return { ok: true as const, role: "operator" as const, needCode: true as const };
          await recordLogin("operator", ip, true, data.username);
          await (
            await appSession()
          ).update({
            operator: true,
            operatorStamp: (await operatorStamp()) ?? undefined,
            ...operatorSessionMark(),
          });
          return { ok: true as const, role: "operator" as const };
        }
      }
    }
    const login = await resolveAdminLogin(data.username);
    if (!login) return { ok: false as const };
    const t = login.tenant;
    // Сессии продавца ещё нет — текст сразу на языке магазина.
    const { adminT } = await import("@/app/i18n/admin");
    const tr = adminT(t.settings.default_locale ?? "ru");
    // Клиента ещё обслуживает прежняя платформа: заказы и выдача идут там,
    // и подтверждение заказа отсюда осталось бы без бота (токен только у v1).
    {
      const { servedByV2 } = await import("@/core/tenant/directory");
      if (!servedByV2(t)) throw shownError(tr("err.login.oldPlatform"));
    }
    if (await loginLocked({ botId: t.id }, ip)) throw shownError(tr("err.login.tooMany"));
    const ok = checkAdminPassword(login, data.password);
    await recordLogin({ botId: t.id }, ip, ok, data.username);
    if (!ok) return { ok: false as const };
    const { adminStamp } = await import("@/app/auth/guards.server");
    const username = data.username.trim().toLowerCase();
    await (
      await appSession()
    ).update({
      admin: {
        botId: t.id,
        username,
        role: login.role,
        stamp: adminStamp(t.id, username, login.passwordHash),
        ...issueSession(),
      },
    });
    return { ok: true as const, role: "admin" as const };
  });

/**
 * Вход владельца через Telegram (app/auth/tg-login.server): бот магазина
 * присылает владельцу одноразовую ссылку. Ответ всегда один и тот же — по
 * нему не узнать, есть ли логин и привязан ли Telegram.
 */
export const adminTgLoginRequest = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ username: z.string().min(1).max(100) }).parse(d))
  .handler(async ({ data }) => {
    const done = { ok: true as const };
    const { resolveAdminLogin } = await import("./admin.server");
    const { clientIp, loginDelay } = await import("@/app/auth/login-guard.server");
    const ip = clientIp();
    await loginDelay();
    const login = await resolveAdminLogin(data.username);
    if (!login || login.role !== "owner") return done;
    const t = login.tenant;
    const { servedByV2 } = await import("@/core/tenant/directory");
    if (!servedByV2(t) || t.archived || !t.ownerTelegramId || !t.telegramTokenEnc) return done;
    const { tenantContext } = await import("@/core/tenant/resolve.server");
    const ctx = tenantContext(t);
    const { requestTgLogin } = await import("@/app/auth/tg-login-request.server");
    const { recordShopAction } = await import("./audit.server");
    const { normalizeLogin } = await import("@/core/auth/roles");
    const { telegramApi } = await import("@/channels/telegram/api");
    const { tgLoginMessage } = await import("@/app/auth/tg-login-text");
    const r = await requestTgLogin(
      ctx,
      normalizeLogin(data.username),
      async (token) => {
        const link = `${env().APP_URL}/admin/tg-login?b=${t.id}&t=${token}`;
        await telegramApi(ctx.secrets.telegramToken(), env().TELEGRAM_API_BASE)
          .call("sendMessage", {
            chat_id: t.ownerTelegramId,
            text: tgLoginMessage(t.settings.default_locale ?? "ru", link),
            link_preview_options: { is_disabled: true },
          })
          .catch(() => undefined);
      },
      (result) =>
        recordShopAction(
          { botId: t.id, username: normalizeLogin(data.username) },
          "tgLoginRequest",
          {
            result,
            ip: ip ?? "—",
          },
        ),
    );
    // Предел часа виден только настоящему владельцу магазина; остальным ответ прежний.
    if (r === "limited") return { ok: true as const, limited: true as const };
    return done;
  });

export const adminTgLoginConsume = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ b: z.string().uuid(), t: z.string().min(1).max(100) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { resolveTenant, tenantContext } = await import("@/core/tenant/resolve.server");
    const t = await resolveTenant({ by: "id", value: data.b });
    const { servedByV2 } = await import("@/core/tenant/directory");
    if (!t || t.archived || !servedByV2(t)) return { ok: false as const };
    const { consumeLoginToken } = await import("@/app/auth/tg-login.server");
    const username = await consumeLoginToken(tenantContext(t), data.t);
    if (!username) return { ok: false as const };
    const { resolveAdminLogin } = await import("./admin.server");
    const login = await resolveAdminLogin(username);
    if (!login || login.role !== "owner" || login.tenant.id !== t.id) return { ok: false as const };
    const { clientIp, recordLogin } = await import("@/app/auth/login-guard.server");
    await recordLogin({ botId: t.id }, clientIp(), true, `tg:${username}`);
    const { appSession } = await import("@/app/auth/session.server");
    const { issueSession } = await import("@/app/auth/session-id");
    const { adminStamp } = await import("@/app/auth/guards.server");
    await (
      await appSession()
    ).update({
      admin: {
        botId: t.id,
        username,
        role: login.role,
        stamp: adminStamp(t.id, username, login.passwordHash),
        ...issueSession(),
      },
    });
    return { ok: true as const };
  });

export const adminLogout = createServerFn({ method: "POST" }).handler(async () => {
  const { appSession } = await import("@/app/auth/session.server");
  const s = await appSession();
  const a = s.data.admin;
  // Сначала отзыв, потом стирание: скопированная cookie после выхода не работает.
  if (a?.sid) {
    const { revokeSession } = await import("@/app/auth/revocation.server");
    await revokeSession(a.sid, a.iat);
  }
  await s.update({ admin: undefined });
  return { ok: true };
});
