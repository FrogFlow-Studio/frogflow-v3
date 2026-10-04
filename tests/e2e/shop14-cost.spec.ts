import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * Себестоимость и прибыль (магазин «Мастерская С14»): продавец задаёт себестоимость
 * товара, принимает заказ с оплатой и видит прибыль в аналитике и в CSV.
 */
test("себестоимость: задать, принять оплаченный заказ — прибыль в аналитике и CSV", async ({
  page,
}, info) => {
  const i = info.project.name === "desktop" ? 0 : 1;
  const name = F.COST14_PRODUCT_NAMES[i]!;
  const errors = await watch(page);

  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.COST14_SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.COST14_SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);

  // Себестоимость на странице «Себестоимость»: пусто — «не задана», сохранённое переживает перезагрузку.
  await page.goto("/admin/cost");
  const card = page.locator("section.card", { hasText: name });
  const field = card.getByLabel("Себестоимость, KZT", { exact: true });
  await expect(field).toHaveValue("");
  await expect(field).toHaveAttribute("placeholder", "не задана");
  await field.fill("3000");
  await card.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(card.getByText("Сохранено", { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.locator("section.card", { hasText: name }).getByLabel("Себестоимость, KZT", {
      exact: true,
    }),
  ).toHaveValue("3000");

  // Заказ с чеком принимается с оплатой — это момент продажи (снимок себестоимости).
  const orderId = F.COST14_ORDER_IDS[i]!;
  await page.goto(`/admin/orders/${orderId}`);
  await page.getByRole("button", { name: "✅ Принять заказ", exact: true }).click();
  await expect(page.getByText(`Заказ #${i + 1} принят, записана оплата 8000 KZT`)).toBeVisible();

  // Аналитика: прибыль по товару = 8000 − 3000, маржа 62,5 %.
  await page.goto("/admin/analytics?days=30");
  await expect(page.getByRole("heading", { name: "Прибыль по товарам" })).toBeVisible();
  const row = page.locator("tr", { hasText: name });
  await expect(row).toContainText("8000 ₸");
  await expect(row).toContainText("3000 ₸");
  await expect(row).toContainText("5000 ₸");
  await expect(row).toContainText(/62[.,]5%/);
  await expect(
    page.getByText(
      "вместе с оплаченной покупателем доставкой; расходы на доставку, комиссии платёжных систем и реклама не вычтены",
      { exact: false },
    ),
  ).toBeVisible();

  // CSV для Excel (скачивается кнопкой из браузера, с его сессией): BOM, «;», строка товара.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Скачать CSV «Прибыль по товарам»", exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^profit-30d-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = readFileSync((await download.path())!, "utf8");
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  expect(csv).toContain(`${name};KZT;1;8000;3000;5000;62.5;;`);
  expect(csv).toContain("расходы на доставку, комиссии платёжных систем и реклама не вычтены");
  expect(errors).toEqual([]);
});
