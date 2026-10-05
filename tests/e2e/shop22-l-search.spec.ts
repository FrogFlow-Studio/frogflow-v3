import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { openFilters, watch } from "./helpers.ts";

/** Поиск по площадке (Л1): опечатка находит товар и честно об этом говорит; автор находится по названию. */
const S = F.SH20_SHOP;
const P = F.SH20_PRODUCT;

test("«прянк» находит пряник и пишет, что показаны похожие", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/market/search");
  await openFilters(page);
  await page.getByRole("textbox", { name: "Что ищете", exact: true }).fill("прянк");
  await page.getByRole("button", { name: "Найти", exact: true }).click();
  await expect(page.getByRole("heading", { name: P.name, exact: true })).toBeVisible();
  await expect(page.getByTestId("items-fuzzy")).toBeVisible();
  expect(errors).toEqual([]);
});

test("товар находится по названию автора", async ({ page }) => {
  await watch(page);
  await page.goto(`/market/search?q=${encodeURIComponent(S.name.split(" ")[0]!.toLowerCase())}`);
  await expect(page.getByRole("heading", { name: P.name, exact: true })).toBeVisible();
});

test("ничего не нашли — подсказка, не ошибка", async ({ page }) => {
  await watch(page);
  await page.goto("/market/search?q=несуществующеетовар");
  await expect(
    page.getByText("Ничего не нашли. Попробуйте другое слово.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("items-fuzzy")).toHaveCount(0);
});
