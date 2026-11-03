import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";

/**
 * Страница курса на сайте (03.11.2026, первый пример — Lash Academy): шапка с
 * кнопками покупки, блоки продавца в его порядке, программа по модулям.
 * Курс без записи выглядит как раньше. База — подставная (seed/course-landing.ts).
 */
test("страница курса: шапка, кнопки, блоки по порядку, программа по модулям", async ({ page }) => {
  await page.goto(`/s/${F.LANDING_SHOP_SLUG}/p/${F.LANDING_COURSE_ID}`);
  const hero = page.getByTestId("course-landing-hero");
  await expect(
    hero.getByRole("heading", { level: 1, name: "Ресницы с нуля Л1", exact: true }),
  ).toBeVisible();
  await expect(hero.getByText("Три урока в двух модулях")).toBeVisible();
  await expect(hero.getByRole("link", { name: "Купить в Telegram", exact: true })).toHaveAttribute(
    "href",
    `https://t.me/${F.LANDING_BOT_USERNAME}?start=p_${F.LANDING_COURSE_ID}`,
  );
  await expect(hero.getByRole("button", { name: "Купить на сайте", exact: true })).toBeVisible();

  // Порядок продавца: вопросы, программа, «Чему научитесь», преподаватели.
  const ids = await page
    .locator("[data-testid^='landing-']")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
  expect(ids).toEqual(["landing-faq", "landing-program", "landing-learn", "landing-authors"]);
  // Скрытый блок (цитаты) и пустой (работы без фото) не показываются.
  await expect(page.getByText("Скрытая цитата Л1")).toHaveCount(0);

  const program = page.getByTestId("landing-program");
  await expect(program.getByRole("heading", { name: "Модуль 1", exact: true })).toBeVisible();
  await expect(program.getByRole("heading", { name: "Модуль 2", exact: true })).toBeVisible();
  await expect(program.getByText("2.1. Классика 1:1", { exact: true })).toBeVisible();
  await expect(page.getByText("Жази Л1", { exact: true })).toBeVisible();

  await page.getByText("Сколько длится доступ Л1?", { exact: true }).click();
  await expect(page.getByText("Бессрочно.", { exact: true })).toBeVisible();

  // «Купить на сайте» ведёт к кнопке «В корзину».
  await hero.getByRole("button", { name: "Купить на сайте", exact: true }).click();
  await expect(page.getByRole("button", { name: "🛒 В корзину", exact: true })).toBeInViewport();
});

test("курс без страницы выглядит как раньше", async ({ page }) => {
  await page.goto(`/s/${F.LANDING_SHOP_SLUG}/p/${F.LANDING_PLAIN_ID}`);
  await expect(
    page.getByRole("heading", { level: 1, name: F.LANDING_PLAIN_NAME, exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("course-landing-hero")).toHaveCount(0);
  await expect(page.getByText("Программа курса · уроков: 3")).toBeVisible();
});

test("школа без витрины: страница курса открыта, покупка в Telegram, корзины нет", async ({
  page,
}) => {
  await page.goto(`/s/${F.LANDING_BARE_SLUG}/p/${F.LANDING_BARE_COURSE_ID}`);
  const hero = page.getByTestId("course-landing-hero");
  await expect(
    hero.getByRole("heading", { level: 1, name: "Ресницы с нуля Л1", exact: true }),
  ).toBeVisible();
  await expect(hero.getByRole("link", { name: "Купить в Telegram", exact: true })).toHaveAttribute(
    "href",
    `https://t.me/${F.LANDING_BOT_USERNAME}?start=p_${F.LANDING_BARE_COURSE_ID}`,
  );
  await expect(page.getByRole("button", { name: "Купить на сайте", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "🛒 В корзину", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("landing-program")).toBeVisible();

  // Курс без «Страницы курса» и любой другой товар — как раньше без витрины: не найдено.
  const plain = await page.goto(`/s/${F.LANDING_BARE_SLUG}/p/${F.LANDING_BARE_PLAIN_ID}`);
  expect(plain?.status()).toBe(404);
});
