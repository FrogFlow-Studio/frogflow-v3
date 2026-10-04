import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

async function login(page: import("@playwright/test").Page, user: string, password: string) {
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(user);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

/** А15: центр отчётов — вкладки, период, сравнение, CSV. */
test("отчёты: продажи считают только оплаченное, период и вкладки, CSV", async ({
  page,
  request,
}) => {
  const errors = await watch(page);
  await login(page, F.RPT19_SELLER_LOGIN, F.RPT19_SELLER_PASSWORD);
  await page.goto("/admin/reports");
  await expect(page.getByRole("heading", { name: "Центр отчётов", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Продажи", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  // Выручка 5000 ₸ (неоплаченные 9000 и отклонённый не в счёте).
  await expect(page.getByRole("cell", { name: "5000 ₸", exact: true }).first()).toBeVisible();
  await expect(page.getByText("14000 ₸")).toHaveCount(0);

  await page.getByRole("button", { name: "7 дней", exact: true }).click();
  await expect(page.getByRole("button", { name: "7 дней", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByRole("tab", { name: "Отказы", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Отклонено заказов", exact: true })).toBeVisible();

  // Вкладки «Склад» и «Рассылки» выключенными модулями не показываются.
  await expect(page.getByRole("tab", { name: "Склад", exact: true })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Рассылки", exact: true })).toHaveCount(0);

  const csv = await page.request.get("/api/admin/reports/sales?days=7");
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(await csv.text()).toContain("Выручка");
  expect((await page.request.get("/api/admin/reports/stock?days=7")).status()).toBe(403);
  expect((await request.get("/api/admin/reports/sales?days=7")).status()).toBe(401);
  expect(errors).toEqual([]);
});

test("отчёты: бухгалтер видит продажи, на телефоне без горизонтальной прокрутки", async ({
  page,
}) => {
  const errors = await watch(page);
  await login(page, F.RPT19_ACC_LOGIN, F.RPT19_ACC_PASSWORD);
  await page.goto("/admin/reports");
  await expect(page.getByRole("tab", { name: "Продажи", exact: true })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
});
