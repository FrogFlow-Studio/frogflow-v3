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
