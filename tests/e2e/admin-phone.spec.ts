import { expect, test, type Page } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * Панель продавца на телефоне (аудит, пакет В): страницы не шире экрана, товары и
 * покупатели — карточками без шапки таблицы, фильтры товаров и диалогов — за кнопкой.
 */

async function login(page: Page, user = F.SELLER_LOGIN, password = F.SELLER_PASSWORD) {
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(user);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("[phone] товары, покупатели, скидки, диалоги — без боковой прокрутки", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "только телефон");
  const errors = await watch(page);
  await login(page);

  await page.goto("/admin/products");
  const filters = page.getByRole("button", { name: "Фильтры", exact: true });
  await expect(filters).toBeVisible();
  // Сортировка спрятана до нажатия «Фильтры»; шапки таблицы нет, строки — карточки.
  await expect(page.getByRole("combobox", { name: "Порядок", exact: true })).toBeHidden();
  await expect(page.locator("main table thead")).toBeHidden();
  await expect(page.locator("main table tbody tr").first()).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await filters.click();
  await expect(page.getByRole("combobox", { name: "Порядок", exact: true })).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);

  for (const path of ["/admin/customers", "/admin/discounts"]) {
    await page.goto(path);
    await expect(page.locator("main h1").first()).toBeVisible();
    expect(await overflow(page), path).toBeLessThanOrEqual(0);
  }

  await page.goto("/admin/chat");
  await expect(page.getByTestId("chat-list")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Непрочитанные/ })).toBeHidden();
  await expect(page.getByRole("button", { name: "Фильтры", exact: true })).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test("[phone] залежавшийся товар — не шире экрана", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "только телефон");
  const errors = await watch(page);
  await login(page, F.STALE18_SELLER_LOGIN, F.STALE18_SELLER_PASSWORD);
  await page.goto("/admin/warehouse/stale");
  await expect(
    page.getByRole("heading", { name: "Залежавшийся товар", exact: true }),
  ).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});
