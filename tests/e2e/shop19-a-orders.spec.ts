import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** А3: заказы на телефоне — карточки вместо таблицы, фильтры-чипы, поиск по телефону, без горизонтальной прокрутки. */
test("список заказов: карточки на телефоне, чипы и поиск", async ({ page }, info) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.ORD19_SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.ORD19_SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/orders");
  await expect(page.getByRole("heading", { name: "Заказы", exact: true })).toBeVisible();

  const seen = (n: string) => page.getByText(n).filter({ visible: true });
  const phone = info.project.name === "phone";
  // Видна ровно одна форма списка: таблица на компьютере, карточки на телефоне.
  await expect(page.getByRole("table")).toHaveCount(phone ? 0 : 1);
  await expect(page.getByRole("link", { name: /Айгерим Ж/ })).toHaveCount(phone ? 1 : 0);
  if (!phone) await expect(page.getByRole("cell", { name: /Айгерим Ж/ })).toBeVisible();

  // Чип статуса оставляет только свой заказ.
  const filters = page.getByRole("group", { name: "Фильтр по статусу", exact: true });
  await filters.getByRole("link", { name: /^Выдан/ }).click();
  await expect(page).toHaveURL(/status=delivered/);
  await expect(seen("Виктор Л").first()).toBeVisible();
  await expect(seen("Айгерим Ж")).toHaveCount(0);

  // Поиск по телефону.
  await page.goto("/admin/orders");
  await page.getByPlaceholder("№, имя, телефон").fill("4445566");
  await page.getByRole("button", { name: "Найти", exact: true }).click();
  await expect(page).toHaveURL(/q=%224445566%22/);
  await expect(seen("Борис К").first()).toBeVisible();
  await expect(seen("Айгерим Ж")).toHaveCount(0);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
});
