import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * «Помощь»: группа в меню (быстрый старт, справочник, «что делать, если»),
 * «?» у заголовка страницы и у переключателя открывают статью сбоку, не уводя
 * со страницы.
 */
test("помощь: пункты меню, «?» у заголовка и у переключателя открывают статью сбоку", async ({
  page,
}) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await page.goto("/admin/help/start");
  await expect(page.getByRole("heading", { name: "Быстрый старт", exact: true })).toBeVisible();
  await page.getByRole("link", { name: /Быстрый старт: от подключения/ }).click();
  await expect(page.getByRole("heading", { name: /Быстрый старт: от подключения/ })).toBeVisible();

  await page.goto("/admin/help/trouble");
  await expect(page.getByRole("link", { name: /Два заказа с одним номером/ })).toBeVisible();

  await page.goto("/admin/settings");
  await page.getByRole("button", { name: "Помощь по этой странице", exact: true }).click();
  const panel = page.getByRole("dialog");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading").first()).toBeVisible();
  await panel.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(panel).toBeHidden();
  await expect(page).toHaveURL(/\/admin\/settings/);

  // «?» в углу карточки настроек открывает статью темы на подзаголовке этой карточки.
  const tip = page.locator('[data-help^="settings-"]:visible').first();
  const anchor = (await tip.getAttribute("data-help"))!.split("#")[1]!;
  await tip.click();
  await expect(page.getByRole("dialog").locator(`#help-${anchor}`)).toBeVisible();
  expect(errors).toEqual([]);
});
