import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";

// Серверные функции — same-origin RPC; чужой сайт не должен их дёргать
// cookie-сессией продавца или оператора.
const csrf = createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" });

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

export const startInstance = createStart(() => ({
  requestMiddleware: [csrf],
  functionMiddleware: [userErrors],
}));
