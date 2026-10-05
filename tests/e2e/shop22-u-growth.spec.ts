import { expect, test, type Page } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** У3, У4: «Вернулись покупатели» и «Что продвигать» на странице аналитики; бухгалтеру советов нет; телефон без горизонтальной прокрутки. */
async function login(page: Page, user: string, password: string) {
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(user);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

test("аналитика: «Вернулись покупатели» и «Что продвигать» у владельца", async ({ page }) => {
  const errors = await watch(page);
  await login(page, F.ZH21_SELLER_LOGIN, F.ZH21_SELLER_PASSWORD);
  await page.goto("/admin/analytics");
  await expect(page.getByText("Вернулись покупатели", { exact: true })).toBeVisible();
  await expect(page.getByText("Что продвигать", { exact: true })).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(false);
  expect(errors).toEqual([]);
});

test("аналитика: бухгалтеру «Что продвигать» не показывается", async ({ page }) => {
  await login(page, F.ZH21_ACC_LOGIN, F.ZH21_ACC_PASSWORD);
  await page.goto("/admin/analytics");
  await expect(page.getByText("Вернулись покупатели", { exact: true })).toBeVisible();
  await expect(page.getByText("Что продвигать", { exact: true })).toHaveCount(0);
});

/** У5: блок «Рост» на главной; бухгалтер видит отчёты, но не источники. */
test("главная: блок «Рост» и ссылка в «Аналитику», без горизонтальной прокрутки", async ({
  page,
}) => {
  await login(page, F.ZH21_SELLER_LOGIN, F.ZH21_SELLER_PASSWORD);
  await expect(page.getByText("Рост", { exact: true })).toBeVisible();
  await expect(page.locator("[data-growth]")).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(false);
  await page.getByRole("link", { name: /Подробнее в «Аналитике»/ }).click();
  await expect(page).toHaveURL(/\/admin\/analytics/);
  await expect(page.getByText("Воронка по источникам", { exact: true })).toBeVisible();
});

test("бухгалтер: «Рост» есть, источников в аналитике нет", async ({ page }) => {
  await login(page, F.ZH21_ACC_LOGIN, F.ZH21_ACC_PASSWORD);
  await expect(page.locator("[data-growth]")).toBeVisible();
  await page.goto("/admin/analytics");
  await expect(page.getByText("Вернулись покупатели", { exact: true })).toBeVisible();
  await expect(page.getByText("Воронка по источникам", { exact: true })).toHaveCount(0);
});
