import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** Жалоба на товар (Ш1): ссылка на странице товара ведёт к форме жалобы на этот товар. */
const S = F.SH20_SHOP;
const P = F.SH20_PRODUCT;

test("страница товара площадки: «Пожаловаться на товар» открывает форму жалобы на него", async ({
  page,
}) => {
  const errors = await watch(page);
  await page.goto(`/s/${S.slug}/p/${P.id}`);
  await expect(page.getByRole("heading", { name: P.name, exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Пожаловаться на товар", exact: true }).click();
  await expect(page).toHaveURL(/\/market\/report/);
  await expect(
    page.getByText(`Магазин: ${S.name}. Товар: ${P.name}`, { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(5);
  await expect(page.getByRole("button", { name: "Отправить жалобу", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("товар магазина без согласия на площадку: ссылки на жалобу нет", async ({ page }) => {
  await watch(page);
  await page.goto(`/s/${F.SHOP_SLUG}/p/${F.PRODUCT_ID}`);
  await expect(page.getByRole("button", { name: "🛒 В корзину", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Пожаловаться на товар", exact: true })).toHaveCount(
    0,
  );
});
