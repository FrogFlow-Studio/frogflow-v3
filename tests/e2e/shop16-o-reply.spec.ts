import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * Публичный ответ продавца: на витрине он виден под одобренным отзывом и не виден у
 * отзыва на проверке; продавец отвечает публично без личного сообщения и убирает ответ.
 */
const product = `/s/${F.REPLY16_SHOP_SLUG}/p/${F.REPLY16_PRODUCT_ID}`;

test("витрина: ответ магазина под одобренным отзывом, у неодобренного — нет", async ({ page }) => {
  const errors = await watch(page);
  await page.goto(product);
  await expect(page.getByText("Отзыв с ответом", { exact: true })).toBeVisible();
  await expect(page.getByText("Ответ магазина", { exact: true })).toHaveCount(1);
  await expect(page.getByText(F.REPLY16_SHOWN_REPLY, { exact: true })).toBeVisible();
  await expect(page.getByText("Отзыв на проверке", { exact: true })).toHaveCount(0);
  await expect(page.getByText(F.REPLY16_HIDDEN_REPLY, { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("продавец отвечает только на витрине, без сообщения покупателю, и убирает ответ", async ({
  page,
}) => {
  test.skip(test.info().project.name === "phone", "сценарий админки — на десктопе");
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.REPLY16_SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.REPLY16_SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/reviews");

  const card = page.locator(".card", { hasText: "Отзыв без ответа" });
  await card.getByRole("button", { name: "Ответить", exact: true }).click();
  await card.getByRole("textbox").fill("Приходите ещё!");
  await card.getByLabel("Отправить покупателю личным сообщением", { exact: true }).uncheck();
  await card
    .getByLabel("Показать на витрине под отзывом (виден после одобрения отзыва)", { exact: true })
    .check();
  await card.getByRole("button", { name: "Отправить ответ", exact: true }).click();
  await expect(card.getByText("Ваш ответ на витрине:", { exact: true })).toBeVisible();

  await page.goto(product);
  await expect(page.getByText("Приходите ещё!", { exact: true })).toBeVisible();
  await expect(page.getByText("Ответ магазина", { exact: true })).toHaveCount(2);

  await page.goto("/admin/reviews");
  await page
    .locator(".card", { hasText: "Отзыв без ответа" })
    .getByRole("button", { name: "Убрать с витрины", exact: true })
    .click();
  await expect(page.getByText("Приходите ещё!", { exact: true })).toHaveCount(0);
  await page.goto(product);
  await expect(page.getByText("Ответ магазина", { exact: true })).toHaveCount(1);
  expect(errors).toEqual([]);
});
