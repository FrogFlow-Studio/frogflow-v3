import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  classifyDownload,
  decideField,
  parseSheetConfig,
  planHide,
  sheetCsvUrl,
  valueHash,
  SHEET_CONFIG_KEY,
  SHEET_STATE_KEY,
  SHEET_STATUS_KEY,
  type SheetConfig,
} from "./sheet";
import { downloadSheet, runSheetSync, syncFromCsv, type FetchLike } from "./sheet.server";

const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
const LINK = `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=42`;

describe("ссылка на таблицу", () => {
  it("превращает ссылку «Поделиться» и опубликованную в выгрузку CSV", () => {
    expect(sheetCsvUrl(LINK)).toBe(
      `https://docs.google.com/spreadsheets/d/${ID}/export?format=csv&gid=42`,
    );
    expect(sheetCsvUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing`)).toBe(
      `https://docs.google.com/spreadsheets/d/${ID}/export?format=csv`,
    );
    expect(
      sheetCsvUrl(`https://docs.google.com/spreadsheets/d/e/2PACX-${ID}/pubhtml?gid=7&single=true`),
    ).toBe(`https://docs.google.com/spreadsheets/d/e/2PACX-${ID}/pub?output=csv&gid=7`);
  });

  it("чужие адреса не принимает: сервер ходит только в docs.google.com", () => {
    for (const bad of [
      `http://docs.google.com/spreadsheets/d/${ID}/edit`,
      `https://docs.google.com.evil.kz/spreadsheets/d/${ID}/edit`,
      `https://evil.kz/spreadsheets/d/${ID}/edit`,
      `https://docs.google.com:8443/spreadsheets/d/${ID}/edit`,
      `https://user@docs.google.com/spreadsheets/d/${ID}/edit`,
      `https://docs.google.com/document/d/${ID}/edit`,
      `https://docs.google.com/spreadsheets/d/short/edit`,
      "не ссылка",
    ])
      expect(sheetCsvUrl(bad)).toBeNull();
  });

  it("настройки: скрытие и перезапись по умолчанию выключены", () => {
    expect(parseSheetConfig(JSON.stringify({ url: LINK }))).toEqual({
      url: LINK,
      hideMissing: false,
      overwriteManual: false,
    });
    expect(parseSheetConfig(JSON.stringify({ url: "https://evil.kz/x" }))).toBeNull();
    expect(parseSheetConfig("{битый")).toBeNull();
  });
});

describe("что пришло вместо таблицы", () => {
  const ok = { status: 200, contentType: "text/csv", finalUrl: "https://docs.google.com/x" };
  it("закрытая таблица (вход в Google, HTML, 401/403) — не каталог", () => {
    expect(
      classifyDownload({ ...ok, finalUrl: "https://accounts.google.com/signin", body: "x" }),
    ).toEqual({ ok: false, reason: "closed" });
    expect(
      classifyDownload({ ...ok, contentType: "text/html; charset=utf-8", body: "<html>" }),
    ).toEqual({ ok: false, reason: "closed" });
    expect(classifyDownload({ ...ok, contentType: null, body: "<!DOCTYPE html><p>" })).toEqual({
      ok: false,
      reason: "closed",
    });
    expect(classifyDownload({ ...ok, status: 403, body: "" }).ok).toBe(false);
  });
  it("404, сбой и пустой ответ — тоже отказ", () => {
    expect(classifyDownload({ ...ok, status: 404, body: "" })).toEqual({
      ok: false,
      reason: "notFound",
    });
    expect(classifyDownload({ ...ok, status: 500, body: "" })).toEqual({
      ok: false,
      reason: "download",
    });
    expect(classifyDownload({ ...ok, body: " \n " })).toEqual({ ok: false, reason: "empty" });
    expect(classifyDownload({ ...ok, body: "Название\nЧай" })).toEqual({
      ok: true,
      csv: "Название\nЧай",
    });
  });
});

