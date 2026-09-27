import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * Панели продавца и оператора: вход, гварды, разделы настроек, аналитика,
 * предпросмотр бота и ответы маршрутов /api.
 */

test("вход продавца: неверный пароль — понятная фраза, а не сырой текст ошибки", async ({
  page,
}) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await expect(page.getByRole("heading", { name: "Вход в панель магазина" })).toBeVisible();
  await page.locator('input[name="username"]').fill("nobody");
  await page.locator('input[name="password"]').fill("wrong-password");
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page.getByText("Неверный логин или пароль")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(
    /Cannot read|undefined|TypeError|Internal Server Error/,
  );
  expect(errors).toEqual([]);
});

test("панели без входа уводят на страницу входа", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login$/);
  await page.goto("/admin/pipeline");
  await expect(page).toHaveURL(/\/admin\/login$/);
  await page.goto("/operator");
  await expect(page).toHaveURL(/\/operator\/login$/);
  expect(errors).toEqual([]);
});

test("маршруты /api отвечают: крон без секрета — 401, а не 500", async ({ request }) => {
  expect((await request.get("/api/cron/health")).status()).toBe(401);
  expect((await request.get("/api/health")).status()).toBe(200);
  expect((await request.get("/robots.txt")).status()).toBe(200);
});

test("предпросмотр бота: приветствие, карточка товара и меню", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/bot-preview");
  await expect(page.getByRole("heading", { name: "Предпросмотр бота" })).toBeVisible();
  await expect(page.locator("strong", { hasText: F.SHOP_NAME })).toBeVisible();
  await expect(page.locator("strong", { hasText: F.PRODUCT_NAME })).toBeVisible();
  await expect(page.getByText("📚 Каталог")).toBeVisible();
  expect(errors).toEqual([]);
});

test("настройки продавца: разделы рисуются и оживают без ошибок гидратации", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/settings");
  // Разделы, которые видны на тарифе e2e-магазина (остальные — по модулям).
  for (const title of [
    "Магазин",
    "Способы оплаты по странам",
    "Telegram-бот",
    "Физические товары: получение и оплата",
    "Зоны доставки",
    "Robokassa: оплата картой",
    "Недельный отчёт",
    "Защита PDF от перепродажи",
  ])
    await expect(page.getByText(title, { exact: true }).first(), title).toBeVisible();
  await expect(page.getByText(`/api/robokassa/${F.SHOP_ID}/result`)).toContainText("http");
  await expect(page.locator("body")).not.toContainText(
    /Cannot read|undefined|TypeError|Internal Server Error/,
  );
  expect(errors).toEqual([]);
});

test("аналитика: воронка по источникам рисуется", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/analytics");
  await expect(page.getByText("Воронка по источникам")).toBeVisible();
  expect(errors).toEqual([]);
});
