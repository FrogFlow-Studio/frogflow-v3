import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * Витрина магазина: неизвестный магазин, превью ссылки и установка на
 * телефон, отзывы, разметка для поиска и страницы каталога без JS.
 */

test("витрина: неизвестный магазин — страница «Магазин не найден»", async ({ page }) => {
  const errors = await watch(page);
  const res = await page.goto("/s/net-takogo-magazina");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Магазин не найден" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("витрина: превью ссылки и установка на телефон", async ({ page, request }) => {
  const errors = await watch(page);
  // Мессенджеры не выполняют скрипты: теги должны быть уже в ответе сервера.
  const html = await (await request.get(`/s/${F.SHOP_SLUG}/p/${F.PRODUCT_ID}`)).text();
  expect(html).toMatch(/<meta property="og:image" content="https?:\/\/[^"]+\/api\/img\//);
  await page.goto(`/s/${F.SHOP_SLUG}`);
  const og = (p: string) => page.locator(`meta[property="${p}"]`).getAttribute("content");
  expect(await og("og:title")).toBe(F.SHOP_NAME);
  expect(await og("og:url")).toMatch(new RegExp(`^https?://[^/]+/s/${F.SHOP_SLUG}$`));
  expect(await og("og:image")).toMatch(new RegExp(`^https?://[^/]+/api/img/${F.SHOP_ID}/`));
  const manifest = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(manifest).toBe(`/s/${F.SHOP_SLUG}/manifest.webmanifest`);
  const m = await request.get(manifest!);
  expect(m.headers()["content-type"]).toContain("application/manifest+json");
  expect(await m.json()).toMatchObject({ name: F.SHOP_NAME, display: "standalone" });
  const icon = await request.get(`/s/${F.SHOP_SLUG}/icon/192`);
  expect(icon.headers()["content-type"]).toBe("image/png");
  expect((await request.get(`/s/net-takogo-magazina/manifest.webmanifest`)).status()).toBe(404);

  await page.goto(`/s/${F.SHOP_SLUG}/p/${F.PRODUCT_ID}`);
  expect(await og("og:title")).toBe(`${F.PRODUCT_NAME} — ${F.SHOP_NAME}`);
  expect(await og("og:type")).toBe("product");
  expect(errors).toEqual([]);
});

