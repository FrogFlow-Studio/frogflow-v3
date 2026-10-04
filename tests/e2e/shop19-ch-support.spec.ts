import { expect, test, type Page } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** Чат с поддержкой (Ч1): продавец пишет из админки, оператор отвечает во входящих, ответ виден продавцу. */
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

test("поддержка: вопрос продавца, ответ оператора, ответ виден в админке", async ({
  browser,
}, info) => {
  // Два проекта (desktop и phone) идут на одной базе: у каждого свои слова.
  const question = `Не приходят уведомления ${info.project.name} ${Date.now()}`;
  const answer = `Проверим вебхук ${info.project.name} ${Date.now()}`;

  const sellerCtx = await browser.newContext();
  const seller = await sellerCtx.newPage();
  const sellerErrors = await watch(seller);
  await sellerLogin(seller);
  await seller.goto("/admin/support");
  await expect(seller.getByRole("heading", { name: "Поддержка", exact: true })).toBeVisible();
  await seller.getByRole("textbox", { name: "Опишите вопрос или проблему" }).fill(question);
  await seller.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(seller.getByText(question, { exact: true })).toBeVisible();

  const opCtx = await browser.newContext();
  const op = await opCtx.newPage();
  const opErrors = await watch(op);
  await operatorLogin(op);
  await op.goto("/operator/support");
  await op.getByRole("link", { name: new RegExp(F.SHOP_NAME) }).click();
  await expect(op.getByText(question, { exact: true })).toBeVisible();
  await op.getByRole("textbox", { name: "Ответ клиенту" }).fill(answer);
  await op.getByRole("button", { name: "Ответить", exact: true }).click();
  await expect(op.getByText(answer, { exact: true })).toBeVisible();

  await seller.reload();
  await expect(seller.getByText(answer, { exact: true })).toBeVisible();
  // Статус не проверяем: второй проект пишет в то же обращение и может сменить его раньше.
  await expect(seller.getByText(/^Статус обращения: /)).toBeVisible();
  expect(sellerErrors).toEqual([]);
  expect(opErrors).toEqual([]);
  await sellerCtx.close();
  await opCtx.close();
});