describe("правила полей", () => {
  const base = { overwriteManual: false, interactive: false };
  it("поле, которым владеет таблица, обновляется; поправленное продавцом — нет", () => {
    expect(decideField({ ...base, cur: 100, next: 120, rec: valueHash(100) })).toBe("write");
    expect(decideField({ ...base, cur: 150, next: 120, rec: valueHash(100) })).toBe("keep");
    expect(
      decideField({ ...base, overwriteManual: true, cur: 150, next: 120, rec: valueHash(100) }),
    ).toBe("write");
    expect(decideField({ ...base, cur: "120", next: 120, rec: undefined })).toBe("same");
  });
  it("поле, которое таблица ещё не писала: ночью не трогаем, по кнопке — пишем", () => {
    expect(decideField({ ...base, cur: "моё", next: "из таблицы", rec: undefined })).toBe("keep");
    expect(
      decideField({ ...base, interactive: true, cur: "моё", next: "из таблицы", rec: undefined }),
    ).toBe("write");
  });
  it("скрытие: только по настройке, только товары из таблицы, и не при обвале", () => {
    const state = Object.fromEntries(
      ["a", "b", "c", "d", "e", "f"].map((id) => [id, { n: id, h: {} }]),
    );
    const existing = new Map(
      ["a", "b", "c", "d", "e", "f", "manual"].map((id) => [id, { is_active: true }]),
    );
    const present = new Set(["a", "b", "c", "d", "e"]);
    expect(planHide({ hideMissing: false, state, present, existing })).toEqual({
      hide: [],
      guard: false,
    });
    expect(planHide({ hideMissing: true, state, present, existing })).toEqual({
      hide: ["f"],
      guard: false,
    });
    expect(planHide({ hideMissing: true, state, present: new Set(["a"]), existing })).toEqual({
      hide: [],
      guard: true,
    });
  });
});

function ctxWith(products: Record<string, unknown>[] = []) {
  const db = fakeDb();
  db.tables.products = products.map((p) => ({ is_active: true, bot_id: "t1", ...p }));
  db.tables.categories = [];
  db.tables.app_settings = [];
  const ctx = { db, tenant: { id: "t1", settings: {} } } as unknown as TenantContext;
  return { db, ctx };
}
const cfg = (o: Partial<SheetConfig> = {}): SheetConfig => ({
  url: LINK,
  hideMissing: false,
  overwriteManual: false,
  ...o,
});
const product = (db: ReturnType<typeof fakeDb>, name: string) =>
  db.tables.products!.find((p) => p.name === name)!;

