import { expect, test, type Page } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * Чат админки: окно ответа 24 часа. WhatsApp вне окна — подсказка, что сообщение
 * уйдёт одобренным шаблоном; в Telegram окна нет и подсказки тоже.
 */
async function openChat(page: Page, name: string) {
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/chat");
  await page.getByRole("button", { name }).click();
}

test("чат: WhatsApp вне окна 24 часов — подсказка о шаблоне", async ({ page }) => {
  const errors = await watch(page);
  await openChat(page, F.CHAT_WA_NAME);
  await expect(page.getByText("окно 24 часа закрыто").first()).toBeVisible();
  await expect(page.getByText(`одобренным шаблоном «${F.CHAT_WA_TEMPLATE}»`)).toBeVisible();
  expect(errors).toEqual([]);
});

test("чат: Telegram — окна и подсказки нет", async ({ page }) => {
  const errors = await watch(page);
  await openChat(page, F.CHAT_TG_NAME);
  await expect(page.getByText("Здравствуйте, есть в наличии?").first()).toBeVisible();
  await expect(page.getByText("окно 24 часа закрыто")).toHaveCount(0);
  await expect(page.getByText("одобренным шаблоном")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("чат: длинная переписка — «Показать раньше» подгружает начало", async ({ page }) => {
  const errors = await watch(page);
  await openChat(page, F.CHAT_LONG_NAME);
  await expect(page.getByText(`Сообщение ${F.CHAT_LONG_COUNT - 1}`, { exact: true })).toBeVisible();
  await expect(page.getByText(F.CHAT_LONG_FIRST, { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Показать раньше", exact: true }).click();
  await expect(page.getByText(F.CHAT_LONG_FIRST, { exact: true })).toHaveCount(1);
  // Вся история загружена — кнопки больше нет.
  await expect(page.getByRole("button", { name: "Показать раньше", exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
