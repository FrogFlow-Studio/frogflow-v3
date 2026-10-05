import { expect, test } from "@playwright/test";
import { watch } from "./helpers.ts";

/** Площадка на телефоне (П4): фильтры панелью снизу, карточки в один столбец, без боковой прокрутки. */
test.describe("[phone] площадка", () => {
  for (const path of ["/market", "/market/search"]) {
    test(`${path}: без горизонтальной прокрутки, фильтры в панели снизу`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== "phone", "только телефон");
      const errors = await watch(page);
      await page.goto(path);
      const open = page.getByRole("button", { name: "Фильтры", exact: true });
      await expect(open).toBeVisible();
      await expect(page.getByTestId("filters")).toBeHidden();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);

      await open.click();
      const panel = page.getByTestId("filters");
      await expect(panel).toBeVisible();
      const box = await panel.boundingBox();
      const vh = page.viewportSize()!.height;
      expect(box!.y + box!.height).toBeGreaterThan(vh - 2);
      await page.getByRole("button", { name: "Закрыть", exact: true }).click();
      await expect(panel).toBeHidden();

      const cards = page.locator("main ul > li");
      if ((await cards.count()) > 1) {
        const a = await cards.nth(0).boundingBox();
        const b = await cards.nth(1).boundingBox();
        expect(Math.abs(a!.x - b!.x)).toBeLessThan(2);
      }
      expect(errors).toEqual([]);
    });
  }
});