describe("синхронизация каталога", () => {
  const CSV = "Название;Цена;Описание\nЧай;1000;Зелёный\nКофе;2000;Арабика\nКакао;1500;Тёплое\n";

  it("первый запуск создаёт товары; ночью обновляет то, чем владеет таблица", async () => {
    const { db, ctx } = ctxWith();
    const r1 = await syncFromCsv(ctx, CSV, cfg(), "interactive");
    expect(r1).toMatchObject({ ok: true, created: 3, updated: 0 });
    const r2 = await syncFromCsv(ctx, CSV.replace("Чай;1000", "Чай;1100"), cfg(), "nightly");
    expect(r2).toMatchObject({ ok: true, created: 0, updated: 1, kept: 0 });
    expect(product(db, "Чай").price).toBe(1100);
  });

  it("ручную правку продавца ночью не затирает, с согласием — перезаписывает", async () => {
    const { db, ctx } = ctxWith();
    await syncFromCsv(ctx, CSV, cfg(), "interactive");
    product(db, "Кофе").description = "Моё описание";
    product(db, "Кофе").image_url = "photo.jpg";
    const next = CSV.replace("Арабика", "Робуста").replace("Кофе;2000", "Кофе;2100");
    const r = await syncFromCsv(ctx, next, cfg(), "nightly");
    expect(r).toMatchObject({ ok: true, kept: 1, updated: 1 });
    expect(product(db, "Кофе").description).toBe("Моё описание");
    expect(product(db, "Кофе").price).toBe(2100);
    expect(product(db, "Кофе").image_url).toBe("photo.jpg");
    // И следующей ночью правка всё ещё защищена.
    expect(await syncFromCsv(ctx, next, cfg(), "nightly")).toMatchObject({ kept: 1, updated: 0 });
    await syncFromCsv(ctx, next, cfg({ overwriteManual: true }), "nightly");
    expect(product(db, "Кофе").description).toBe("Робуста");
    expect(product(db, "Кофе").image_url).toBe("photo.jpg");
  });

  it("товары, которых нет в таблице, не удаляет; скрывает только по настройке", async () => {
    const { db, ctx } = ctxWith([{ id: "m1", name: "Свой товар", price: 5 }]);
    await syncFromCsv(ctx, CSV, cfg(), "interactive");
    const shorter = "Название;Цена;Описание\nЧай;1000;Зелёный\nКофе;2000;Арабика\n";
    await syncFromCsv(ctx, shorter, cfg(), "nightly");
    expect(db.tables.products).toHaveLength(4);
    expect(product(db, "Какао").is_active).toBe(true);
    const r = await syncFromCsv(ctx, shorter, cfg({ hideMissing: true }), "nightly");
    expect(r).toMatchObject({ hidden: 1 });
    expect(db.tables.products).toHaveLength(4);
    expect(product(db, "Какао").is_active).toBe(false);
    // Товар, добавленный вручную, скрытие не трогает.
    expect(product(db, "Свой товар").is_active).toBe(true);
    // Вернулся в таблицу — снова показан.
    const back = await syncFromCsv(ctx, CSV, cfg({ hideMissing: true }), "nightly");
    expect(back).toMatchObject({ restored: 1 });
    expect(product(db, "Какао").is_active).toBe(true);
  });

  it("если из таблицы пропало больше половины — не скрывает ничего", async () => {
    const { db, ctx } = ctxWith();
    await syncFromCsv(ctx, `${CSV}Сок;900;Яблочный\n`, cfg(), "interactive");
    const r = await syncFromCsv(ctx, "Название\nЧай\n", cfg({ hideMissing: true }), "nightly");
    expect(r).toMatchObject({ ok: true, hidden: 0, guard: true });
    expect(db.tables.products!.every((p) => p.is_active)).toBe(true);
  });

  it("ночью не трогает товар, добавленный вручную, и не создаёт заново удалённый", async () => {
    const { db, ctx } = ctxWith();
    await syncFromCsv(ctx, CSV, cfg(), "interactive");
    db.tables.products = db.tables.products!.filter((p) => p.name !== "Какао");
    db.tables.products.push({ id: "m1", name: "Сок", price: 7, is_active: true, bot_id: "t1" });
    const r = await syncFromCsv(ctx, `${CSV}Сок;900;Яблочный\n`, cfg(), "nightly");
    expect(r).toMatchObject({ ok: true, created: 0, needsReview: 1, skippedDeleted: 1 });
    expect(product(db, "Сок").price).toBe(7);
    expect(db.tables.products.find((p) => p.name === "Какао")).toBeUndefined();
    // По кнопке после предпросмотра продавец сам соглашается: связываем и возвращаем.
    const r2 = await syncFromCsv(ctx, `${CSV}Сок;900;Яблочный\n`, cfg(), "interactive");
    expect(r2).toMatchObject({ created: 1, updated: 1 });
    expect(product(db, "Сок").price).toBe(900);
  });

  it("пустая таблица или без колонки названия — каталог не трогает", async () => {
    const { db, ctx } = ctxWith();
    await syncFromCsv(ctx, CSV, cfg(), "interactive");
    const before = JSON.stringify(db.tables.products);
    const state = JSON.stringify(db.tables.app_settings);
    expect(
      await syncFromCsv(ctx, "Название;Цена\n", cfg({ hideMissing: true }), "nightly"),
    ).toEqual({ ok: false, reason: "empty" });
    expect(await syncFromCsv(ctx, "Цена\n100\n", cfg({ hideMissing: true }), "nightly")).toEqual({
      ok: false,
      reason: "noHeader",
    });
    expect(JSON.stringify(db.tables.products)).toBe(before);
    expect(JSON.stringify(db.tables.app_settings)).toBe(state);
  });
});

/** Ответы Google по порядку запросов. */
function fakeFetch(...responses: Response[]): FetchLike & { urls: string[] } {
  const urls: string[] = [];
  const f = (async (url: string) => {
    urls.push(url);
    const r = responses.shift();
    if (!r) throw new Error("сеть");
    return r;
  }) as unknown as FetchLike & { urls: string[] };
  f.urls = urls;
  return f;
}
const csvResponse = (body: string) =>
  new Response(body, { status: 200, headers: { "content-type": "text/csv" } });
const redirect = (to: string) => new Response(null, { status: 307, headers: { location: to } });

describe("скачивание", () => {
  it("проходит переадресацию Google и отдаёт CSV", async () => {
    const f = fakeFetch(
      redirect("https://doc-0s-9c.googleusercontent.com/export/abc"),
      csvResponse("Название\nЧай\n"),
    );
    expect(await downloadSheet(LINK, f)).toEqual({ ok: true, csv: "Название\nЧай\n" });
    expect(f.urls[0]).toContain("/export?format=csv&gid=42");
  });
  it("вход в Google — таблица закрыта; переадресация на чужой адрес — сбой", async () => {
    expect(
      await downloadSheet(LINK, fakeFetch(redirect("https://accounts.google.com/ServiceLogin"))),
    ).toEqual({ ok: false, reason: "closed" });
    expect(await downloadSheet(LINK, fakeFetch(redirect("https://evil.kz/x")))).toEqual({
      ok: false,
      reason: "download",
    });
    expect(await downloadSheet(LINK, fakeFetch())).toEqual({ ok: false, reason: "download" });
  });
});

