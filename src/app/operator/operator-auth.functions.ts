import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Серверные функции панели оператора: вход, учётка и двухшаговый вход оператора.
 * Каждая начинается с requireOperator():
 * маршрутный гейт — только UX, функции вызываются по HTTP напрямую.
 * Реализация — в серверных модулях *.server.ts (не попадают в бандл).
 */
const guard = async () => (await import("@/app/auth/guards.server")).requireOperator();

/** Кто действует — логин оператора из базы; в журнале bot_events. */
const actor = async () =>
  (await (await import("./credentials.server")).operatorCredentialsSource()).username ?? "operator";

export const operatorLogin = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        username: z.string().min(1),
        password: z.string().min(1),
        code: z.string().max(40).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { appSession } = await import("@/app/auth/session.server");
    const { clientIp, loginLocked, recordLogin, loginDelay } =
      await import("@/app/auth/login-guard.server");
    const { verifyOperator, operatorStamp } = await import("./credentials.server");
    const ip = clientIp();
    if (await loginLocked("operator", ip))
      throw new Error("Слишком много неудачных попыток. Попробуйте через 15 минут.");
    await loginDelay();
    const ok = await verifyOperator(data.username, data.password);
    if (!ok) {
      await recordLogin("operator", ip, false, data.username);
      return { ok: false as const };
    }
    // Двухшаговый вход: без кода сессии нет. Пустой код — не попытка, а
    // вопрос «нужен ли код»; неверный — неудача, копится в замок входа.
    const { verifySecondFactor } = await import("./two-factor.server");
    if (!(await verifySecondFactor(data.code))) {
      const tried = Boolean(data.code?.trim());
      if (tried) await recordLogin("operator", ip, false, data.username);
      return { ok: false as const, needCode: true as const, badCode: tried };
    }
    await recordLogin("operator", ip, true, data.username);
    const s = await appSession();
    const { operatorSessionMark } = await import("@/app/auth/session-id");
    await s.update({
      operator: true,
      operatorStamp: (await operatorStamp()) ?? undefined,
      ...operatorSessionMark(),
    });
    return { ok: true as const };
  });

export const operatorLogout = createServerFn({ method: "POST" }).handler(async () => {
  const { appSession } = await import("@/app/auth/session.server");
  const s = await appSession();
  // Сначала отзыв, потом стирание: скопированная cookie после выхода не работает.
  if (s.data.operatorSid) {
    const { revokeSession } = await import("@/app/auth/revocation.server");
    await revokeSession(s.data.operatorSid, s.data.operatorIat);
  }
  await s.update({
    operator: false,
    operatorStamp: undefined,
    operatorSid: undefined,
    operatorIat: undefined,
  });
  return { ok: true };
});

export const operatorCheck = createServerFn({ method: "GET" }).handler(async () => {
  try {
    await guard();
    return { authed: true };
  } catch {
    return { authed: false };
  }
});

/* ── учётка оператора ─────────────────────────────────────────────── */

export const operatorCredentialsFn = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  return (await import("./credentials.server")).operatorCredentialsSource();
});

export const setOperatorCredentialsFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        currentPassword: z.string().min(1),
        username: z.string().min(3).max(40),
        password: z.string().min(10).max(200),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    const { verifyOperator, operatorCredentialsSource, setOperatorCredentials } =
      await import("./credentials.server");
    const { username } = await operatorCredentialsSource();
    if (!username || !(await verifyOperator(username, data.currentPassword)))
      throw new Error("Текущий пароль неверный.");
    await setOperatorCredentials(data.username, data.password);
    // Все прежние сессии оператора погасли вместе со старым паролем; эта остаётся.
    const { appSession } = await import("@/app/auth/session.server");
    const { operatorStamp } = await import("./credentials.server");
    await (await appSession()).update({ operatorStamp: (await operatorStamp()) ?? undefined });
    return { ok: true };
  });

/* ── двухшаговый вход оператора (two-factor.server.ts) ────────────── */

const twoFactor = () => import("./two-factor.server");

/** Включение и выключение меняют отпечаток: прочие сессии гаснут, эта остаётся. */
const keepThisSession = async () => {
  const { appSession } = await import("@/app/auth/session.server");
  const { operatorStamp } = await import("./credentials.server");
  await (await appSession()).update({ operatorStamp: (await operatorStamp()) ?? undefined });
};

const otpCode = z.string().trim().min(6).max(40);

export const twoFactorStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  return (await twoFactor()).twoFactorStatus();
});

export const startTwoFactorFn = createServerFn({ method: "POST" }).handler(async () => {
  await guard();
  return (await twoFactor()).startTwoFactorSetup(await actor());
});

export const confirmTwoFactorFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ code: otpCode }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    const codes = await (await twoFactor()).confirmTwoFactorSetup(data.code);
    await keepThisSession();
    return { backupCodes: codes };
  });

/**
 * Действие по коду второго шага из настроек: неверный код — такая же
 * неудача входа, как на странице входа, и копится в общий замок.
 */
async function withSecondFactor<T>(run: () => Promise<T>): Promise<T> {
  const { clientIp, loginLocked, recordLogin } = await import("@/app/auth/login-guard.server");
  const ip = clientIp();
  if (await loginLocked("operator", ip))
    throw new Error("Слишком много неудачных попыток. Попробуйте через 15 минут.");
  try {
    return await run();
  } catch (e) {
    if (e instanceof (await twoFactor()).BadSecondFactor)
      await recordLogin("operator", ip, false, await actor());
    throw e;
  }
}

export const disableTwoFactorFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ code: otpCode }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    await withSecondFactor(async () => (await twoFactor()).disableTwoFactor(data.code));
    await keepThisSession();
    return { ok: true };
  });

export const regenerateBackupCodesFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ code: otpCode }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    return {
      backupCodes: await withSecondFactor(async () =>
        (await twoFactor()).regenerateBackupCodes(data.code),
      ),
    };
  });
