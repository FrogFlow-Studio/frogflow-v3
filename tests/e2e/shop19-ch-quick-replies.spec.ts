import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** Быстрые ответы оператора (Ч4): кнопка вставляет текст с именем магазина в поле ответа, ничего не отправляя. */
test("быстрый ответ вставляется в поле с именем магазина", async ({ browser }, info) => {
  const question = `Не работает оплата ${info.project.name} ${Date.now()}`;

  const sellerCtx = await browser.newContext();
  const seller = await sellerCtx.newPage();
  const sellerErrors = await watch(seller);
  await seller.goto("/admin/login");
  await seller.locator('input[name="username"]').fill(F.SELLER_LOGIN);
  await seller.locator('input[name="password"]').fill(F.SELLER_PASSWORD);
  await seller.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(seller).toHaveURL(/\/admin$/);
  await seller.goto("/admin/support");
  await seller.getByRole("textbox", { name: "Опишите вопрос или проблему" }).fill(question);
  await seller.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(seller.getByText(question, { exact: true })).toBeVisible();

  const opCtx = await browser.newContext();
  const op = await opCtx.newPage();
  const opErrors = await watch(op);
  await op.goto("/operator/login");
  await op.locator('input[name="username"]').fill(F.OPERATOR_LOGIN);
  await op.locator('input[name="password"]').fill(F.OPERATOR_PASSWORD);
  await op.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(op).toHaveURL(/\/operator$/);
  await op.goto("/operator/support");
  await op.getByRole("link", { name: new RegExp(F.SHOP_NAME) }).click();
  await expect(op.getByText(question, { exact: true })).toBeVisible();
  const box = op.getByRole("textbox", { name: "Ответ клиенту" });
  await op.getByRole("button", { name: "Приняли в работу", exact: true }).click();
  await expect(box).toHaveValue(new RegExp(F.SHOP_NAME));
  // Вставка не отправляет: сообщения оператора в переписке ещё нет.
  await expect(op.getByRole("button", { name: "Ответить", exact: true })).toBeEnabled();
  expect(sellerErrors).toEqual([]);
  expect(opErrors).toEqual([]);
  await opCtx.close();
  await sellerCtx.close();
});
