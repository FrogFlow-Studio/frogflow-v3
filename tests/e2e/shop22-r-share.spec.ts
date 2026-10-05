import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** Р5: страница «Поделиться»: ссылки, QR, готовые тексты с меткой канала, свои метки. */
test("поделиться: ссылки, QR, тексты и ссылки с меткой", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.SHARE22_SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.SHARE22_SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await page.goto("/admin/share");
  await expect(
    page.getByRole("heading", { name: "Поделиться магазином", exact: true }),
  ).toBeVisible();
  // Витрина и бот: ссылка и QR у каждой.
  const store = page.getByTestId("share-store");
  await expect(store.getByRole("textbox")).toHaveValue(new RegExp(`/s/${F.SHARE22_SHOP_SLUG}$`));
  await expect(store.getByRole("img", { name: "QR-код витрины", exact: true })).toBeVisible();
  const bot = page.getByTestId("share-bot");
  await expect(bot.getByRole("textbox")).toHaveValue(`https://t.me/${F.SHARE22_BOT}`);
  await expect(bot.getByRole("img", { name: "QR-код бота", exact: true })).toBeVisible();

  // Готовые тексты содержат ссылку с меткой канала и называют магазин.
  const ig = page.getByRole("textbox", { name: "Instagram", exact: true });
  await expect(ig).toHaveValue(new RegExp(`${F.SHARE22_SHOP_NAME}[\\s\\S]*utm_source=instagram`));
  const wa = page.getByRole("textbox", { name: "WhatsApp", exact: true });
  await expect(wa).toHaveValue(/utm_source=whatsapp/);
  // Язык текста переключается независимо от языка админки.
  await page.getByRole("combobox").first().selectOption("en");
  await expect(ig).toHaveValue(/Order online/);

  // Своя метка: кириллица переводится в латиницу, ссылки на бота и витрину получают её.
  await page.locator('input[name="share-tag"]').fill("блогер Анна");
  await expect(page.locator('input[value*="src_bloger_anna"]')).toHaveCount(1);
  await expect(page.locator('input[value*="utm_source=bloger_anna"]')).toHaveCount(1);

  // Телефон: без горизонтальной прокрутки.
  const wide = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(wide).toBe(false);
  expect(errors).toEqual([]);
});
