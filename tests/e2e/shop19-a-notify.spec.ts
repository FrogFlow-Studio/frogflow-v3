import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

async function login(page: import("@playwright/test").Page, user: string, password: string) {
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(user);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

/** А12: центр уведомлений — лента событий магазина, фильтр, «прочитано». */
test("уведомления: лента, чужое не видно, прочитано", async ({ page }, info) => {
  const errors = await watch(page);
  await login(page, F.ntf19StaffLogin(info.project.name), F.NTF19_STAFF_PASSWORD);
  await page.goto("/admin/notifications");
  await expect(page.getByRole("heading", { name: "Уведомления", exact: true })).toBeVisible();
  await expect(page.getByText("Новый заказ №1", { exact: true })).toBeVisible();
  await expect(page.getByText("Чек на проверке: заказ №2", { exact: true })).toBeVisible();
  await expect(page.getByText("Возврат по заказу №1", { exact: true })).toBeVisible();
  await expect(page.getByText("Новый отзыв: 5 из 5", { exact: true })).toBeVisible();
  // Заказ другого магазина (№1 «Айгерим Ж») сюда не попадает: «Новый заказ №1» один.
  await expect(page.getByText("Новый заказ №1", { exact: true })).toHaveCount(1);

  await page.getByRole("button", { name: "Отзывы", exact: true }).click();
  await expect(page.getByText("Новый заказ №1", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Все", exact: true }).click();

  await expect(page.getByText("Новое", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Отметить всё прочитанным", exact: true }).click();
  await expect(page.getByText("Новое", { exact: true })).toHaveCount(0);

  await page.getByRole("link", { name: /Возврат по заказу №1/ }).click();
  await expect(page).toHaveURL(/\/admin\/orders\/98951/);
  expect(errors).toEqual([]);
});

test("уведомления: бухгалтер без отзывов и без имён покупателей", async ({ page }) => {
  const errors = await watch(page);
  await login(page, F.NTF19_ACC_LOGIN, F.NTF19_ACC_PASSWORD);
  await page.goto("/admin/notifications");
  await expect(page.getByText("Новый заказ №1", { exact: true })).toBeVisible();
  await expect(page.getByText("Новый отзыв: 5 из 5")).toHaveCount(0);
  await expect(page.getByText(F.NTF19_BUYER)).toHaveCount(0);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
});
