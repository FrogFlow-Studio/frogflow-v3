import { expect, test, type Page } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * Т3, Т4 пожеланий Кристины: из карточки «Назад» ведёт в список на то же место (с
 * догруженным «Показать ещё»), между материалами листают стрелками и свайпом.
 */
const catalog = `/s/${F.LIST23_SHOP_SLUG}`;
const card = (page: Page, n: number) => page.locator(`[data-product-card="${F.list23Id(n)}"]`);
const title = (page: Page, n: number) =>
  page.getByRole("heading", { level: 1, name: F.list23Name(n), exact: true });

/** Клики до гидратации уходят обычной ссылкой — ждём, пока React возьмёт страницу. */
async function hydrated(page: Page, selector: string) {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactFiber"));
  }, selector);
}

test("«Показать ещё» → материал → «Назад»: список целиком и прокручен к нему", async ({ page }) => {
  const errors = await watch(page);
  await page.goto(catalog);
  await hydrated(page, "[data-product-card]");
  await expect(page.locator("[data-product-card]")).toHaveCount(48);
  await page.getByRole("link", { name: "Показать ещё", exact: true }).click();
  await expect(page.locator("[data-product-card]")).toHaveCount(F.LIST23_COUNT);

  await card(page, 50)
    .getByRole("link", { name: F.list23Name(50), exact: true })
    .click();
  await expect(title(page, 50)).toBeVisible();
  await page.goBack();

  await expect(page).toHaveURL(new RegExp(`${catalog}$`));
  await expect(page.locator("[data-product-card]")).toHaveCount(F.LIST23_COUNT);
  await expect(card(page, 50)).toBeInViewport();
  expect(errors).toEqual([]);
});

test("стрелка «›»: следующий материал, адрес заменён, «Назад» — в список на нём", async ({
  page,
}) => {
  const errors = await watch(page);
  await page.goto(catalog);
  await hydrated(page, "[data-product-card]");
  await card(page, 20)
    .getByRole("link", { name: F.list23Name(20), exact: true })
    .click();
  await expect(title(page, 20)).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Листать товары списка", exact: true });
  await expect(nav).toContainText("20 из 48+");

  await nav.getByRole("button", { name: "Следующий товар", exact: true }).click();
  await expect(title(page, 21)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/p/${F.list23Id(21)}$`));
  await expect(nav).toContainText("21 из 48+");
  await nav.getByRole("button", { name: "Следующий товар", exact: true }).click();
  await expect(title(page, 22)).toBeVisible();
  await nav.getByRole("button", { name: "Предыдущий товар", exact: true }).click();
  await expect(title(page, 21)).toBeVisible();

  // Три листания — один шаг истории: «Назад» сразу в каталог, на 21-м.
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${catalog}$`));
  await expect(card(page, 21)).toBeInViewport();
  expect(errors).toEqual([]);
});

test("последний загруженный: «›» догружает следующую страницу списка", async ({ page }) => {
  const errors = await watch(page);
  await page.goto(catalog);
  await hydrated(page, "[data-product-card]");
  await card(page, 48)
    .getByRole("link", { name: F.list23Name(48), exact: true })
    .click();
  await expect(title(page, 48)).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Листать товары списка", exact: true });
  await nav.getByRole("button", { name: "Следующий товар", exact: true }).click();
  await expect(title(page, 49)).toBeVisible();
  await expect(nav).toContainText(`49 из ${F.LIST23_COUNT}`);
  await nav.getByRole("button", { name: "Следующий товар", exact: true }).click();
  await expect(title(page, 50)).toBeVisible();
  // Конец списка: дальше некуда.
  await expect(nav.getByRole("button", { name: "Следующий товар", exact: true })).toBeDisabled();

  // Вернулись — догруженное на месте, прокручено к 50-му.
  await page.goBack();
  await expect(page.locator("[data-product-card]")).toHaveCount(F.LIST23_COUNT);
  await expect(card(page, 50)).toBeInViewport();
  expect(errors).toEqual([]);
});

test("прямая ссылка на материал — стрелок нет", async ({ page }) => {
  const errors = await watch(page);
  await page.goto(`${catalog}/p/${F.list23Id(5)}`);
  await hydrated(page, "h1");
  await expect(title(page, 5)).toBeVisible();
  await expect(page.getByTestId("list-nav")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("телефон: свайп влево по описанию — следующий материал, вправо — предыдущий", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "phone", "только телефон");
  const errors = await watch(page);
  await page.goto(catalog);
  await hydrated(page, "[data-product-card]");
  await card(page, 3)
    .getByRole("link", { name: F.list23Name(3), exact: true })
    .click();
  await expect(title(page, 3)).toBeVisible();
  await hydrated(page, "[data-testid=list-swipe]");

  const swipe = (dx: number, dy = 0) =>
    page.getByTestId("list-swipe").evaluate(
      (el, { dx, dy }) => {
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + 40;
        const at = (cx: number, cy: number) =>
          new Touch({ identifier: 1, target: el, clientX: cx, clientY: cy });
        const s = at(x, y);
        const e = at(x + dx, y + dy);
        el.dispatchEvent(
          new TouchEvent("touchstart", { bubbles: true, touches: [s], changedTouches: [s] }),
        );
        el.dispatchEvent(
          new TouchEvent("touchend", { bubbles: true, touches: [], changedTouches: [e] }),
        );
      },
      { dx, dy },
    );

  await swipe(-120);
  await expect(title(page, 4)).toBeVisible();
  // Почти вертикальное движение — это прокрутка, не листание.
  await swipe(-70, 120);
  await expect(title(page, 4)).toBeVisible();
  await swipe(120);
  await expect(title(page, 3)).toBeVisible();
  expect(errors).toEqual([]);
});
