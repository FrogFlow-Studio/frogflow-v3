import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * Фильтры главной витрины: цена от–до уходит в запрос и сохраняется в адресе,
 * «Сбросить фильтры» возвращает весь каталог. Прописи — 1500 ₸, раскраска — 900 ₸.
 */
test("витрина: фильтр цены оставляет подходящие товары, сброс возвращает все", async ({ page }) => {
  const errors = await watch(page);
  await page.goto(`/s/${F.SHOP_SLUG}`);
  await expect(page.getByText(F.PRODUCT_NAME).first()).toBeVisible();
  await expect(page.getByText(F.UPSELL_NAME).first()).toBeVisible();
  await expect(page.getByLabel("В наличии")).toBeVisible();

  await page.getByLabel("Цена от").fill("1000");
  await page.getByRole("button", { name: "Применить", exact: true }).click();
  await expect(page).toHaveURL(/min=1000/);
  await expect(page.getByText(F.PRODUCT_NAME).first()).toBeVisible();
  await expect(page.getByText(F.UPSELL_NAME)).toHaveCount(0);

  await page.getByRole("link", { name: "Сбросить фильтры", exact: true }).click();
  await expect(page.getByText(F.UPSELL_NAME).first()).toBeVisible();
  await expect(page).not.toHaveURL(/min=/);

  await page.goto(`/s/${F.SHOP_SLUG}?max=1000`);
  await expect(page.getByText(F.UPSELL_NAME).first()).toBeVisible();
  await expect(page.getByText(F.PRODUCT_NAME)).toHaveCount(0);
  expect(errors).toEqual([]);
});
