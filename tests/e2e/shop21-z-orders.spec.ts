import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** З1/З4/З5: три колонки на компьютере, на телефоне — список и заказ по очереди, без горизонтальной прокрутки. */
test("заказы: три колонки на компьютере, экраны на телефоне", async ({ page }, info) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.ORD19_SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.ORD19_SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await page.goto("/admin/orders");
  const link = page.getByRole("link", { name: /Айгерим Ж/ });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/admin\/orders\/\d+|\/admin\/orders\/[0-9a-f-]+/);
  await expect(page.getByTestId("order-detail")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Деньги", exact: true })).toBeVisible();

  if (info.project.name === "phone") {
    // Открыт заказ: список спрятан, есть путь назад.
    await expect(link).toBeHidden();
    await page.getByRole("link", { name: "← К заказам", exact: true }).click();
    await expect(page.getByRole("link", { name: /Айгерим Ж/ })).toBeVisible();
    await expect(page.getByTestId("order-detail")).toHaveCount(0);
  } else {
    // Компьютер: список остаётся рядом с открытым заказом.
    await expect(link).toBeVisible();
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
});
