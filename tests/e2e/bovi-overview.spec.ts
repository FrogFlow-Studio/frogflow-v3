import { expect, test, type Page } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * BOVI 06.10: консультант с модулем магазина из v1, но без товаров, видел на
 * «Обзоре» магазин: «Первые 7 дней» (закрыть нельзя), «Добавьте товары»,
 * выручку и «Последние заказы», а внизу — «Заказы» и «Товары».
 */
async function login(page: Page) {
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.BOVI_PLAN_LOGIN);
  await page.locator('input[name="password"]').fill(F.BOVI_PLAN_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

test("консультант без продаж: «Обзор» без карточек магазина", async ({ page }) => {
  const errors = await watch(page);
  await login(page);
  await expect(page.getByText("Покупателей", { exact: true })).toBeVisible();
  // «Запуск» остаётся, но без шагов про продажу.
  await expect(page.getByText("Подключить бота в Telegram", { exact: true })).toBeVisible();
  await expect(page.getByText("Первые 7 дней", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Добавьте и включите товар", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Добавить 5 товаров", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Последние заказы", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Выручка за 30 дней", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Товаров в продаже", { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("консультант без продаж: внизу на телефоне консультант и прайс", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const errors = await watch(page);
  await login(page);
  const bar = page.getByRole("navigation", { name: "Главные разделы", exact: true });
  await expect(bar.getByRole("link", { name: "ИИ-консультант", exact: true })).toBeVisible();
  await expect(bar.getByRole("link", { name: "Прайс консультанта", exact: true })).toBeVisible();
  await expect(bar.getByRole("link", { name: "Заказы", exact: true })).toHaveCount(0);
  await expect(bar.getByRole("link", { name: "Товары", exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
