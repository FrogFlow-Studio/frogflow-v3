import { expect, test } from "@playwright/test";
import { watch } from "./helpers.ts";

/** Х2: правила площадки — раздел о жалобах по якорю, на всех языках, без горизонтальной прокрутки. */
test("правила площадки: раздел «Как рассматривается жалоба»", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/market/rules#s7");
  await expect(
    page.getByRole("heading", { name: "7. Как рассматривается жалоба", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#s7")).toContainText("не более 5 жалоб в сутки");
  await page.goto("/market/rules?lang=en#s7");
  await expect(
    page.getByRole("heading", { name: "7. How a report is handled", exact: true }),
  ).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
});
