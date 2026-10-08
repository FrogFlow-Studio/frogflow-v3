import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Свои задачи продавца в «Что сделать сегодня» (app/admin/todos.server):
 * смотреть — любому сотруднику, кроме бухгалтера (блок ему не показывается),
 * добавлять и отмечать — менеджеру и выше.
 */
const guards = () => import("@/app/auth/guards.server");
const admin = async () => (await guards()).requireAdmin();
const adminWrite = async () => (await guards()).requireAdminRole("manager");
const me = async () => (await (await guards()).adminIdentity())?.username ?? null;
const server = () => import("./todos.server");
// Как в core/overview/seller-todos (TODO_ID, DAY, TODO_TEXT_MAX): модуль ядра в браузер не тянем.
const TODO_ID = /^[A-Za-z0-9_-]{8,64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TODO_TEXT_MAX = 300;

export const sellerTodosFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await admin();
  return (await server()).sellerTodos(ctx, await me());
});

export const addSellerTodoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().regex(TODO_ID),
        text: z.string().max(TODO_TEXT_MAX * 2),
        day: z.string().regex(DAY),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    return (await server()).addSellerTodo(ctx, { ...data, by: await me() });
  });

export const markSellerTodoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ id: z.string().regex(TODO_ID), done: z.boolean() }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    return (await server()).markSellerTodo(ctx, data.id, data.done, await me());
  });

export const removeSellerTodoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string().regex(TODO_ID) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    return (await server()).removeSellerTodo(ctx, data.id);
  });
