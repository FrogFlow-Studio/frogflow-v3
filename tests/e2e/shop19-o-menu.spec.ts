import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

test("меню оператора: рабочие области и контекстные разделы", async ({ page }, info) => {
  const errors = await watch(page);
  await page.goto("/operator/login");
  await page.locator('input[name="username"]').fill(F.OPERATOR_LOGIN);
  await page.locator('input[name="password"]').fill(F.OPERATOR_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/operator$/);
  const nav = page.getByRole("navigation", { name: "Рабочие области" });
  await nav.getByRole("link", { name: "Продажи и деньги", exact: true }).click();
  if (info.project.name === "phone") {
    await page
      .getByRole("combobox", { name: "Раздел рабочей области", exact: true })
      .selectOption("/operator/revenue");
  } else {
    await page
      .getByRole("navigation", { name: "Продажи и деньги" })
      .getByRole("link", { name: "Выручка", exact: true })
      .click();
  }
  await expect(page).toHaveURL(/\/operator\/revenue$/);
  await nav.getByRole("link", { name: "Платформа", exact: true }).click();
  if (info.project.name === "phone") {
    await page
      .getByRole("combobox", { name: "Раздел рабочей области", exact: true })
      .selectOption("/operator/crons");
  } else {
    await page
      .getByRole("navigation", { name: "Платформа" })
      .getByRole("link", { name: "Кроны", exact: true })
      .click();
  }
  await expect(page).toHaveURL(/\/operator\/crons$/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);
  expect(errors).toEqual([]);
});
