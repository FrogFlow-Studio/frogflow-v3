import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** А16: заказы к сборке на сегодня — выбор, упаковочные листы, этикетки, «Отметить собранными». */
test("сборка пачкой: фильтр, листы, этикетки, отметка «собрано»", async ({ page }, info) => {
  test.skip(info.project.name === "phone", "выбор строк — в таблице на компьютере");
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.BATCH_SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.BATCH_SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await page.goto("/admin/orders");
  await page.getByRole("link", { name: "К сборке сегодня", exact: true }).click();
  await expect(page).toHaveURL(/assembly=today/);
  // Сегодняшних три; заказ на завтра в этот список не входит.
  await expect(page.getByRole("link", { name: /Сборка Анна/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Сборка Вера/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Сборка Глеб/ })).toHaveCount(0);

  await page.getByRole("checkbox", { name: "Выбрать все заказы на странице", exact: true }).check();
  const bar = page.getByRole("region", { name: "Выбрано: 3", exact: true });
  await expect(bar).toBeVisible();

  // Упаковочные листы: по листу на заказ, цен нет.
  const slips = await page.context().newPage();
  const href = await bar
    .getByRole("link", { name: "Упаковочные листы", exact: true })
    .getAttribute("href");
  await slips.goto(href!);
  await expect(slips.getByRole("heading", { name: "Упаковочный лист", exact: true })).toHaveCount(
    3,
  );
  await expect(slips.getByText("5000")).toHaveCount(0);

  // Этикетки: только доставка (Анна и Борис), самовывоз Веры посчитан отдельно.
  const labelsHref = await bar
    .getByRole("link", { name: "Этикетки доставки", exact: true })
    .getAttribute("href");
  await slips.goto(labelsHref!);
  await expect(slips.getByText("ул. Сборочная, 1")).toBeVisible();
  await expect(slips.getByText("Без этикеток: 1 (самовывоз или не указан адрес).")).toBeVisible();
  await slips.close();

  // Отметить собранными: заказы становятся «Готов»; в этом списке (принят, сегодня) их больше нет.
  page.once("dialog", (d) => void d.accept());
  await bar.getByRole("button", { name: "Отметить собранными", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Собрано: 3");
  await expect(page.getByRole("link", { name: /Сборка Анна/ })).toHaveCount(0);

  // Заказ на завтра не тронут: он по-прежнему принят.
  await page.goto("/admin/orders?status=accepted");
  await expect(page.getByRole("link", { name: /Сборка Глеб/ })).toBeVisible();
  expect(errors).toEqual([]);
});
