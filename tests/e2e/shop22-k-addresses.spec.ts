import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** К5: сохранённые адреса видит только вошедший; без входа нет ни блока «Мои адреса», ни выбора на оформлении. */
test("сохранённые адреса: без входа их нет ни в «Мои заказы», ни на оформлении, телефон без прокрутки вбок", async ({
  page,
}, info) => {
  const errors = await watch(page);
  await page.setExtraHTTPHeaders({
    "x-forwarded-for": `10.2.${info.project.name === "phone" ? 2 : 1}.${Date.now() % 250}`,
  });
  await page.goto(`/s/${F.DELIVERY_SHOP_SLUG}/orders`);
  await expect(page.getByTestId("my-addresses")).toHaveCount(0);

  await page.goto(`/s/${F.DELIVERY_SHOP_SLUG}`);
  await page.getByRole("button", { name: "В корзину", exact: true }).first().click();
  await page.goto(`/s/${F.DELIVERY_SHOP_SLUG}/cart`);
  await page.getByRole("link", { name: "Оформить на сайте", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/s/${F.DELIVERY_SHOP_SLUG}/checkout$`));
  await expect(page.getByTestId("saved-address")).toHaveCount(0);
  await expect(page.getByLabel("Запомнить этот адрес", { exact: true })).toHaveCount(0);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
});
