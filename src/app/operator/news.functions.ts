import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Серверные функции панели оператора: новости платформы.
 * Каждая начинается с requireOperator():
 * маршрутный гейт — только UX, функции вызываются по HTTP напрямую.
 * Реализация — в серверных модулях *.server.ts (не попадают в бандл).
 */
const guard = async () => (await import("@/app/auth/guards.server")).requireOperator();

/** Кто действует — логин оператора из базы; в журнале bot_events. */
const actor = async () =>
  (await (await import("./credentials.server")).operatorCredentialsSource()).username ?? "operator";

/* ── новости платформы ────────────────────────────────────────────── */

const newsImpl = () => import("./news.server");

const newsText = z.object({
  ru: z.string().max(10_000),
  kk: z.string().max(10_000).optional(),
  en: z.string().max(10_000).optional(),
  uz: z.string().max(10_000).optional(),
});

/** Все новости, включая черновики и архив; null — раздел выключен (нет таблиц). */
export const newsListFn = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  return (await newsImpl()).listNews();
});

export const saveNewsFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().nullable(),
        title: newsText,
        body: newsText,
        plans: z.array(z.enum(["basic", "pro", "business", "custom"])).max(4),
        action: z
          .discriminatedUnion("kind", [
            z.object({ kind: z.literal("module"), module: z.string().max(60) }),
            z.object({ kind: z.literal("link"), path: z.string().max(200) }),
          ])
          .nullable()
          .default(null),
        pollOptions: newsText.partial().default({}),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    return (await newsImpl()).saveNews(data.id, data, await actor());
  });

export const newsStateFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({ id: z.string().uuid(), action: z.enum(["publish", "archive", "unarchive"]) })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    return { changed: await (await newsImpl()).setNewsState(data.id, data.action) };
  });
