import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** Жалоба на магазин (В11): ссылка на каталоге ведёт к форме с названием магазина. */
const S = F.MARKET19_SHOPS;

test("площадка: «Пожаловаться» открывает форму жалобы на этот магазин", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/market");
  await expect(page.getByRole("link", { name: "Пожаловаться", exact: true })).toHaveCount(2);
  await page.locator(`a[href^="/market/report"][href*="shop=${S.cake.slug}"]`).click();
  await expect(page.getByRole("heading", { name: "Пожаловаться", exact: true })).toBeVisible();
  await expect(page.getByText(`Магазин: ${S.cake.name}`, { exact: true })).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(5);
  await expect(page.getByRole("button", { name: "Отправить жалобу", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("жалоба на скрытый магазин и на магазин прежней платформы: формы нет", async ({ page }) => {
  const errors = await watch(page);
  for (const slug of [S.hidden.slug, S.old.slug]) {
    await page.goto(`/market/report?shop=${slug}`);
    await expect(
      page.getByRole("heading", { name: "Магазин не найден", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Отправить жалобу", exact: true })).toHaveCount(
      0,
    );
  }
  expect(errors).toEqual([]);
});