describe("ночной прогон", () => {
  const CSV = "Название;Цена\nЧай;1000\nКофе;2000\n";
  async function connected() {
    const { db, ctx } = ctxWith();
    db.tables.app_settings!.push({
      bot_id: "t1",
      key: SHEET_CONFIG_KEY,
      value: JSON.stringify({ url: LINK, hideMissing: true }),
    });
    await runSheetSync(ctx, "interactive", fakeFetch(csvResponse(CSV)));
    return { db, ctx };
  }
  const setting = (db: ReturnType<typeof fakeDb>, key: string) =>
    db.tables.app_settings!.find((s) => s.key === key)?.value as string | undefined;

  it("закрытая таблица: каталог не тронут, продавцу — одно сообщение", async () => {
    const { db, ctx } = await connected();
    const before = JSON.stringify(db.tables.products);
    const stateBefore = setting(db, SHEET_STATE_KEY);
    const closed = () => fakeFetch(redirect("https://accounts.google.com/ServiceLogin"));
    const r = await runSheetSync(ctx, "nightly", closed());
    expect(r!.run).toEqual({ ok: false, reason: "closed" });
    expect(r!.notify).toContain("Товары в магазине не тронуты");
    expect(JSON.stringify(db.tables.products)).toBe(before);
    expect(setting(db, SHEET_STATE_KEY)).toBe(stateBefore);
    expect(JSON.parse(setting(db, SHEET_STATUS_KEY)!)).toMatchObject({
      ok: false,
      reason: "closed",
    });
    // Следующей ночью та же беда — не повторяем сообщение.
    expect((await runSheetSync(ctx, "nightly", closed()))!.notify).toBeNull();
  });

  it("два ночных крона одновременно — продавцу одно сообщение о беде", async () => {
    const { db, ctx } = await connected();
    const closed = () => fakeFetch(redirect("https://accounts.google.com/ServiceLogin"));
    const [a, b] = await Promise.all([
      runSheetSync(ctx, "nightly", closed()),
      runSheetSync(ctx, "nightly", closed()),
    ]);
    expect([a!.notify, b!.notify].filter(Boolean)).toHaveLength(1);
    expect(JSON.parse(setting(db, SHEET_STATUS_KEY)!)).toMatchObject({
      ok: false,
      reason: "closed",
    });
  });

  it("не скачалась или пустая — каталог не тронут, продавцу сообщение", async () => {
    const { db, ctx } = await connected();
    const before = JSON.stringify(db.tables.products);
    const r1 = await runSheetSync(ctx, "nightly", fakeFetch());
    expect(r1!.run).toEqual({ ok: false, reason: "download" });
    expect(r1!.notify).not.toBeNull();
    const r2 = await runSheetSync(ctx, "nightly", fakeFetch(csvResponse("")));
    expect(r2!.run).toEqual({ ok: false, reason: "empty" });
    expect(r2!.notify).not.toBeNull();
    expect(JSON.stringify(db.tables.products)).toBe(before);
  });

  it("без подключённой таблицы ничего не делает", async () => {
    const { ctx } = ctxWith();
    expect(await runSheetSync(ctx, "nightly", fakeFetch())).toBeNull();
  });
});

describe("большой магазин: больше 1000 товаров", () => {
  it("ничего не дублирует и не считает пропавшим за первой тысячей", async () => {
    const db = fakeDb({ maxRows: 1000 });
    db.tables.products = [];
    db.tables.categories = [];
    db.tables.app_settings = [];
    // Postgres без order отдаёт строки в любом порядке, и от запроса к запросу он
    // меняется: страницы range без order перекрываются. Сдвигаем таблицу на
    // каждом обращении, как это бывает после обновлений строк.
    const from = db.from.bind(db);
    db.from = (table: string) => {
      const t = db.tables[table];
      if (table === "products" && t && t.length > 1) t.push(...t.splice(0, 700));
      return from(table);
    };
    const ctx = { db, tenant: { id: "t1", settings: {} } } as unknown as TenantContext;
    const rows = Array.from({ length: 1500 }, (_, i) => `Товар ${i};${100 + i}`).join("\n");
    const csv = `Название;Цена\n${rows}\n`;
    expect(await syncFromCsv(ctx, csv, cfg(), "interactive")).toMatchObject({ created: 1500 });
    const again = await syncFromCsv(ctx, csv, cfg({ hideMissing: true }), "nightly");
    expect(again).toMatchObject({
      ok: true,
      created: 0,
      updated: 0,
      hidden: 0,
      needsReview: 0,
      skippedDeleted: 0,
      guard: false,
    });
    expect(db.tables.products).toHaveLength(1500);
    expect(db.tables.products!.every((p) => p.is_active)).toBe(true);
  });
});
