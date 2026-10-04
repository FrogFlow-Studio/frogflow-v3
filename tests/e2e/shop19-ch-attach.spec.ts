import { expect, test, type Page } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** Вложения и контекст в чате поддержки (Ч3): скриншот и страница видны продавцу и оператору. */
// Минимальный PNG 1×1.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function sellerLogin(page: Page) {
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

async function operatorLogin(page: Page) {
  await page.goto("/operator/login");
  await page.locator('input[name="username"]').fill(F.OPERATOR_LOGIN);
  await page.locator('input[name="password"]').fill(F.OPERATOR_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/operator$/);
}

test("поддержка: скриншот и страница-источник доходят до оператора", async ({ browser }, info) => {
  const question = `Скриншот ${info.project.name} ${Date.now()}`;

  const sellerCtx = await browser.newContext();
  const seller = await sellerCtx.newPage();
  const sellerErrors = await watch(seller);
  await sellerLogin(seller);
  await seller.goto("/admin/support?from=/admin/products");
  await expect(seller.getByText("/admin/products", { exact: false }).first()).toBeVisible();
  await seller.getByLabel("Прикрепить скриншот", { exact: true }).setInputFiles({
    name: "shot.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await expect(seller.getByText("shot.png", { exact: true })).toBeVisible();
  await seller.getByRole("textbox", { name: "Опишите вопрос или проблему" }).fill(question);
  await seller.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(seller.getByText(question, { exact: true })).toBeVisible();
  await expect(seller.getByAltText("Скриншот к сообщению").last()).toBeVisible();

  const opCtx = await browser.newContext();
  const op = await opCtx.newPage();
  const opErrors = await watch(op);
  await operatorLogin(op);
  await op.goto("/operator/support");
  await op.getByRole("link", { name: new RegExp(F.SHOP_NAME) }).click();
  await expect(op.getByText(question, { exact: true })).toBeVisible();
  await expect(op.getByAltText("Скриншот").last()).toBeVisible();
  await expect(op.getByText("/admin/products", { exact: false }).first()).toBeVisible();
  expect(sellerErrors).toEqual([]);
  expect(opErrors).toEqual([]);
  await sellerCtx.close();
  await opCtx.close();
});
