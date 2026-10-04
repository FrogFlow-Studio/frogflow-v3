import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** Меню оператора: на компьютере — четыре группы сбоку, на телефоне — нижняя панель и «Ещё». */
test("меню оператора: группы и переходы", async ({ page }, info) => {
  const errors = await watch(page);
  await page.goto("/operator/login");
  await page.locator('input[name="username"]').fill(F.OPERATOR_LOGIN);
  await page.locator('input[name="password"]').fill(F.OPERATOR_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/operator$/);

  if (info.project.name === "desktop") {
    for (const title of ["Клиенты", "Деньги", "Каналы и вебхуки", "Система"]) {
      await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByRole("navigation", { name: "Быстрые разделы" })).toBeHidden();
    await page.getByRole("link", { name: "Выручка", exact: true }).click();
    await expect(page).toHaveURL(/\/operator\/revenue$/);
    await page.getByRole("link", { name: "Кроны", exact: true }).click();
    await expect(page).toHaveURL(/\/operator\/crons$/);
  } else {
    const bar = page.getByRole("navigation", { name: "Быстрые разделы" });
    await expect(bar).toBeVisible();
    await bar.getByRole("link", { name: "Выручка", exact: true }).click();
    await expect(page).toHaveURL(/\/operator\/revenue$/);
    await bar.getByRole("button", { name: "Ещё", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Все разделы" });
    await expect(sheet.getByText("Каналы и вебхуки", { exact: true })).toBeVisible();
    await sheet.getByRole("link", { name: "Кроны", exact: true }).click();
    await expect(page).toHaveURL(/\/operator\/crons$/);
    await expect(sheet).toBeHidden();
    // Нижняя панель не даёт горизонтальной прокрутки.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  }
  expect(errors).toEqual([]);
});
