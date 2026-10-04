import { expect, test } from "@playwright/test";
import { watch } from "./helpers.ts";

/** Аккаунт покупателя площадки (В17): без входа страница зовёт войти через магазин, ничего не показывая. */
test("«Мои заказы» на площадке без входа: подсказка, чужих заказов нет", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/market");
  await page.getByRole("link", { name: "Мои заказы", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Мои заказы во всех магазинах");
  await expect(page.getByText("Войдите через любой магазин площадки")).toBeVisible();
  await expect(page.getByRole("button", { name: "Выйти", exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("«Мои заказы» на казахском", async ({ page }) => {
  await watch(page);
  await page.goto("/market/account?lang=kk");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Барлық дүкендегі тапсырыстарым",
  );
});
