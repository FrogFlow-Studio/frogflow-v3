import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** В3: тема и блоки главной из bots.settings.storefront_design; без настройки главная прежняя. */
test("оформление: тёплая тема и блок «Новинки» над каталогом", async ({ page }) => {
  const errors = await watch(page);
  await page.goto(`/s/${F.DESIGN_SHOP_SLUG}`);
  await expect(page.locator(".shop-theme-warm")).toHaveCount(1);
  const block = page.locator('[data-block="new"]');
  await expect(block.getByRole("heading", { name: "Новинки", exact: true })).toBeVisible();
  await expect(block.getByText(F.DESIGN_PRODUCT_NAME)).toBeVisible();
  // Блок только на чистой главной: с поиском его нет.
  await page.goto(`/s/${F.DESIGN_SHOP_SLUG}?q=свеча`);
  await expect(page.locator('[data-block="new"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("оформление: магазин без настройки — прежняя тема, без блоков", async ({ page }) => {
  const errors = await watch(page);
  await page.goto(`/s/${F.SHOP_SLUG}`);
  await expect(page.locator('[class*="shop-theme-"]')).toHaveCount(0);
  await expect(page.getByTestId("showcase")).toHaveCount(0);
  expect(errors).toEqual([]);
});
