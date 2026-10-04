import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** Страница итогов розыгрыша: пока идёт приём — условия и число участников; после выбора — победитель со скрытым именем, зерно и хеш. */
test("розыгрыш: страница до итогов", async ({ page }) => {
  const errors = await watch(page);
  await page.goto(`/s/${F.K18_SHOP_SLUG}/giveaway/${F.K18_OPEN_ID}`);
  await expect(page.getByRole("heading", { name: F.K18_OPEN_TITLE, exact: true })).toBeVisible();
  await expect(page.getByText("Набор открыток", { exact: true })).toBeVisible();
  await expect(page.getByText("Нажмите кнопку в боте", { exact: true })).toBeVisible();
  await expect(page.getByText("Участников: 2 · Победителей: 1", { exact: true })).toBeVisible();
  await expect(page.getByText(/^Приём участников идёт/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Победители", exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("розыгрыш: страница после итогов", async ({ page }) => {
  const errors = await watch(page);
  await page.goto(`/s/${F.K18_SHOP_SLUG}/giveaway/${F.K18_DRAWN_ID}`);
  await expect(page.getByRole("heading", { name: F.K18_DRAWN_TITLE, exact: true })).toBeVisible();
  await expect(page.getByText("Участников: 3 · Победителей: 1", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Победители", exact: true })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: F.K18_WINNER_MASK })).toHaveCount(1);
  await expect(page.getByText(F.K18_WINNER_FIRST_NAME)).toHaveCount(0);
  await expect(page.getByText(F.K18_SEED, { exact: true })).toBeVisible();
  await expect(page.getByText(F.K18_HASH, { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("розыгрыш клиента прежней платформы и чужой id: страницы нет", async ({ page }) => {
  const v1 = await page.goto(`/s/${F.K18_V1_SHOP_SLUG}/giveaway/${F.K18_OPEN_ID}`);
  expect(v1?.status()).toBe(404);
  const none = await page.goto(`/s/${F.K18_SHOP_SLUG}/giveaway/nonexist`);
  expect(none?.status()).toBe(404);
});
