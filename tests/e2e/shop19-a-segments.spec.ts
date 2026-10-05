import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** А14: сегменты покупателей — готовые, свои сохранённые, удаление. */
test("покупатели: сегменты считаются, сохраняются и удаляются", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/customers");
  // desktop и phone идут одновременно на одной базе: имя у каждого своё.
  const mine = `Оптовики ${test.info().project.name}`;

  await page.getByRole("button", { name: "Купили 2+ раза", exact: true }).click();
  await expect(page.getByText(/В сегменте: \d+/)).toBeVisible();
  await page.getByRole("button", { name: "Показать всех покупателей", exact: true }).click();
  await expect(page.getByText(/В сегменте: \d+/)).toHaveCount(0);

  // Свой сегмент по тегу: сохраняется и появляется чипом.
  await page.getByPlaceholder("Название сегмента", { exact: true }).fill(mine);
  await page.getByRole("combobox", { name: "Покупок не меньше", exact: true }).selectOption("tag");
  await page.getByPlaceholder("Значение", { exact: true }).fill("нет-такого-тега-е2е");
  await page.getByRole("button", { name: "Сохранить сегмент", exact: true }).click();
  await expect(page.getByRole("button", { name: mine, exact: true })).toBeVisible();
  await page.getByRole("button", { name: mine, exact: true }).click();
  await expect(page.getByText("В этом сегменте никого нет.", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: `Удалить: ${mine}`, exact: true }).click();
  await expect(page.getByRole("button", { name: mine, exact: true })).toHaveCount(0);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
});
