import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** А8: быстрый поиск — Ctrl+K на компьютере, кнопка на телефоне; заказ по телефону и номеру, раздел по названию. */
test("быстрый поиск: разделы и заказы", async ({ page }, info) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.ORD19_SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.ORD19_SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);

  const phone = info.project.name === "phone";
  const dialog = page.getByRole("dialog", { name: "Быстрый поиск", exact: true });
  const open = async () => {
    if (phone) await page.getByRole("button", { name: "Поиск", exact: true }).click();
    else await page.keyboard.press("Control+k");
    await expect(dialog).toBeVisible();
  };
  const box = () => dialog.getByPlaceholder(/^Заказ, покупатель, товар или раздел/);

  // Раздел по названию: Enter открывает его.
  await open();
  await box().fill("Категории");
  await expect(dialog.getByRole("button", { name: /^Категории\s*раздел$/ })).toBeVisible();
  await box().press("Enter");
  await expect(page).toHaveURL(/\/admin\/categories$/);

  // Заказ по телефону покупателя.
  await open();
  await box().fill("4445566");
  await dialog.getByRole("button", { name: /Борис К/ }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/orders/${F.ORD19_ORDERS[1][0]}$`));

  // Заказ по номеру.
  await open();
  await box().fill("3");
  await expect(dialog.getByRole("button", { name: /Виктор Л/ })).toBeVisible();
  // Esc закрывает.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(errors).toEqual([]);
});
