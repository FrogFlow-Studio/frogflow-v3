import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * Акция со сроком на витрине: у товара новая цена, рядом зачёркнутая прежняя и
 * «−25 %»; галочка «Со скидкой» оставляет только товары с акцией, сброс
 * возвращает весь каталог. Прописи (1500 ₸) без акции — цена прежняя.
 */
test("витрина: цена по акции зачёркнута, фильтр «Со скидкой» оставляет только акционные", async ({
  page,
}) => {
  const errors = await watch(page);
  await page.goto(`/s/${F.SHOP_SLUG}`);
  const card = page.locator("article, li, div").filter({ hasText: F.SALE_PRODUCT_NAME }).last();
  await expect(page.getByText(F.SALE_PRODUCT_NAME).first()).toBeVisible();
  await expect(
    page
      .locator("s")
      .filter({ hasText: /2[\s\u00a0]?000/ })
      .first(),
  ).toBeVisible();
  await expect(page.getByText(`−${F.SALE_PERCENT} %`).first()).toBeVisible();
  await expect(card).toContainText(/1[\s\u00a0]?500/);
  await expect(page.getByText(F.PRODUCT_NAME).first()).toBeVisible();

  await page.getByLabel("Со скидкой").check();
  await page.getByRole("button", { name: "Применить", exact: true }).click();
  await expect(page).toHaveURL(/sale=1/);
  await expect(page.getByText(F.SALE_PRODUCT_NAME).first()).toBeVisible();
  await expect(page.getByText(F.PRODUCT_NAME)).toHaveCount(0);
  await expect(page.getByText(F.UPSELL_NAME)).toHaveCount(0);

  await page.getByRole("link", { name: "Сбросить фильтры", exact: true }).click();
  await expect(page).not.toHaveURL(/sale=/);
  await expect(page.getByText(F.PRODUCT_NAME).first()).toBeVisible();
  expect(errors).toEqual([]);
});
