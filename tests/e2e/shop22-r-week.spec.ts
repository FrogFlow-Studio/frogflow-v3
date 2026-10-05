import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** Р3: «Первые 7 дней» в пустом магазине: четыре пункта, ничего не закрыто, телефон без прокрутки вбок. */
test("первые 7 дней: в пустом магазине четыре открытых пункта", async ({ page }, info) => {
  const shop = F.WEEK22_SHOPS.find((s) => s.project === info.project.name)!;
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(shop.login);
  await page.locator('input[name="password"]').fill(shop.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);

  const list = page.getByTestId("first-week");
  await expect(list).toBeVisible();
  await expect(list.locator("li")).toHaveCount(4);
  await expect(list.locator('li[data-done="1"]')).toHaveCount(0);
  const wide = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(wide).toBe(false);
  expect(errors).toEqual([]);
});
