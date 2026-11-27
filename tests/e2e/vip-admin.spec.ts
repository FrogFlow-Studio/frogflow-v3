import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * Раздел VIP в панели продавца: над списком подписчиков видно, сколько людей
 * в группе по Telegram и сколько с действующей подпиской.
 */
test("VIP: счётчик людей в группе над подписчиками", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.VIP_SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.VIP_SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await page.goto("/admin/vip");
  const counts = page.getByTestId("vip-member-counts");
  // Группа указана и бот подключён — счётчик Telegram показан (подставной
  // Telegram числа не знает, поэтому «—»), подписки считаются из базы.
  await expect(counts.getByText(/^В группе: /)).toBeVisible();
  await expect(counts.getByText(/^С действующей подпиской: \d+$/)).toBeVisible();
  expect(errors).toEqual([]);
});
