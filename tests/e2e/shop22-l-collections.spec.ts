import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** Подборки площадки (Л3): опубликованная видна на главной площадки, черновик — нет. */
const C = F.SH22_COLLECTION;
const P = F.SH20_PRODUCT;

test("на главной площадки есть опубликованная подборка с товаром, черновика нет", async ({
  page,
}) => {
  const errors = await watch(page);
  await page.goto("/market");
  const block = page.getByTestId(`collection-${C.id}`);
  await expect(block.getByRole("heading", { name: C.title, exact: true })).toBeVisible();
  await expect(block.getByRole("link", { name: P.name, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Черновик Л3", exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("[phone] подборка без горизонтальной прокрутки", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "только телефон");
  await watch(page);
  await page.goto("/market");
  await expect(page.getByTestId(`collection-${C.id}`)).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
