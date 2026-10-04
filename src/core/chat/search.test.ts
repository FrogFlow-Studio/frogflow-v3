import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { ServerFailure } from "@/lib/server-failure";
import { likePattern, searchMessages, snippetOf } from "./search";

const BOT = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const T0 = Date.UTC(2026, 0, 1);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function setup() {
  const db = fakeDb({ maxRows: 1000 });
  // 2400 сообщений по 4 на секунду; «размер 42» — в трёх из них, в том числе из 2-й тысячи.
  db.tables.manager_chat_messages = Array.from({ length: 2400 }, (_, i) => ({
    id: id(i),
    bot_id: BOT,
    telegram_id: 1 + (i % 3),
    direction: "in",
    sender: "customer",
    text: [300, 1500, 2300].includes(i) ? `Нужен размер 42, есть? (${i})` : `Сообщение ${i}`,
    created_at: new Date(T0 + Math.floor(i / 4) * 1000).toISOString(),
  }));
  // Чужой магазин пишет то же самое.
  db.tables.manager_chat_messages.push({
    id: id(9000),
    bot_id: OTHER,
    telegram_id: 1,
    direction: "in",
    sender: "customer",
    text: "размер 42 у чужого магазина",
    created_at: new Date(T0 + 5_000_000).toISOString(),
  });
  db.tables.bot_users = [
    {
      bot_id: BOT,
      telegram_id: 1,
      first_name: "Аня",
      last_name: "К",
      username: null,
      platform: "telegram",
    },
    {
      bot_id: BOT,
      telegram_id: 2,
      first_name: null,
      last_name: null,
      username: "boris",
      platform: "instagram",
    },
    { bot_id: OTHER, telegram_id: 1, first_name: "Чужая", username: null, platform: "telegram" },
  ];
  return { ctx: { tenant: { id: BOT }, db } as unknown as TenantContext, db };
}

describe("поиск по тексту переписки", () => {
  it("находит и во 2-й тысяче, свежие сверху, с именем покупателя; чужой магазин не находится", async () => {
    const { ctx } = setup();
    const r = await searchMessages(ctx, "размер 42");
    expect(r.hasMore).toBe(false);
    expect(r.hits.map((h) => h.id)).toEqual([id(2300), id(1500), id(300)]);
    expect(r.hits.map((h) => h.name)).toEqual(["id 3", "Аня К", "Аня К"]);
    expect(r.hits.some((h) => h.snippet.includes("чужого"))).toBe(false);
  });

  it("страницы по курсору: ничего не теряется и не повторяется при одинаковом времени", async () => {
    const { ctx, db } = setup();
    // 45 находок, по 4 на одну секунду.
    for (let i = 0; i < 45; i++) db.tables.manager_chat_messages![i]!.text = `оплата ${i}`;
    const seen: string[] = [];
    let before = null as { created_at: string; id: string } | null;
    let pages = 0;
    for (;;) {
      const r = await searchMessages(ctx, "оплата", { before });
      pages++;
      seen.push(...r.hits.map((h) => h.id));
      if (!r.hasMore) break;
      const last = r.hits[r.hits.length - 1]!;
      before = { created_at: last.createdAt, id: last.id };
    }
    expect(pages).toBe(3);
    expect(seen).toHaveLength(45);
    expect(new Set(seen).size).toBe(45);
    expect(seen).toEqual(Array.from({ length: 45 }, (_, i) => id(44 - i)));
  });

  it("«%» и «_» в запросе — буквы; короткий запрос — пусто, а не всё", async () => {
    const { ctx, db } = setup();
    db.tables.manager_chat_messages![5]!.text = "скидка 50% на всё";
    expect((await searchMessages(ctx, "50%")).hits.map((h) => h.id)).toEqual([id(5)]);
    expect((await searchMessages(ctx, "%")).hits).toEqual([]);
    expect((await searchMessages(ctx, " а ")).hits).toEqual([]);
    expect(likePattern("a_b%c\\")).toBe("%a\\_b\\%c\\\\%");
  });

  it("сбой базы — ServerFailure, а не «ничего не нашли»", async () => {
    const broken: unknown = new Proxy(() => undefined, {
      get: (_t, prop) =>
        prop === "then"
          ? (ok: (v: unknown) => unknown) => ok({ data: null, error: { message: "boom" } })
          : () => broken,
    });
    const ctx = { tenant: { id: BOT }, db: { from: () => broken } } as unknown as TenantContext;
    await expect(searchMessages(ctx, "размер")).rejects.toBeInstanceOf(ServerFailure);
  });

  it("кусок текста вокруг найденного, без разметки", () => {
    expect(snippetOf("<b>Привет</b>, нужен размер 42", "размер")).toBe("Привет, нужен размер 42");
    const long = `${"а".repeat(200)} размер 42 ${"б".repeat(200)}`;
    const s = snippetOf(long, "размер 42");
    expect(s.startsWith("…")).toBe(true);
    expect(s.endsWith("…")).toBe(true);
    expect(s).toContain("размер 42");
    expect(s.length).toBeLessThan(130);
  });
});
