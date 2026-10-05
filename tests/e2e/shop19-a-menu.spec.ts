import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** А1: меню админки группами; на телефоне — нижняя панель из четырёх разделов и «Ещё». */
test("новое меню: группы, нижняя панель на телефоне и «Ещё»", async ({ page }, info) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);

  const phone = info.project.name === "phone";
  if (!phone) {
    const side = page.locator("aside");
    for (const g of ["Продажи", "Каталог", "Маркетинг", "Настройки"])
      await expect(side.getByRole("group", { name: g, exact: true })).toBeVisible();
    await expect(side.getByRole("link", { name: "Заказы", exact: true })).toBeVisible();
    // Нижней панели на компьютере нет.
    await expect(
      page.getByRole("navigation", { name: "Главные разделы", exact: true }),
    ).toBeHidden();
    await side.getByRole("link", { name: "Заказы", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/orders$/);
    return;
  }

  const bar = page.getByRole("navigation", { name: "Главные разделы", exact: true });
  await expect(bar).toBeVisible();
  await expect(bar.getByRole("link")).toHaveCount(4);
  await bar.getByRole("link", { name: "Заказы", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/orders$/);
  await expect(bar.getByRole("link", { name: "Заказы", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  // «Ещё» открывает весь список по группам и закрывается переходом.
  await bar.getByRole("button", { name: "Ещё", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Все разделы", exact: true });
  await expect(sheet.getByRole("group", { name: "Настройки", exact: true })).toBeVisible();
  // Группы свёрнуты, открыта только текущая: «Каталог» раскрываем нажатием.
  await expect(sheet.getByRole("link", { name: "Категории", exact: true })).toBeHidden();
  await sheet.getByRole("button", { name: "Каталог", exact: true }).click();
  await sheet.getByRole("link", { name: "Категории", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/categories$/);
  await expect(sheet).toBeHidden();
  // Горизонтальной прокрутки нет.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
});
