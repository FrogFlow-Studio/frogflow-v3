import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import { KNOWLEDGE_KEY, DEFAULT_KNOWLEDGE_ARTICLES } from "@/core/consultant/pricelist/knowledge";
import type { Tenant } from "@/core/tenant/types";

const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
let failTable: string | null = null;

vi.mock("@/core/db/client.server", () => ({ serviceDb: () => withFailure(db) }));
// Арендатор клиента: его db видит только свои строки (как роль арендатора с RLS).
let servedBy = "v2";
vi.mock("@/core/tenant/resolve.server", () => ({
  requireTenant: async ({ value }: { value: string }) =>
    ({ id: value, settings: { served_by: servedBy } }) as unknown as Tenant,
  tenantContext: (t: { id: string }) => ({ tenant: t, db: scoped(t.id) }),
}));
const logged: unknown[] = [];
vi.mock("./operator.server", () => ({
  logEvent: async (...args: unknown[]) => void logged.push(args),
}));

/** База, у которой чтение таблицы `failTable` отвечает ошибкой PostgREST. */
function withFailure(real: typeof db): typeof db {
  const failing = (): unknown =>
    new Proxy(
      {},
      {
        get: (_t, prop) =>
          prop === "then"
            ? (ok: (r: unknown) => unknown) =>
                ok({ data: null, error: { message: 'relation "x" timeout' } })
            : () => failing(),
      },
    );
  return new Proxy(real, {
    get: (t, prop) =>
      prop === "from"
        ? (table: string) => (table === failTable ? failing() : t.from(table))
        : Reflect.get(t, prop),
  });
}

/** Вид базы «только свои строки»: `app_settings` одного клиента, как под RLS. */
function scoped(botId: string): typeof db {
  return new Proxy(db, {
    get: (t, prop) =>
      prop === "from"
        ? (table: string) => {
            const q = t.from(table);
            return table === "app_settings" ? q.eq("bot_id", botId) : q;
          }
        : Reflect.get(t, prop),
  }) as typeof db;
}

const { listKnowledgeSources, importKnowledgeFrom } = await import("./knowledge-import.server");
const { ServerFailure } = await import("@/lib/server-failure");

const OWN = "00000000-0000-4000-8000-00000000000a";
const SRC = "00000000-0000-4000-8000-00000000000b";

type Article = { id: string; title: string; tags: string[]; content: string; updatedAt: string };
const art = (n: number): Article => ({
  id: `kb-${n}`,
  title: `Статья ${n}`,
  tags: ["тег"],
  content: `Текст статьи ${n}`,
  updatedAt: "2026-01-01T00:00:00.000Z",
});

function setup(rows: Array<{ bot_id: string; articles: unknown; updated_at?: string }>) {
  failTable = null;
  servedBy = "v2";
  logged.length = 0;
  db.tables.bots = [
    { id: OWN, bot_name: "BOVI", owner_id: "o1", archived_at: null },
    { id: SRC, bot_name: "BOVI (старый bot_id)", owner_id: "o1", archived_at: null },
  ];
  db.tables.app_settings = rows.map((r) => ({
    bot_id: r.bot_id,
    key: KNOWLEDGE_KEY,
    value: typeof r.articles === "string" ? r.articles : JSON.stringify(r.articles),
    updated_at: r.updated_at ?? "2026-02-01T00:00:00.000Z",
  }));
}

