import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** Ленты площадки (Л2): «Новинки» без запроса и «Недавно смотрели» после открытого товара. */
const S = F.SH20_SHOP;
const P = F.SH20_PRODUCT;

test("без запроса на «Все товары» есть «Новинки» с товаром магазина", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/market/search");
  const fresh = page.getByTestId("feed-fresh");
  await expect(fresh.getByRole("heading", { name: "Новинки", exact: true })).toBeVisible();
  await expect(fresh.getByRole("link", { name: P.name, exact: true })).toBeVisible();
  // Часто покупают пусто: выданных заказов в сиде нет, пустая лента не рисуется.
  await expect(page.getByTestId("feed-popular")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("«Недавно смотрели»: открытый товар появляется на площадке, список только в браузере", async ({
  page,
}) => {
  await watch(page);
  await page.goto(`/s/${S.slug}/p/${P.id}`);
  await expect(page.getByRole("heading", { name: P.name, exact: true }).first()).toBeVisible();
  await page.goto("/market/search");
  const recent = page.getByTestId("feed-recent");
  await expect(
    recent.getByRole("heading", { name: "Недавно смотрели", exact: true }),
  ).toBeVisible();
  await expect(recent.getByRole("link", { name: P.name, exact: true })).toBeVisible();
});

test("[phone] ленты без горизонтальной прокрутки", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "только телефон");
  await watch(page);
  await page.goto("/market/search");
  await expect(page.getByTestId("feed-fresh")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
