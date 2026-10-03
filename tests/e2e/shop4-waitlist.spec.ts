import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * «Сообщить о поступлении» на сайте: у товара без остатка кнопка ведёт в бота
 * на этот товар, у товара в наличии кнопки нет.
 */
test("витрина: у товара без остатка кнопка ведёт в бота на этот товар", async ({ page }) => {
  const errors = await watch(page);
  await page.goto(`/s/${F.SHOP_SLUG}/p/${F.SOLDOUT_ID}`);
  await expect(page.getByText("Нет в наличии", { exact: true })).toBeVisible();
  const link = page.getByRole("link", { name: "Сообщить о поступлении", exact: true });
  await expect(link).toHaveAttribute("href", `https://t.me/e2e_shop_bot?start=w_${F.SOLDOUT_ID}`);
  expect(errors).toEqual([]);
});

test("витрина: у товара в наличии кнопки «Сообщить о поступлении» нет", async ({ page }) => {
  await page.goto(`/s/${F.SHOP_SLUG}/p/${F.PRODUCT_ID}`);
  await expect(page.getByRole("button", { name: "🛒 В корзину", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Сообщить о поступлении", exact: true })).toHaveCount(
    0,
  );
});
