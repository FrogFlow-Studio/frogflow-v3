import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * В1: витрина на телефоне — липкая корзина внизу и фильтры в выезжающей панели.
 * Только проект phone: на компьютере этих элементов нет.
 */
test("телефон: липкая корзина появляется после добавления товара и ведёт в корзину", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "phone", "только телефон");
  const errors = await watch(page);
  await page.goto(`/s/${F.SHOP_SLUG}`);
  await expect(page.getByTestId("mobile-cart-bar")).toHaveCount(0);
  await page.getByRole("button", { name: "В корзину", exact: true }).first().click();
  const bar = page.getByTestId("mobile-cart-bar");
  await expect(bar).toBeVisible();
  await bar.click();
  await expect(page).toHaveURL(new RegExp(`/s/${F.SHOP_SLUG}/cart$`));
  // В самой корзине нижняя плашка не нужна.
  await expect(page.getByTestId("mobile-cart-bar")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("телефон: фильтры открываются панелью снизу и закрываются", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "только телефон");
  const errors = await watch(page);
  await page.goto(`/s/${F.SHOP_SLUG}`);
  const open = page.getByRole("button", { name: /Фильтры/ });
  await expect(open).toBeVisible();
  await expect(page.getByRole("button", { name: "Применить", exact: true })).toBeHidden();
  await open.click();
  await expect(page.getByRole("button", { name: "Применить", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(page.getByRole("button", { name: "Применить", exact: true })).toBeHidden();
  expect(errors).toEqual([]);
});

test("телефон: «Написать магазину» на товаре ведёт в бот магазина", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "только телефон");
  const errors = await watch(page);
  await page.goto(`/s/${F.SHOP_SLUG}/p/${F.PRODUCT_ID}`);
  const write = page.getByRole("link", { name: "Написать магазину", exact: true });
  await expect(write).toHaveAttribute("href", /^https:\/\//);
  expect(errors).toEqual([]);
});
