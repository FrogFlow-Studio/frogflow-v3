import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** «Рассылки» → «Розыгрыши»: итоги выбранного розыгрыша — участники, новые покупатели, подписка, заказы и выручка только по оплаченным. */
test("розыгрыш: итоги в админке считают только оплаченное", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.K8_SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.K8_SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await page.goto("/admin/broadcasts");
  await page.getByRole("button", { name: "Итоги", exact: true }).click();
  const res = page.getByTestId(`giveaway-results-${F.K8_GIVEAWAY_ID}`);
  await expect(res).toContainText("Участников: 3");
  await expect(res).toContainText("Допущено к выбору: 3");
  await expect(res).toContainText("Новых покупателей бота среди участников: 2");
  await expect(res).toContainText("Участвовали с подпиской на канал: 3");
  await expect(res).toContainText("покупателей 2, заказов 2 за 14 дней");
  await expect(res).toContainText(/Выручка: 8\s?000/);
  await expect(res).toContainText("Окно в 14 дней ещё идёт");
  expect(errors).toEqual([]);
});
