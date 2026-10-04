import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** Квиз на витрине: ссылка с главной, два вопроса, подходящий товар; у клиента прежней платформы страницы нет. */
test("витрина: подбор товара по ответам квиза", async ({ page }) => {
  const errors = await watch(page);
  await page.goto(`/s/${F.QUIZ16_SHOP_SLUG}`);
  await page.getByRole("link", { name: "🧩 Подобрать товар", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/s/${F.QUIZ16_SHOP_SLUG}/quiz$`));
  await expect(page.getByText("Подберём десерт за минуту", { exact: true })).toBeVisible();
  await expect(page.getByText("Вопрос 1 из 2", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Шоколад", exact: true }).click();
  await expect(page.getByText("Вопрос 2 из 2", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "День рождения", exact: true }).click();

  await expect(page.getByText("Вот что вам подойдёт", { exact: true })).toBeVisible();
  const card = page.getByRole("link", { name: new RegExp(F.QUIZ16_CAKE_NAME) });
  await expect(card).toHaveCount(1);
  await expect(page.getByRole("link", { name: new RegExp(F.QUIZ16_PIE_NAME) })).toHaveCount(0);
  await card.click();
  await expect(page).toHaveURL(new RegExp(`/s/${F.QUIZ16_SHOP_SLUG}/p/${F.QUIZ16_CAKE_ID}$`));
  expect(errors).toEqual([]);
});

test("витрина клиента прежней платформы: страницы подбора нет", async ({ page }) => {
  const res = await page.goto(`/s/${F.QUIZ16_V1_SHOP_SLUG}/quiz`);
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Магазин не найден", exact: true })).toBeVisible();
});
