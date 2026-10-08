import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** А6: массовые действия — «выбрать все по фильтру» берёт и то, что не дочитано страницами; итог «изменено / не изменено». */
test("товары: выбрать все по фильтру и скрыть пачкой", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "общий магазин: достаточно одного прогона");
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.ORD19_SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.ORD19_SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/products");

  // На странице 100 строк из 120+: остальные видны только по «Показать ещё».
  await page.getByLabel("Выбрать: Партия 001", { exact: true }).check();
  await expect(page.getByText(/^Выбрано: 1 из \d+$/)).toBeVisible();
  // Акция берёт не больше 20 товаров, при одном — доступна.
  await expect(page.getByRole("button", { name: "Создать акцию", exact: true })).toBeEnabled();

  await page.getByRole("button", { name: /^Выбрать все \d+ по фильтру$/ }).click();
  const sel = page.getByText(/^Выбрано: (\d+) из (\d+)$/);
  // «Выбрано: 1 из N» видно и до ответа сервера: ждём, пока выбор станет полным.
  await expect(sel).toHaveText(/^Выбрано: (\d+) из \1$/);
  const [picked = 0, total = 0] = (await sel.textContent())!.match(/\d+/g)!.map(Number);
  expect(picked).toBe(total);
  expect(total).toBeGreaterThanOrEqual(F.ORD19_BULK_COUNT);
  await expect(page.getByRole("button", { name: "Создать акцию", exact: true })).toBeDisabled();

  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Скрыть (в архив)", exact: true }).click();
  const res = page.getByText(/^Изменено: \d+, пропущено: \d+$/);
  await expect(res).toBeVisible();
  const [changed = 0, skipped = 0] = (await res.textContent())!.match(/\d+/g)!.map(Number);
  // Каждый выбранный товар учтён: изменён или пропущен с причиной.
  expect(changed + skipped).toBe(total);
  expect(changed).toBeGreaterThanOrEqual(F.ORD19_BULK_COUNT);
  expect(errors).toEqual([]);
});
