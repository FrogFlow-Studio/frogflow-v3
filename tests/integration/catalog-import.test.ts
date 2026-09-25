import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveReady, DEMO_BOT } from "./live";
import { serviceDb } from "@/core/db/client.server";
import { requireTenant, tenantContext, type TenantContext } from "@/core/tenant/resolve.server";
import { applyImport, previewImport } from "@/core/catalog/import.server";
import { productsCsv } from "@/core/export/export";
import { parseCatalogCsv } from "@/core/catalog/import";

/** Импорт каталога на демо-клиенте: создать, обновить по названию и по id, категория по имени, выгрузка обратно. */
const P1 = "v2 import · Курс А";
// После переименования по id товар всё ещё под маской очистки: имя начинается с «v2 import ·».
const P2 = "v2 import · Курс Б";
const CAT = "v2 import · Раздел";
let ctx: TenantContext;

async function cleanup() {
  const db = serviceDb();
  await db.from("products").delete().eq("bot_id", DEMO_BOT).like("name", "v2 import ·%");
  await db.from("categories").delete().eq("bot_id", DEMO_BOT).eq("name", CAT);
}

describe.skipIf(!liveReady)("импорт и выгрузка каталога", () => {
  beforeAll(async () => {
    ctx = tenantContext(await requireTenant({ by: "id", value: DEMO_BOT }));
    await cleanup();
  });
  afterAll(cleanup);

  it("предпросмотр считает, применение создаёт товары и категорию", async () => {
    const csv = `Название;Цена;Категория;В продаже;Ссылка\n${P1};1 500;${CAT};да;https://example.com/a.pdf\n${P2};2000,50;;нет;\nБез цены;дорого;;;`;
    const preview = await previewImport(ctx, csv);
    expect(preview).toMatchObject({ ok: true, create: 2, update: 0, newCategories: [CAT] });
    expect(preview.errors.map((e) => e.line)).toEqual([4]);
    const r = await applyImport(ctx, csv);
    expect(r).toMatchObject({ created: 2, updated: 0, categoriesCreated: 1 });
    const { data: rows } = await ctx.db
      .from("products")
      .select("name, price, is_active, file_url, category_ids")
      .like("name", "v2 import ·%")
      .order("name");
    expect(rows?.map((p) => [p.name, Number(p.price), p.is_active, p.file_url])).toEqual([
      [P1, 1500, true, "https://example.com/a.pdf"],
      [P2, 2000.5, false, null],
    ]);
    const { data: cat } = await ctx.db.from("categories").select("id").eq("name", CAT).single();
    expect(rows?.[0]?.category_ids).toEqual([cat!.id]);
  });

  it("повторный импорт обновляет по названию только присланные поля; выгрузка читается импортом", async () => {
    const r = await applyImport(ctx, `Название;Цена\n${P1.toUpperCase()};1700`);
    expect(r).toMatchObject({ created: 0, updated: 1, categoriesCreated: 0 });
    const { data: p } = await ctx.db
      .from("products")
      .select("id, price, file_url, is_active")
      .eq("name", P1)
      .single();
    expect(Number(p!.price)).toBe(1700);
    expect(p!.file_url).toBe("https://example.com/a.pdf"); // не тронуто
    // Выгрузка — в формате импорта, с id; правим цену по id.
    const out = await productsCsv(ctx);
    const parsed = parseCatalogCsv(out.csv);
    const mine = parsed.drafts.find((d) => d.name === P1)!;
    expect(mine.id).toBe(p!.id);
    expect(mine.price).toBe(1700);
    expect(mine.category).toBe(CAT);
    const r2 = await applyImport(
      ctx,
      `id;Название;Цена;В продаже\n${p!.id};v2 import · переименован;1800;нет`,
    );
    expect(r2.updated).toBe(1);
    const { data: p2 } = await ctx.db
      .from("products")
      .select("name, price, is_active")
      .eq("id", p!.id)
      .single();
    expect([p2!.name, Number(p2!.price), p2!.is_active]).toEqual([
      "v2 import · переименован",
      1800,
      false,
    ]);
  });
});
