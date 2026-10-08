import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { settingsFromJson } from "@/core/tenant/directory";

const removed: string[][] = [];
/** Записи в bots.settings — через patchTenantSettings; здесь их видно и они возвращаются в контекст. */
const patches: Array<{ botId: string; patch: Record<string, unknown> }> = [];
vi.mock("@/core/tenant/resolve.server", async (orig) => ({
  ...(await orig<typeof import("@/core/tenant/resolve.server")>()),
  patchTenantSettings: async (botId: string, patch: Record<string, unknown>) => {
    patches.push({ botId, patch });
  },
}));
vi.mock("@/core/db/client.server", () => ({
  serviceDb: () => ({
    storage: {
      from: () => ({
        remove: async (keys: string[]) => {
          removed.push(keys);
          return { data: null, error: null };
        },
      }),
    },
  }),
}));

const {
  addKnowledgeArticles,
  addProductMedia,
  clearConsultantTasks,
  consultantTasks,
  markConsultantTask,
  savePricelistPersona,
  deleteProductMedia,
  importPricelist,
  importPricelistSheetFor,
  previewKnowledgeImport,
  previewPricelistSheetFor,
  pricelistOverview,
  deletePricelistArticle,
  savePricelistArticle,
  savePricelistArticles,
  savePricelistSettings,
  setManualRate,
} = await import("./pricelist.server");
const { addTask } = await import("@/core/consultant/tasks");
const { PRODUCT_MEDIA_KEY } = await import("@/core/consultant/pricelist/media");
const { DEFAULT_PERSONA } = await import("@/core/consultant/pricelist/persona");

/**
 * «Прайс консультанта» в админке (перенос панели BOVI v1): выгрузка 1С,
 * синонимы и бутик, ручной курс, фотобаза, статьи. Только при включённом
 * операторе режиме «по прайсу».
 */
