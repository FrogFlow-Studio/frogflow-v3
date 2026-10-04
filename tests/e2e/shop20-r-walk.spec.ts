import { expect, test, type Page } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * Р5: обход новых страниц админки (запуск магазина, центр уведомлений, настройки по темам,
 * отчёты, сборка пачкой) на телефоне 412 px и на компьютере: без горизонтальной прокрутки;
 * бухгалтер видит только своё — продажи, заказы, уведомления, оплату тарифа.
 */
async function login(page: Page, user: string, password: string) {
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(user);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

test("владелец: новые страницы без горизонтальной прокрутки", async ({ page }) => {
  const errors = await watch(page);
  await login(page, F.R20_SELLER_LOGIN, F.R20_SELLER_PASSWORD);

  // Запуск магазина — на главной.
  await expect(page.getByText(/^Запуск магазина · готово на \d+%$/)).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(false);

  // Центр уведомлений.
  await page.goto("/admin/notifications");
  await expect(page).toHaveURL(/\/admin\/notifications/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(false);

  // Настройки по темам: каждая тема без прокрутки вбок.
  await page.goto("/admin/settings");
  await expect(page.locator('[data-settings-section="shop"]')).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(false);
  await page.getByRole("button", { name: "Оплата и доставка", exact: true }).click();
  await expect(page.locator('[data-settings-section="zones"]')).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(false);
  await page.getByRole("button", { name: "Все", exact: true }).click();
  expect(await noHorizontalScroll(page)).toBe(false);

  // Отчёты.
  await page.goto("/admin/reports");
  await expect(page.getByRole("tab", { name: "Продажи", exact: true })).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(false);

  // Сборка пачкой: сегодняшние заказы по ссылке «К сборке сегодня».
  await page.goto("/admin/orders");
  await page.getByRole("link", { name: "К сборке сегодня", exact: true }).click();
  await expect(page).toHaveURL(/assembly=today/);
  await expect(
    page.getByText("Обход Анна", { exact: false }).locator("visible=true").first(),
  ).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(false);

  expect(errors).toEqual([]);
});

test("бухгалтер: только заказы, уведомления, отчёты и оплата тарифа", async ({ page }) => {
  const errors = await watch(page);
  await login(page, F.R20_ACC_LOGIN, F.R20_ACC_PASSWORD);

  // Меню без настроек, чата, товаров и журнала действий.
  for (const href of [
    "/admin/settings",
    "/admin/chat",
    "/admin/products",
    "/admin/customers",
    "/admin/log",
  ])
    await expect(page.locator(`a[href="${href}"]`)).toHaveCount(0);

  // Своё открывается и не прокручивается вбок.
  await page.goto("/admin/reports");
  await expect(page.getByRole("tab", { name: "Продажи", exact: true })).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(false);

  await page.goto("/admin/notifications");
  await expect(page).toHaveURL(/\/admin\/notifications/);
  expect(await noHorizontalScroll(page)).toBe(false);

  await page.goto("/admin/orders");
  await expect(
    page.getByText("Торт обхода 1", { exact: false }).locator("visible=true").first(),
  ).toBeVisible();
  // Имён покупателей бухгалтеру не показывают.
  await expect(page.getByText("Обход Анна", { exact: false })).toHaveCount(0);
  expect(await noHorizontalScroll(page)).toBe(false);

  expect(errors).toEqual([]);
});
