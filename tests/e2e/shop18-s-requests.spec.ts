import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * Заявки поставщикам (магазин «Склад С18-З»): остаток на пороге попадает в предложение по
 * поставщику, товар без поставщика — в отдельную группу; заявка создаётся, правится,
 * отмечается «Заказано», скачивается CSV.
 */
test("заявка поставщику: предложение, создание, правка, «заказано», CSV", async ({
  page,
}, info) => {
  const i = info.project.name === "desktop" ? 0 : 1;
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.REQ18_SELLER_LOGINS[i]!);
  await page.locator('input[name="password"]').fill(F.REQ18_SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await page.goto("/admin/warehouse/requests");
  // Группа поставщика и отдельная группа «Без поставщика».
  const supplierCard = page.locator("section.card", { hasText: F.REQ18_SUPPLIER_NAME });
  await expect(supplierCard.getByText(F.REQ18_PRODUCT_NAME, { exact: true })).toBeVisible();
  const looseCard = page.locator("section.card", { hasText: "Без поставщика" });
  await expect(looseCard.getByText(F.REQ18_LOOSE_PRODUCT_NAME, { exact: true })).toBeVisible();
  // Остаток 3, порог 5 → предложено 7 (двойной порог 10 − 3).
  await expect(
    supplierCard.getByLabel(`Количество: ${F.REQ18_PRODUCT_NAME}`, { exact: true }),
  ).toHaveValue("7");

  await supplierCard.getByRole("button", { name: "Создать заявку", exact: true }).click();
  const req = page.locator("section.card", { hasText: "Заявка №1" });
  await expect(req).toBeVisible();
  await expect(req.getByText("Черновик", { exact: true })).toBeVisible();
  // Товар из открытой заявки больше не предлагается.
  await expect(
    page.locator("section.card", { hasText: F.REQ18_SUPPLIER_NAME }).getByRole("button", {
      name: "Создать заявку",
      exact: true,
    }),
  ).toHaveCount(0);

  // Правка количества в черновике.
  await req.getByLabel(`Количество: ${F.REQ18_PRODUCT_NAME}`, { exact: true }).fill("12");
  await req.getByRole("button", { name: "Сохранить количества", exact: true }).click();
  await expect(req.getByRole("button", { name: "Сохранить количества", exact: true })).toHaveCount(
    0,
  );
  await page.reload();
  await expect(
    page
      .locator("section.card", { hasText: "Заявка №1" })
      .getByLabel(`Количество: ${F.REQ18_PRODUCT_NAME}`, { exact: true }),
  ).toHaveValue("12");

  // CSV скачивается кнопкой из браузера.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page
      .locator("section.card", { hasText: "Заявка №1" })
      .getByRole("button", { name: "Скачать CSV", exact: true })
      .click(),
  ]);
  const csv = readFileSync((await download.path())!, "utf8");
  expect(csv).toContain("Товар;Количество");
  expect(csv).toContain(`${F.REQ18_PRODUCT_NAME};12`);

  // «Заказано»: статус меняется, править состав уже нельзя.
  await page
    .locator("section.card", { hasText: "Заявка №1" })
    .getByRole("button", { name: "Отметить заказанной", exact: true })
    .click();
  const ordered = page.locator("section.card", { hasText: "Заявка №1" });
  await expect(ordered.getByText("Заказано", { exact: true })).toBeVisible();
  await expect(
    ordered.getByLabel(`Количество: ${F.REQ18_PRODUCT_NAME}`, { exact: true }),
  ).toHaveCount(0);
  await expect(
    ordered.getByRole("button", { name: "Создать приход по заявке", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
