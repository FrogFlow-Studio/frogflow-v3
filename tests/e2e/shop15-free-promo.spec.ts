import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { addToCart, watch } from "./helpers.ts";

/**
 * Порог бесплатной доставки 10 000, корзина 10 500: пока промокод не введён, форма
 * говорит «бесплатно»; с введённым промокодом сумму после скидки знает только сервер,
 * поэтому форма «бесплатно» не обещает.
 */
test("сайт: с промокодом подсказка не обещает бесплатную доставку", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "корзина в подставной базе общая для проектов");
  const errors = await watch(page);
  const shop = `/s/${F.FREE15_SHOP_SLUG}`;
  await page.goto(`${shop}/p/${F.FREE15_CAKE_ID}`);
  await addToCart(page);
  await page.goto(`${shop}/checkout`);
  await page.getByRole("radio", { name: "Доставка", exact: true }).check();

  const hint = page.getByTestId("free-delivery-hint");
  await expect(hint).toContainText("Доставка бесплатная");
  await expect(page.getByRole("option", { name: `${F.FREE15_ZONE_NAME} (бесплатно)` })).toHaveCount(
    1,
  );

  await page.locator('input[name="promo"]').fill("SALE1000");
  await expect(hint).toContainText("С промокодом сумма товаров станет меньше");
  await expect(hint).not.toContainText("Доставка бесплатная");
  await expect(
    page.getByRole("option", { name: new RegExp(`${F.FREE15_ZONE_NAME} \\(\\+`) }),
  ).toHaveCount(1);
  expect(errors).toEqual([]);
});
