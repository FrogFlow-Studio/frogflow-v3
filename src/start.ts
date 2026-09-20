import { createCsrfMiddleware, createStart } from "@tanstack/react-start";

// Серверные функции — same-origin RPC; чужой сайт не должен их дёргать
// cookie-сессией продавца или оператора.
const csrf = createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" });

export const startInstance = createStart(() => ({ requestMiddleware: [csrf] }));
