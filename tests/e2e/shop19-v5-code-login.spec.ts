import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * Вход по коду (В5): на «Моих заказах» без входа есть «Войти по коду»; кнопка даёт
 * ссылку в бот магазина с меткой браузера, код вводится в поле. Кода из бота у
 * браузера нет, поэтому вход не состоялся и понятно сказано, что делать.
 */
test("«Войти по коду»: ссылка в бот с меткой, поле кода, неверный код не пускает", async ({
  page,
}) => {
  const errors = await watch(page);
  await page.goto(`/s/${F.CODELOGIN_SHOP_SLUG}/orders`);
  await page.getByRole("button", { name: "Войти по коду", exact: true }).click();
  const link = page.getByRole("link", { name: "Открыть бота и получить код", exact: true });
  await expect(link).toHaveAttribute(
    "href",
    new RegExp(`^https://t\\.me/${F.CODELOGIN_BOT}\\?start=lg_[A-Za-z0-9_-]{22}$`),
  );
  const input = page.locator('input[name="login-code"]');
  await input.fill("123456");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.getByText("Код не подошёл. Получите новый в боте.")).toBeVisible();
  await expect(page.getByText("Вы вошли:")).toHaveCount(0);
  expect(errors).toEqual([]);
});