test("витрина: на странице товара только одобренные отзывы", async ({ page }) => {
  const errors = await watch(page);
  await page.goto(`/s/${F.SHOP_SLUG}/p/${F.PRODUCT_ID}`);
  await expect(page.getByRole("heading", { name: "Отзывы покупателей" })).toBeVisible();
  await expect(page.getByText("Ребёнок пишет с удовольствием")).toBeVisible();
  await expect(page.getByText("Неодобренный отзыв")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("витрина: разметка товара для поиска уже в ответе сервера", async ({ request }) => {
  const html = await (await request.get(`/s/${F.SHOP_SLUG}/p/${F.PRODUCT_ID}`)).text();
  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
  expect(canonical).toMatch(new RegExp(`^https?://[^/]+/s/${F.SHOP_SLUG}/p/${F.PRODUCT_ID}$`));
  const raw = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)?.[1];
  const ld = JSON.parse(raw!);
  expect(ld).toMatchObject({
    "@type": "Product",
    name: F.PRODUCT_NAME,
    offers: { price: String(F.PRODUCT_PRICE), availability: "https://schema.org/InStock" },
    // Второй отзыв (1 звезда) ещё не одобрен продавцом и в оценку не входит.
    aggregateRating: { ratingValue: 5, reviewCount: 1 },
  });
  const shopHtml = await (await request.get(`/s/${F.SHOP_SLUG}?sort=new`)).text();
  expect(shopHtml).toMatch(
    new RegExp(`<link rel="canonical" href="https?://[^/]+/s/${F.SHOP_SLUG}"`),
  );
});

test("витрина: вторая страница каталога открывается ссылкой без JS, со своим canonical", async ({
  request,
}) => {
  const html = await (await request.get(`/s/${F.SHOP_SLUG}?page=2`)).text();
  expect(html).toMatch(
    new RegExp(`<link rel="canonical" href="https?://[^/]+/s/${F.SHOP_SLUG}\\?page=2"`),
  );
  // Товаров на второй странице нет (в магазине один), зато есть путь к началу.
  expect(html).toContain("К началу каталога");
  expect(html).not.toContain(F.PRODUCT_NAME);
});

/** Все блоки JSON-LD страницы: хлебные крошки идут рядом с разметкой товара. */
const ldBlocks = (html: string): Array<Record<string, unknown>> =>
  [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) =>
    JSON.parse(m[1]!),
  );

test("витрина: хлебные крошки на странице товара — ссылки, разметка BreadcrumbList с теми же адресами", async ({
  page,
  request,
}) => {
  const errors = await watch(page);
  const html = await (await request.get(`/s/${F.SHOP_SLUG}/p/${F.CRUMB_PRODUCT_ID}`)).text();
  const crumbs = ldBlocks(html).find((b) => b["@type"] === "BreadcrumbList") as {
    itemListElement: Array<{ position: number; name: string; item: string }>;
  };
  expect(crumbs.itemListElement.map((x) => [x.position, x.name])).toEqual([
    [1, F.SHOP_NAME],
    [2, F.CRUMB_PARENT_NAME],
    [3, F.CRUMB_CHILD_NAME],
    [4, F.CRUMB_PRODUCT_NAME],
  ]);
  expect(crumbs.itemListElement[2]!.item).toMatch(
    new RegExp(`/s/${F.SHOP_SLUG}\\?category=${F.CRUMB_CHILD_ID}$`),
  );
  expect(crumbs.itemListElement[3]!.item).toMatch(
    new RegExp(`/s/${F.SHOP_SLUG}/p/${F.CRUMB_PRODUCT_ID}$`),
  );
  // Те же адреса — в карте сайта (домен в разметке — canonical магазина, в карте — адрес запроса).
  const sitemap = await (await request.get(`/s/${F.SHOP_SLUG}/sitemap.xml`)).text();
  for (const i of [2, 3]) {
    const u = new URL(crumbs.itemListElement[i]!.item);
    expect(sitemap).toContain(`${u.pathname}${u.search}</loc>`);
  }
  // Ссылки видны в ответе сервера без JS.
  expect(html).toContain(`aria-label="Путь по каталогу"`);
  expect(html).toContain(F.CRUMB_PARENT_NAME);

  await page.goto(`/s/${F.SHOP_SLUG}/p/${F.CRUMB_PRODUCT_ID}`);
  const nav = page.getByRole("navigation", { name: "Путь по каталогу" });
  await expect(nav.getByRole("link", { name: "Каталог", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: F.CRUMB_PARENT_NAME, exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: F.CRUMB_CHILD_NAME, exact: true })).toBeVisible();
  await expect(nav.getByText(F.CRUMB_PRODUCT_NAME, { exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await nav.getByRole("link", { name: F.CRUMB_CHILD_NAME, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`category=${F.CRUMB_CHILD_ID}`));
  await expect(page.getByRole("heading", { name: F.CRUMB_CHILD_NAME, exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("витрина: на странице категории — путь до неё и BreadcrumbList; товар без категории — «Каталог › Товар»", async ({
  request,
}) => {
  const html = await (await request.get(`/s/${F.SHOP_SLUG}?category=${F.CRUMB_CHILD_ID}`)).text();
  const crumbs = ldBlocks(html).find((b) => b["@type"] === "BreadcrumbList") as {
    itemListElement: Array<{ name: string }>;
  };
  expect(crumbs.itemListElement.map((x) => x.name)).toEqual([
    F.SHOP_NAME,
    F.CRUMB_PARENT_NAME,
    F.CRUMB_CHILD_NAME,
  ]);
  expect(html).toContain(`aria-label="Путь по каталогу"`);

  const plain = await (await request.get(`/s/${F.SHOP_SLUG}/p/${F.PRODUCT_ID}`)).text();
  const plainCrumbs = ldBlocks(plain).find((b) => b["@type"] === "BreadcrumbList") as {
    itemListElement: Array<{ name: string }>;
  };
  expect(plainCrumbs.itemListElement.map((x) => x.name)).toEqual([F.SHOP_NAME, F.PRODUCT_NAME]);
});
