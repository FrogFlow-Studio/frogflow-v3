import { expect, test } from "@playwright/test";
import { watch } from "./helpers.ts";

/** В12: страница правил площадки на четырёх языках, со ссылкой из каталога. */
test("правила площадки открываются на четырёх языках", async ({ page }) => {
  const errors = await watch(page);
  const titles = {
    ru: "Правила площадки FrogFlow",
    kk: "FrogFlow алаңының ережелері",
    en: "FrogFlow marketplace rules",
    uz: "FrogFlow maydoni qoidalari",
  } as const;
  for (const [lang, title] of Object.entries(titles)) {
    await page.goto(`/market/rules?lang=${lang}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    await expect(page.getByRole("heading", { level: 2 })).toHaveCount(6);
  }
  expect(errors).toEqual([]);
});

test("из каталога площадки есть ссылка на правила", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/market");
  await page.getByRole("link", { name: "Правила площадки", exact: true }).click();
  await expect(page).toHaveURL(/\/market\/rules$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Правила площадки FrogFlow");
  expect(errors).toEqual([]);
});
