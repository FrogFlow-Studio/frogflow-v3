import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * Умный поиск на витрине: когда обычный поиск пуст, подставная модель подбирает товар
 * по смыслу; повтор в той же сессии — «занято» (кулдаун); найденное обычным поиском не
 * тратит вызов; у магазина с выключенным переключателем ничего не меняется.
 */
const shop = `/s/${F.SMART16_SHOP_SLUG}`;

test("пустой поиск → подбор по смыслу; повтор в сессии — кулдаун", async ({ page }) => {
  const errors = await watch(page);
  await page.goto(`${shop}?q=угощение`);
  await expect(
    page.getByText("Точного совпадения нет. Подобрали по смыслу:", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: F.SMART16_CAKE_NAME, exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: F.SMART16_PIE_NAME, exact: true })).toHaveCount(0);

  // Новый запрос в той же вкладке: кулдаун 45 секунд.
  await page.goto(`${shop}?q=лакомство`);
  await expect(
    page.getByText("Умный поиск сейчас занят, попробуйте чуть позже.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: F.SMART16_CAKE_NAME, exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("обычный поиск нашёл — умного блока нет", async ({ page }) => {
  const errors = await watch(page);
  await page.goto(`${shop}?q=Пирог`);
  await expect(
    page.getByRole("link", { name: F.SMART16_PIE_NAME, exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("Точного совпадения нет. Подобрали по смыслу:", { exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("переключатель выключен у продавца — только «ничего не найдено»", async ({ page }) => {
  const errors = await watch(page);
  await page.goto(`/s/${F.SMART16_OFF_SHOP_SLUG}?q=угощение`);
  await expect(page.getByText("Ничего не нашлось", { exact: false }).first()).toBeVisible();
  await expect(
    page.getByText("Точного совпадения нет. Подобрали по смыслу:", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("Ищем по смыслу…", { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
