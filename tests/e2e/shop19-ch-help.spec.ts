import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** Помощь (Ч10): поиск по синониму, статья со ссылками, подсказка в чате поддержки. */
test("помощь: поиск по синониму, статья, подсказка в чате поддержки", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await page.goto("/admin/help");
  await expect(page.getByRole("heading", { name: "Помощь", exact: true })).toBeVisible();
  await page.getByRole("searchbox", { name: "Поиск по статьям" }).fill("каспи");
  await expect(page.getByRole("link", { name: "Как принять оплату", exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Как подключить Instagram", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Как принять оплату", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Как принять оплату", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("list")
      .getByRole("listitem")
      .getByRole("link", { name: "Оплата и настройки", exact: true }),
  ).toBeVisible();

  await page.goto("/admin/support");
  await page
    .getByRole("textbox", { name: "Опишите вопрос или проблему" })
    .fill("Бот не отвечает на сообщения покупателей");
  await expect(page.getByText("Возможно, вам поможет:")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Почему бот не отвечает", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