let n = 0;
function ctxOf(on = true, extra: Record<string, unknown> = {}): TenantContext {
  const id = `10000000-0000-0000-0000-${String(++n).padStart(12, "0")}`;
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [];
  return {
    tenant: {
      id,
      name: "BOVI",
      settings: settingsFromJson(on ? { consultant_pricelist: { enabled: true, ...extra } } : {}),
      modules: {},
      vertical: "consultant",
    },
    db,
    appUrl: "https://app.test",
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
}

/** Чтение строки фотобазы отвечает ошибкой базы, пока не вызвали off(). */
function breakMediaReads(ctx: TenantContext) {
  let on = true;
  const db = ctx.db as unknown as { from: (t: string) => Record<string, unknown> };
  const from = db.from.bind(db);
  db.from = (table: string) => {
    const q = from(table) as Record<string, (...a: unknown[]) => unknown>;
    if (table !== "app_settings") return q;
    const eqOrig = q.eq!.bind(q);
    const inOrig = q.in!.bind(q);
    q.eq = (col: unknown, v: unknown) => {
      if (on && v === PRODUCT_MEDIA_KEY)
        return { maybeSingle: async () => ({ data: null, error: { message: "timeout" } }) };
      return eqOrig(col, v);
    };
    q.in = (col: unknown, vs: unknown) => {
      if (on && (vs as string[]).includes(PRODUCT_MEDIA_KEY))
        return Promise.resolve({ data: null, error: { message: "timeout" } });
      return inOrig(col, vs);
    };
    return q;
  };
  return { off: () => (on = false) };
}

const CSV = [
  "Номенклатура;;;;;Розничная;;",
  ";;;;;Цена;;Остаток",
  "Aquanova (Бельгия);;;;;;;",
  "Коврики;;;;;;;",
  "Aquanova Коврик в ванную LONDON 60x100, цвет 43 белый;;;;;47,000   KZT;;1",
  "Uchino (Япония);;;;;;;",
  "Полотенца;;;;;;;",
  "Uchino Полотенце махровое Zero Twist 70x140, белый;;;;;21,000   KZT;;4",
].join("\n");

describe("прайс консультанта в админке", () => {
  it("магазину без режима по прайсу страница закрыта", async () => {
    await expect(pricelistOverview(ctxOf(false))).rejects.toMatchObject({
      key: "err.pricelist.off",
    });
  });

  it("выгрузка 1С заменяет прайс, сводка — продавцу", async () => {
    const ctx = ctxOf();
    const r = await importPricelist(ctx, CSV, "остатки.csv");
    expect(r.meta).toMatchObject({ count: 2, source: "остатки.csv" });
    const o = await pricelistOverview(ctx);
    expect(o.count).toBe(2);
    expect(o.meta?.count).toBe(2);
  });

  it("файл без позиций прайс не стирает", async () => {
    const ctx = ctxOf();
    await importPricelist(ctx, CSV, "a.csv");
    await expect(importPricelist(ctx, "просто текст", "b.csv")).rejects.toMatchObject({
      key: "err.pricelist.empty",
    });
    expect((await pricelistOverview(ctx)).count).toBe(2);
  });

  it("синонимы, сайт и бутик сохраняются; сайт только https", async () => {
    const ctx = ctxOf();
    await savePricelistSettings(ctx, {
      synonyms: "pip, голландские, голландия\n\nuchino, японские",
      shopUrl: "https://bovi.kz",
      store: { address: "Сатпаева, 3", phone: "+7 777 333 08 08", hours: "10–22" },
    });
    const o = await pricelistOverview(ctx);
    expect(o.synonyms).toBe("pip, голландские, голландия\nuchino, японские");
    expect(o.store.address).toBe("Сатпаева, 3");
    await expect(
      savePricelistSettings(ctx, {
        synonyms: "",
        shopUrl: "javascript:alert(1)",
        store: o.store,
      }),
    ).rejects.toMatchObject({ key: "err.pricelist.badUrl" });
  });

  it("курс вручную — в коридоре правдоподобия", async () => {
    const ctx = ctxOf();
    await setManualRate(ctx, 4.79);
    const o = await pricelistOverview(ctx);
    expect(o.rate).toMatchObject({ rate: 4.79, source: "введён вручную", fresh: true });
    await expect(setManualRate(ctx, 479)).rejects.toMatchObject({ key: "err.pricelist.badRate" });
  });

  it("фото в фотобазу — только файл, выданный этому магазину; удаление убирает и файл", async () => {
    const ctx = ctxOf();
    const key = `${ctx.tenant.id}/0123456789abcdef01234567.jpg`;
    const m = await addProductMedia(ctx, { key, match: "Uchino Zero Twist", color: "белый" });
    expect(m).toMatchObject({ kind: "image", match: "Uchino Zero Twist", color: "белый" });
    const video = await addProductMedia(ctx, {
      key: `${ctx.tenant.id}/0123456789abcdef0123456a.mp4`,
      match: "Uchino Zero Twist",
    });
    expect(video.kind).toBe("video");
    const o = await pricelistOverview(ctx);
    expect(o.media).toHaveLength(2);
    expect(o.media[0]!.url).toMatch(new RegExp(`^https://app\\.test/api/img/${ctx.tenant.id}/`));

    await expect(
      addProductMedia(ctx, { key: "other-bot/0123456789abcdef01234567.jpg", match: "x" }),
    ).rejects.toMatchObject({ key: "err.pricelist.badFile" });

    await deleteProductMedia(ctx, m.id);
    expect((await pricelistOverview(ctx)).media).toHaveLength(1);
    expect(removed.at(-1)).toEqual([key]);
  });

  it("сбой чтения базы при загрузке и удалении фото не стирает фотобазу", async () => {
    const ctx = ctxOf();
    const key = `${ctx.tenant.id}/0123456789abcdef01234567.jpg`;
    const m = await addProductMedia(ctx, { key, match: "Uchino Zero Twist" });
    const broken = breakMediaReads(ctx);
    await expect(
      addProductMedia(ctx, { key: `${ctx.tenant.id}/0123456789abcdef0123456b.jpg`, match: "Aquanova" }),
    ).rejects.toThrow();
    await expect(deleteProductMedia(ctx, m.id)).rejects.toThrow();
    await expect(pricelistOverview(ctx)).rejects.toThrow();
    broken.off();
    const o = await pricelistOverview(ctx);
    expect(o.media.map((x) => x.id)).toEqual([m.id]);
  });

  it("две загрузки фото одновременно: в фотобазе оба", async () => {
    const ctx = ctxOf();
    await Promise.all(
      ["0123456789abcdef01234567", "0123456789abcdef0123456b", "0123456789abcdef0123456c"].map(
        (k) => addProductMedia(ctx, { key: `${ctx.tenant.id}/${k}.jpg`, match: "Uchino" }),
      ),
    );
    expect((await pricelistOverview(ctx)).media).toHaveLength(3);
  });

  it("рабочие часы консультанта: по умолчанию BOVI, свои пишутся в настройки, кривые отклоняются", async () => {
    const ctx = ctxOf();
    patches.length = 0;
    const o = await pricelistOverview(ctx);
    expect(o.hours).toEqual({ open: 10, close: 21 });
    // Те же часы, что сейчас, настройку не пишут.
    await savePricelistSettings(ctx, {
      synonyms: "",
      shopUrl: "",
      store: o.store,
      hours: { open: 10, close: 21 },
    });
    expect(patches).toEqual([]);
    await savePricelistSettings(ctx, {
      synonyms: "",
      shopUrl: "",
      store: o.store,
      hours: { open: 9, close: 20 },
    });
    expect(patches).toEqual([
      { botId: ctx.tenant.id, patch: { consultant_pricelist: { hours: { open: 9, close: 20 } } } },
    ]);
    for (const hours of [
      { open: 10, close: 10 },
      { open: 25, close: 3 },
      { open: 1, close: 0 },
    ])
      await expect(
        savePricelistSettings(ctx, { synonyms: "", shopUrl: "", store: o.store, hours }),
      ).rejects.toMatchObject({ key: "err.pricelist.badHours" });
    // Часы магазина читаются из настроек клиента.
    expect((await pricelistOverview(ctxOf(true, { hours: { open: 9, close: 20 } }))).hours).toEqual(
      {
        open: 9,
        close: 20,
      },
    );
  });

  it("образ консультанта: по умолчанию текст BOVI, свой пишется, стандартный убирает настройку", async () => {
    const ctx = ctxOf();
    patches.length = 0;
    const o = await pricelistOverview(ctx);
    expect(o.persona).toEqual(DEFAULT_PERSONA);
    expect(o.personaCustom).toBe(false);
    expect(await savePricelistPersona(ctx, DEFAULT_PERSONA)).toEqual({ custom: false });
    expect(patches.at(-1)!.patch).toEqual({ consultant_pricelist: { persona: null } });
    expect(
      await savePricelistPersona(ctx, {
        brand: "Хлопок",
        about: "Детский текстиль.",
        tone: "Тепло.",
        specialities: "",
      }),
    ).toEqual({ custom: true });
    expect(patches.at(-1)!.patch).toEqual({
      consultant_pricelist: {
        persona: { brand: "Хлопок", about: "Детский текстиль.", tone: "Тепло.", specialities: "" },
      },
    });
    await expect(
      savePricelistPersona(ctx, { brand: " ", about: "", tone: "", specialities: "" }),
    ).rejects.toMatchObject({ key: "err.pricelist.noBrand" });
    // Свой образ показывается как свой.
    const saved = await pricelistOverview(
      ctxOf(true, { persona: { brand: "Хлопок", about: "", tone: "", specialities: "" } }),
    );
    expect(saved.personaCustom).toBe(true);
    expect(saved.persona.brand).toBe("Хлопок");
  });

  it("задачи консультанта: список, отметка, очистка сделанных, чужой id — ошибка", async () => {
    const ctx = ctxOf();
    const a = await addTask(ctx, { userKey: "ig:1", reason: "purchase", text: "Берёт полотенце" });
    await addTask(ctx, { userKey: "ig:2", reason: "complaint", text: "Затяжка" });
    const list = await consultantTasks(ctx);
    expect(list.open).toBe(2);
    expect(list.tasks.map((t) => t.reason)).toContain("purchase");
    await markConsultantTask(ctx, a!.id, true);
    expect((await consultantTasks(ctx)).open).toBe(1);
    await expect(markConsultantTask(ctx, "tsk_нет", true)).rejects.toMatchObject({
      key: "err.pricelist.noTask",
    });
    expect(await clearConsultantTasks(ctx, "done")).toEqual({ removed: 1 });
    expect((await consultantTasks(ctx)).tasks.map((t) => t.userKey)).toEqual(["ig:2"]);
    expect(await clearConsultantTasks(ctx, "all")).toEqual({ removed: 1 });
    expect((await consultantTasks(ctx)).tasks).toEqual([]);
  });

  it("задачи и образ закрыты магазину без режима по прайсу", async () => {
    const off = ctxOf(false);
    await expect(consultantTasks(off)).rejects.toMatchObject({ key: "err.pricelist.off" });
    await expect(clearConsultantTasks(off, "all")).rejects.toMatchObject({
      key: "err.pricelist.off",
    });
    await expect(savePricelistPersona(off, null)).rejects.toMatchObject({
      key: "err.pricelist.off",
    });
  });

  it("статьи базы знаний: пустые отбрасываются", async () => {
    const ctx = ctxOf();
    const r = await savePricelistArticles(ctx, [
      { title: "Uchino", content: "Японская марка, махра из хлопка." },
      { title: "", content: "без заголовка" },
    ]);
    expect(r.count).toBe(1);
    const o = await pricelistOverview(ctx);
    expect(o.articles.map((a) => a.title)).toEqual(["Uchino"]);
  });

  it("правка одной статьи не затирает статьи, добавленные после открытия страницы", async () => {
    const ctx = ctxOf();
    await savePricelistArticles(
      ctx,
      [
        { title: "Uchino", content: "Японская марка." },
        { title: "Уход", content: "40°C." },
      ],
      new Date("2026-10-01T00:00:00Z"),
    );
    const page = (await pricelistOverview(ctx)).articles;
    // Пока страница открыта, в другой вкладке загрузили статью из PDF.
    await addKnowledgeArticles(ctx, [{ title: "Доставка", tags: [], content: "2 дня." }]);
    const uchino = page.find((a) => a.title === "Uchino")!;
    await savePricelistArticle(
      ctx,
      { id: uchino.id, title: "Uchino", content: "Японская марка, махра." },
      new Date("2026-10-08T00:00:00Z"),
    );
    const after = (await pricelistOverview(ctx)).articles;
    expect(after.map((a) => a.title).sort()).toEqual(["Uchino", "Доставка", "Уход"]);
    expect(after.find((a) => a.title === "Uchino")).toMatchObject({
      content: "Японская марка, махра.",
      updatedAt: "2026-10-08T00:00:00.000Z",
    });
    expect(after.find((a) => a.title === "Уход")!.updatedAt).toBe("2026-10-01T00:00:00.000Z");

    const added = await savePricelistArticle(ctx, { title: "Гарантия", content: "Год." });
    expect((await pricelistOverview(ctx)).articles).toHaveLength(4);
    await deletePricelistArticle(ctx, added.id);
    expect((await pricelistOverview(ctx)).articles.map((a) => a.title).sort()).toEqual([
      "Uchino",
      "Доставка",
      "Уход",
    ]);
    await expect(savePricelistArticle(ctx, { title: " ", content: "x" })).rejects.toMatchObject({
      key: "err.pricelist.kbEmpty",
    });
  });

  it("сохранение двух статей из двух вкладок одновременно: обе в базе", async () => {
    const ctx = ctxOf();
    await savePricelistArticles(ctx, [{ title: "Uchino", content: "Японская марка." }]);
    await Promise.all([
      savePricelistArticle(ctx, { title: "Доставка", content: "2 дня." }),
      savePricelistArticle(ctx, { title: "Уход", content: "40°C." }),
    ]);
    expect((await pricelistOverview(ctx)).articles).toHaveLength(3);
  });

  it("загрузка статей: предпросмотр ничего не пишет, добавление сохраняет прежние", async () => {
    const ctx = ctxOf();
    await savePricelistArticles(ctx, [
      { title: "Uchino", content: "Японская марка." },
      { title: "Доставка", content: "По Алматы бесплатно." },
    ]);
    const pre = await previewKnowledgeImport(ctx, {
      text: "### Доставка\nТеги: доставка\nПо Казахстану — 2 дня.\n---\n### Уход\nСтирать при 40°C.",
    });
    expect(pre.articles.map((a) => [a.title, a.replaces])).toEqual([
      ["Доставка", true],
      ["Уход", false],
    ]);
    expect((await pricelistOverview(ctx)).articles).toHaveLength(2);

    const r = await addKnowledgeArticles(ctx, pre.articles);
    expect(r).toEqual({ added: 1, updated: 1, total: 3 });
    const o = await pricelistOverview(ctx);
    expect(o.articles.map((a) => [a.title, a.content])).toEqual([
      ["Uchino", "Японская марка."],
      ["Доставка", "По Казахстану — 2 дня."],
      ["Уход", "Стирать при 40°C."],
    ]);
    expect(o.articles[1]!.tags).toEqual(["доставка"]);
  });

  it("загрузка статей из Word: файл без разделителей — статья с именем файла", async () => {
    const { zipFiles } = await import("@/core/export/zip");
    const doc = zipFiles([
      {
        name: "word/document.xml",
        data: '<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Rivolta Carmignani — Италия.</w:t></w:r></w:p><w:p><w:r><w:t>Поставляет в отели люкс.</w:t></w:r></w:p></w:body></w:document>',
      },
    ]);
    const pre = await previewKnowledgeImport(ctx0(), {
      fileName: "Rivolta_Carmignani.docx",
      base64: `data:application/octet-stream;base64,${doc.toString("base64")}`,
    });
    expect(pre.articles).toEqual([
      {
        title: "Rivolta Carmignani",
        tags: [],
        content: "Rivolta Carmignani — Италия.\nПоставляет в отели люкс.",
        replaces: false,
      },
    ]);
  });

  it("загрузка статей: скан PDF, большой файл и пустой выбор — ошибки продавцу", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const scan = await (async () => {
      const d = await PDFDocument.create();
      d.addPage();
      return Buffer.from(await d.save()).toString("base64");
    })();
    await expect(
      previewKnowledgeImport(ctx0(), { fileName: "scan.pdf", base64: scan }),
    ).rejects.toMatchObject({ key: "err.pricelist.kbPdfScan" });
    await expect(
      previewKnowledgeImport(ctx0(), {
        fileName: "big.txt",
        base64: Buffer.alloc(3 * 1024 * 1024 + 1, 97).toString("base64"),
      }),
    ).rejects.toMatchObject({ key: "err.pricelist.kbFileTooBig" });
    await expect(
      addKnowledgeArticles(ctx0(), [{ title: " ", tags: [], content: "x" }]),
    ).rejects.toMatchObject({
      key: "err.pricelist.kbNothingChosen",
    });
  });

  it("две загрузки статей одновременно не затирают друг друга", async () => {
    const ctx = ctxOf();
    await savePricelistArticles(ctx, [{ title: "Uchino", content: "Японская марка." }]);
    await Promise.all([
      addKnowledgeArticles(ctx, [{ title: "Доставка", tags: [], content: "2 дня." }]),
      addKnowledgeArticles(ctx, [{ title: "Уход", tags: [], content: "40°C." }]),
    ]);
    const titles = (await pricelistOverview(ctx)).articles.map((a) => a.title);
    expect(titles).toHaveLength(3);
    expect(new Set(titles)).toEqual(new Set(["Uchino", "Доставка", "Уход"]));
  });

  it("больше 200 статей не добавляется: ошибка, база прежняя", async () => {
    const ctx = ctxOf();
    await savePricelistArticles(
      ctx,
      Array.from({ length: 199 }, (_, i) => ({ title: `Статья ${i}`, content: "т" })),
    );
    await expect(
      addKnowledgeArticles(ctx, [
        { title: "Новая 1", tags: [], content: "т" },
        { title: "Новая 2", tags: [], content: "т" },
      ]),
    ).rejects.toMatchObject({ key: "err.pricelist.kbTooMany" });
    expect((await pricelistOverview(ctx)).articles).toHaveLength(199);
  });

  it("таблица: чужая ссылка не скачивается; загрузка файла отключает таблицу", async () => {
    const ctx = ctxOf();
    await expect(previewPricelistSheetFor(ctx, "https://evil.kz/x.csv")).rejects.toMatchObject({
      key: "err.catalog.sheetBadLink",
    });
    const link =
      "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit";
    const sheetCsv = "Название;Раздел;Цена\nFeiler;Полотенца;30000\n";
    const f = async () =>
      new Response(sheetCsv, { status: 200, headers: { "content-type": "text/csv" } });
    const pre = await previewPricelistSheetFor(ctx, link, f);
    if (!pre.ok) throw new Error("предпросмотр");
    expect(pre.diff).toMatchObject({ added: 1, removed: 0 });
    await importPricelistSheetFor(ctx, link, pre.fingerprint, f);
    let o = await pricelistOverview(ctx);
    expect(o.sheet).toMatchObject({ url: link, status: { ok: true, count: 1 } });
    expect(o.count).toBe(1);

    const r = await importPricelist(ctx, CSV, "остатки.csv");
    expect(r.sheetDisconnected).toBe(true);
    expect(r.diff).toMatchObject({ added: 2, removed: 1 });
    o = await pricelistOverview(ctx);
    expect(o.sheet).toBeNull();
    expect(o.count).toBe(2);
  });

  it("предпросмотр таблицы и статей закрыт магазину без режима по прайсу", async () => {
    await expect(previewPricelistSheetFor(ctxOf(false), "x")).rejects.toMatchObject({
      key: "err.pricelist.off",
    });
    await expect(previewKnowledgeImport(ctxOf(false), { text: "т" })).rejects.toMatchObject({
      key: "err.pricelist.off",
    });
  });
});

function ctx0() {
  return ctxOf();
}
