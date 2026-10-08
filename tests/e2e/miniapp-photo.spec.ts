import { expect, test, type Page } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * Mini App: «Назад» Telegram (Т2), форма фото 4:5 (Т1) и просмотр фото на весь
 * экран (Т6). Telegram подставной: скрипт telegram.org в тестах не грузится,
 * `window.Telegram.WebApp` с BackButton кладётся до загрузки страницы.
 */
const SLUG = F.MINIAPP_SHOP_SLUG;

type TgStub = { visible: boolean; closed: boolean; handlers: Array<() => void> };

async function stubTelegram(page: Page) {
  await page.addInitScript(() => {
    const tg: TgStub = { visible: false, closed: false, handlers: [] };
    (window as unknown as { __tg: TgStub }).__tg = tg;
    (window as unknown as { Telegram: unknown }).Telegram = {
      WebApp: {
        initData: "query_id=e2e&user=%7B%22id%22%3A1%7D&auth_date=1&hash=e2e",
        ready: () => {},
        expand: () => {},
        close: () => {
          tg.closed = true;
        },
        openTelegramLink: () => {},
        colorScheme: "light",
        BackButton: {
          show: () => {
            tg.visible = true;
          },
          hide: () => {
            tg.visible = false;
          },
          onClick: (cb: () => void) => {
            tg.handlers.push(cb);
          },
          offClick: (cb: () => void) => {
            tg.handlers = tg.handlers.filter((h) => h !== cb);
          },
        },
      },
    };
  });
}

const tg = (page: Page) => page.evaluate(() => (window as unknown as { __tg: TgStub }).__tg);
/** Нажатие «Назад» в шапке Telegram (или системной кнопки Android). */
const pressBack = (page: Page) =>
  page.evaluate(() => {
    const t = (window as unknown as { __tg: TgStub }).__tg;
    t.handlers.forEach((h) => h());
  });
/** Страница ожила: обработчик «Назад» подключён (до гидратации клик — обычный переход). */
const hydrated = (page: Page) =>
  expect.poll(async () => (await tg(page)).handlers.length).toBeGreaterThan(0);

test("Т2: поиск → товар → «Назад» Telegram → те же результаты поиска", async ({ page }) => {
  const errors = await watch(page);
  await stubTelegram(page);
  await page.goto(`/s/${SLUG}?q=${encodeURIComponent("Части")}`);
  await hydrated(page);
  // На главной кнопки нет — там Telegram показывает «Закрыть».
  expect((await tg(page)).visible).toBe(false);
  await page.getByRole("link", { name: F.MINIAPP_PRODUCT_NAME, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(F.MINIAPP_PRODUCT_NAME);
  await expect(page.getByTestId("back-to-results")).toHaveText("← Результаты: «Части»");
  await expect.poll(async () => (await tg(page)).visible).toBe(true);
  await pressBack(page);
  await expect(page).toHaveURL(new RegExp(`/s/${SLUG}\\?q=`));
  await expect(page.getByRole("link", { name: F.MINIAPP_PRODUCT_NAME, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: F.MINIAPP_PLAIN_NAME, exact: true })).toHaveCount(0);
  await expect.poll(async () => (await tg(page)).visible).toBe(false);
  expect((await tg(page)).closed).toBe(false);
  expect(errors).toEqual([]);
});

test("Т2: товар по прямой ссылке — «Назад» ведёт в каталог, а не закрывает", async ({ page }) => {
  const errors = await watch(page);
  await stubTelegram(page);
  await page.goto(`/s/${SLUG}/p/${F.MINIAPP_PRODUCT_ID}`);
  await hydrated(page);
  await expect.poll(async () => (await tg(page)).visible).toBe(true);
  await expect(page.getByTestId("back-to-results")).toHaveCount(0);
  await pressBack(page);
  await expect(page).toHaveURL(new RegExp(`/s/${SLUG}/?$`));
  await expect(page.getByRole("link", { name: F.MINIAPP_PLAIN_NAME, exact: true })).toBeVisible();
  expect((await tg(page)).closed).toBe(false);
  expect(errors).toEqual([]);
});

test("Т2: вне Telegram «← Результаты» возвращает к поиску", async ({ page }) => {
  const errors = await watch(page);
  await page.goto(`/s/${SLUG}/p/${F.MINIAPP_PRODUCT_ID}?q=${encodeURIComponent("Части")}`);
  const back = page.getByRole("link", { name: "← Результаты: «Части»", exact: true });
  await expect(back).toBeVisible();
  await back.click();
  await expect(page).toHaveURL(new RegExp(`/s/${SLUG}\\?q=`));
  await expect(page.getByRole("link", { name: F.MINIAPP_PRODUCT_NAME, exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("Т6: тап по фото открывает просмотр, «Назад» Telegram закрывает его, а не страницу", async ({
  page,
}) => {
  const errors = await watch(page);
  await stubTelegram(page);
  await page.goto(`/s/${SLUG}/p/${F.MINIAPP_PRODUCT_ID}`);
  await hydrated(page);
  const viewer = page.getByRole("dialog", { name: "Просмотр фото", exact: true });
  await page.getByRole("button", { name: "Открыть фото целиком", exact: true }).first().click();
  await expect(viewer).toBeVisible();
  await expect(viewer.getByText("1 из 3", { exact: true })).toBeVisible();
  await expect(viewer.getByRole("button", { name: "Закрыть просмотр", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(viewer.getByText("2 из 3", { exact: true })).toBeVisible();
  await pressBack(page);
  await expect(viewer).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/p/${F.MINIAPP_PRODUCT_ID}$`));
  // Пример материала открывается в том же просмотре, а не во внешнем браузере; Esc закрывает.
  await page.getByRole("button", { name: "Открыть пример 1 целиком", exact: true }).click();
  await expect(viewer).toBeVisible();
  await expect(viewer.getByText("1 из 2", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  // Крестик тоже закрывает.
  await page.getByRole("button", { name: "Открыть пример 2 целиком", exact: true }).click();
  await expect(viewer.getByText("2 из 2", { exact: true })).toBeVisible();
  await viewer.getByRole("button", { name: "Закрыть просмотр", exact: true }).click();
  await expect(viewer).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Т1: форма «4:5» — карточки и заглушка без квадрата, фото без обрезки", async ({ page }) => {
  const errors = await watch(page);
  await page.goto(`/s/${SLUG}`);
  const main = page.locator("main");
  await expect(main.getByRole("link", { name: F.MINIAPP_PLAIN_NAME, exact: true })).toBeVisible();
  await expect(main.locator(".aspect-square")).toHaveCount(0);
  // Фото товара и заглушка товара без фото — одной формы 4:5.
  await expect(main.locator("article .aspect-\\[4\\/5\\]")).toHaveCount(2);
  await expect(main.locator("article img.object-contain")).toHaveCount(1);
  await page.goto(`/s/${SLUG}/p/${F.MINIAPP_PRODUCT_ID}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(F.MINIAPP_PRODUCT_NAME);
  await expect(page.locator("main .aspect-square")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Т1: магазин без настройки — карточки квадратные, как раньше", async ({ page }) => {
  const errors = await watch(page);
  await page.goto(`/s/${F.DESIGN_SHOP_SLUG}?q=${encodeURIComponent("свеча")}`);
  await expect(
    page.locator("main article").getByRole("link", { name: F.DESIGN_PRODUCT_NAME, exact: true }),
  ).toBeVisible();
  await expect(page.locator("main article .aspect-square")).toHaveCount(1);
  await expect(page.locator("main .aspect-\\[4\\/5\\]")).toHaveCount(0);
  expect(errors).toEqual([]);
});