describe("список строк базы знаний консультанта у оператора", () => {
  it("своя строка и чужая: у клиента только стандартные, у источника 16 статей и 5 заголовков", async () => {
    const source = Array.from({ length: 16 }, (_, i) => art(i + 1));
    setup([{ bot_id: SRC, articles: source }]);
    const r = await listKnowledgeSources(OWN);
    expect(r.own).toBeNull();
    expect(r.defaults).toBe(true);
    expect(r.current).toBe(DEFAULT_KNOWLEDGE_ARTICLES.length);
    expect(r.others).toHaveLength(1);
    const s = r.others[0]!;
    expect(s).toMatchObject({ botId: SRC, botName: "BOVI (старый bot_id)", articles: 16 });
    expect(s.titles).toEqual(["Статья 1", "Статья 2", "Статья 3", "Статья 4", "Статья 5"]);
    // Содержимое статей наружу не уходит.
    expect(JSON.stringify(r)).not.toContain("Текст статьи");
  });

  it("строка клиента есть — считается она, чужие строки в others", async () => {
    setup([
      { bot_id: OWN, articles: [art(1), art(2)] },
      { bot_id: SRC, articles: [art(3)] },
    ]);
    const r = await listKnowledgeSources(OWN);
    expect(r.defaults).toBe(false);
    expect(r.current).toBe(2);
    expect(r.own).toMatchObject({ own: true, articles: 2 });
    expect(r.others.map((s) => s.botId)).toEqual([SRC]);
  });

  it("испорченное значение — broken, а не 0 без признака", async () => {
    setup([{ bot_id: SRC, articles: "{не json" }]);
    const r = await listKnowledgeSources(OWN);
    expect(r.others[0]).toMatchObject({ broken: true, articles: 0, titles: [] });
  });

  it("строки больше страницы читаются постранично — не обрезаются", async () => {
    setup([]);
    const many = Array.from({ length: 1200 }, (_, i) => ({
      bot_id: `bot-${String(i).padStart(5, "0")}`,
      key: KNOWLEDGE_KEY,
      value: JSON.stringify([art(1)]),
      updated_at: "2026-02-01T00:00:00.000Z",
    }));
    db.tables.app_settings = many;
    const saved = db.maxRows;
    db.maxRows = 1000;
    try {
      const r = await listKnowledgeSources(OWN);
      expect(r.others).toHaveLength(1200);
    } finally {
      db.maxRows = saved;
    }
  });

  it("сбой чтения строк — ServerFailure, а не пустой список", async () => {
    setup([{ bot_id: SRC, articles: [art(1)] }]);
    failTable = "app_settings";
    await expect(listKnowledgeSources(OWN)).rejects.toBeInstanceOf(ServerFailure);
  });

  it("сбой чтения клиентов — ServerFailure, а не строки без имён", async () => {
    setup([{ bot_id: SRC, articles: [art(1)] }]);
    failTable = "bots";
    await expect(listKnowledgeSources(OWN)).rejects.toBeInstanceOf(ServerFailure);
  });
});

