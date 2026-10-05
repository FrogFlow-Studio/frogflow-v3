import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** Р2: шаблон магазина по типу в пустом магазине: карточка, применение, категории, карточка уходит. */
test("шаблон магазина: выбор типа создаёт категории, карточка пропадает", async ({
  page,
}, info) => {
  const shop = F.KIND22_SHOPS.find((s) => s.project === info.project.name)!;
  const errors = await watch(page);
  page.on("dialog", (d) => void d.accept());
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(shop.login);
  await page.locator('input[name="password"]').fill(shop.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await page.goto("/admin/products");
  await expect(page.getByTestId("shop-kind-card")).toBeVisible();
  // Телефон: карточка из трёх вариантов не даёт горизонтальной прокрутки.
  const wide = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(wide).toBe(false);

  await page.getByRole("button", { name: /Товары с доставкой/ }).click();
  await expect(page.getByTestId("shop-kind-card")).toHaveCount(0);
  await expect(page.getByRole("option", { name: "Хиты", exact: true })).toHaveCount(1);
  await expect(page.getByRole("option", { name: "Подарки", exact: true })).toHaveCount(1);
  expect(errors).toEqual([]);
});
