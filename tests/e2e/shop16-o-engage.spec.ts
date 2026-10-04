import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * «Рассылки»: карточка «Подбор и „С этим берут“» показывает за 30 дней, сколько прошли квиз
 * и сколько раз добавили товар из допродажи, с числом разных покупателей бота.
 */
test("рассылки: итоги подбора и «С этим берут»", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.ENGAGE16_SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.ENGAGE16_SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await page.goto("/admin/broadcasts");
  const card = page.locator("section.card", { hasText: "Подбор и «С этим берут»" });
  const stats = card.getByTestId("engage-stats");
  await expect(stats).toContainText("Подбор прошли: 3 (разных покупателей в боте: 2)");
  await expect(stats).toContainText("Добавили из «С этим берут»: 2 (разных покупателей в боте: 1)");
  await expect(stats).toContainText("Это не заказы и не выручка");
  expect(errors).toEqual([]);
});