describe("перенос статей из чужой строки в клиента", () => {
  it("статьи дописываются, источник не меняется, повтор не плодит дублей", async () => {
    const source = Array.from({ length: 16 }, (_, i) => art(i + 1));
    setup([{ bot_id: SRC, articles: source }]);
    const before = db.tables.app_settings!.find((r) => r.bot_id === SRC)!;
    const sourceValue = before.value;
    const sourceStamp = before.updated_at;

    const first = await importKnowledgeFrom(OWN, SRC, "operator1");
    expect(first.added).toBe(16);
    expect(first.updated).toBe(0);
    // У клиента не было своей строки: консультант отвечал по стандартным — они и остаются.
    expect(first.total).toBe(DEFAULT_KNOWLEDGE_ARTICLES.length + 16);
    const own = db.tables.app_settings!.find((r) => r.bot_id === OWN)!;
    expect(JSON.parse(String(own.value))).toHaveLength(first.total);

    const second = await importKnowledgeFrom(OWN, SRC, "operator1");
    expect(second).toMatchObject({ added: 0, updated: 16, total: first.total });
    const after = db.tables.app_settings!.find((r) => r.bot_id === OWN)!;
    const titles = (JSON.parse(String(after.value)) as Article[]).map((a) => a.title);
    expect(new Set(titles).size).toBe(titles.length);

    // Строка-источник не тронута: ни значение, ни метка времени.
    const src = db.tables.app_settings!.find((r) => r.bot_id === SRC)!;
    expect(src.value).toBe(sourceValue);
    expect(src.updated_at).toBe(sourceStamp);

    // Перенос виден в журнале клиента.
    expect(logged).toHaveLength(2);
    expect(logged[0]).toMatchObject([
      OWN,
      "meta",
      { consultant_knowledge_imported: 16, from_bot_id: SRC },
      "operator1",
    ]);
  });

  it("свои статьи клиента остаются, одинаковый заголовок обновляется текстом источника", async () => {
    setup([
      { bot_id: OWN, articles: [{ ...art(1), content: "старый текст" }, art(99)] },
      { bot_id: SRC, articles: [{ ...art(1), content: "новый текст" }] },
    ]);
    const r = await importKnowledgeFrom(OWN, SRC);
    expect(r).toMatchObject({ added: 0, updated: 1, total: 2 });
    const own = JSON.parse(
      String(db.tables.app_settings!.find((x) => x.bot_id === OWN)!.value),
    ) as Article[];
    expect(own.map((a) => a.title)).toEqual(["Статья 1", "Статья 99"]);
    expect(own[0]!.content).toBe("новый текст");
    expect(own[0]!.id).toBe("kb-1");
  });

  it("больше 200 статей — ошибка, а не молчаливая обрезка; база клиента не меняется", async () => {
    const own = Array.from({ length: 190 }, (_, i) => art(i + 1));
    setup([
      { bot_id: OWN, articles: own },
      { bot_id: SRC, articles: Array.from({ length: 30 }, (_, i) => art(500 + i)) },
    ]);
    await expect(importKnowledgeFrom(OWN, SRC)).rejects.toThrow();
    const row = db.tables.app_settings!.find((x) => x.bot_id === OWN)!;
    expect(JSON.parse(String(row.value))).toHaveLength(190);
    expect(logged).toHaveLength(0);
  });

  it("сбой чтения источника — ServerFailure, статьи клиента не затираются", async () => {
    setup([
      { bot_id: OWN, articles: [art(1)] },
      { bot_id: SRC, articles: [art(2)] },
    ]);
    failTable = "app_settings";
    await expect(importKnowledgeFrom(OWN, SRC)).rejects.toBeInstanceOf(ServerFailure);
    failTable = null;
    expect(
      JSON.parse(String(db.tables.app_settings!.find((x) => x.bot_id === OWN)!.value)),
    ).toHaveLength(1);
  });

  it("у источника нет строки — понятная ошибка, перенос не идёт", async () => {
    setup([{ bot_id: OWN, articles: [art(1)] }]);
    await expect(importKnowledgeFrom(OWN, SRC)).rejects.toThrow(/нет строки/);
  });

  it("строка источника без статей с текстом — отказ, а не пустой перенос", async () => {
    setup([{ bot_id: SRC, articles: [{ id: "x", title: "", tags: [], content: "" }] }]);
    await expect(importKnowledgeFrom(OWN, SRC)).rejects.toThrow(/нет статей/);
  });

  it("клиент ещё на v1 — перенос отказывает: его строку читает прежняя платформа", async () => {
    setup([
      { bot_id: OWN, articles: [art(1)] },
      { bot_id: SRC, articles: [art(2)] },
    ]);
    servedBy = "v1";
    await expect(importKnowledgeFrom(OWN, SRC)).rejects.toThrow(/прежней платформе/);
    expect(
      JSON.parse(String(db.tables.app_settings!.find((x) => x.bot_id === OWN)!.value)),
    ).toHaveLength(1);
    expect(logged).toHaveLength(0);
  });

  it("сам себе переносить нечего", async () => {
    setup([{ bot_id: OWN, articles: [art(1)] }]);
    await expect(importKnowledgeFrom(OWN, OWN)).rejects.toThrow();
  });
});
