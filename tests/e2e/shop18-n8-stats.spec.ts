import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * Итоги наборов и подарков (магазин «Наборы Н18»): на «Аналитике» считаются только
 * выданные заказы — неоплаченный заказ с девятью наборами и подарком в итоги не входит.
 */
test("аналитика: наборы, подарки и упаковка по оплаченным заказам", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.N8_SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.N8_SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await page.goto("/admin/analytics");
  await expect(page.getByRole("heading", { name: "Наборы и подарки", exact: true })).toBeVisible();
  // 2 набора по 1 500; выгода 300 × 2; девять наборов неоплаченного заказа не считаются.
  await expect(page.getByTestId("bundles-sold")).toHaveText("2 шт., заказов: 1");
  await expect(page.getByTestId("bundles-revenue")).toContainText(/3\s?000/);
  await expect(page.getByTestId("bundles-saved")).toContainText(/600/);
  // Оплаченных заказов два, подарок среди них один (подарок неоплаченного не в счёт).
  await expect(page.getByTestId("bundles-gifts")).toHaveText("1 из 2 (50 %)");
  await expect(page.getByTestId("bundles-wrap")).toContainText(/500/);
  await expect(page.getByRole("cell", { name: F.N8_BUNDLE_NAME, exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
