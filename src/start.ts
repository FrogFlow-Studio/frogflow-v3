import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";

// Серверные функции — same-origin RPC; чужой сайт не должен их дёргать
// cookie-сессией продавца или оператора.
const csrf = createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" });

// Журнал действий в админке (core/audit/admin-audit): после успешной
// серверной функции админки — кто из команды и что поменял. Ошибка записи
// журнала действие не отменяет.
const adminAudit = createMiddleware({ type: "function" }).server(async (call) => {
  const { auditAdminCall } = await import("@/app/admin/audit-call");
  return auditAdminCall(call, {
    identity: async () => (await import("@/app/auth/guards.server")).adminIdentity(),
    record: async (who, action, data) =>
      (await import("@/app/admin/audit.server")).recordShopAction(who, action, data),
  });
});

// Ошибка для человека (UserError) из ядра или панели уходит продавцу на языке
// его админки. Нет сессии продавца (оператор, вход) — русский текст как есть.
const userErrors = createMiddleware({ type: "function" }).server(async ({ next }) => {
  try {
    return await next();
  } catch (e) {
    const { isUserError } = await import("@/core/i18n/user-error");
    if (!isUserError(e)) throw e;
    const { translateForAdmin } = await import("@/app/admin/errors.server");
    throw new Error(await translateForAdmin(e));
  }
});

// Сбои серверных функций админки и панели оператора — в Sentry (lib/errors);
// отказы человеку (UserError, неверный ввод, нет сессии) туда не идут.
const failureReport = createMiddleware({ type: "function" }).server(async (call) => {
  const { reportServerFnFailure } = await import("@/lib/server-fn-errors");
  return reportServerFnFailure(call, {
    botId: async () =>
      (await (await import("@/app/auth/guards.server")).adminIdentity())?.botId ?? null,
  });
});

export const startInstance = createStart(() => ({
  requestMiddleware: [csrf],
  // Порядок — снаружи внутрь. Учёт сбоев внутри перевода: видит исходную
  // ошибку (UserError), а не переведённый на английский текст. Журнал
  // внутри перевода ошибок: отказ не пишется, текст переводится.
  functionMiddleware: [userErrors, failureReport, adminAudit],
}));
