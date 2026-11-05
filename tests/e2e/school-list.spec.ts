import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";

/** Карточка курса: «Добавить уроки списком» (А34) — строки становятся уроками, плохие остаются в поле. */
test("уроки списком: строки становятся уроками, не-https остаётся в поле с причиной", async ({
  browser,
}) => {
  const teacher = await browser.newPage();
  await teacher.goto("/admin/login");
  await teacher.locator('input[name="username"]').fill(F.SCHOOL_SELLER_LOGIN);
  await teacher.locator('input[name="password"]').fill(F.SCHOOL_SELLER_PASSWORD);
  await teacher.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(teacher).toHaveURL(/\/admin$/);
  await teacher.goto(`/admin/products/${F.SCHOOL_COURSE_ID}`);
  const titles = teacher.locator('input[id^="lesson-title-"]');
  await expect(titles.first()).toBeVisible();
  const before = await titles.count();

  await teacher.getByRole("button", { name: "Добавить уроки списком", exact: true }).click();
  await teacher
    .locator("#lesson-list-text")
    .fill("Новый урок А — https://youtu.be/aaa\nУрок без ссылки\nПлохой — http://example.com/x");
  await teacher.getByRole("button", { name: "Добавить в курс", exact: true }).click();

  await expect(titles).toHaveCount(before + 2);
  await expect(titles.nth(before)).toHaveValue("Новый урок А");
  await expect(titles.nth(before + 1)).toHaveValue("Урок без ссылки");
  await expect(teacher.locator('input[id^="lesson-link-"]').nth(before)).toHaveValue(
    "https://youtu.be/aaa",
  );
  // Не взятая строка осталась в поле, причина — рядом.
  await expect(teacher.locator("#lesson-list-text")).toHaveValue("Плохой — http://example.com/x");
  await expect(teacher.getByText("Строка 3: ссылка должна начинаться с https://")).toBeVisible();
  await teacher.close();
});

/**
 * Ссылка на видео, вписанная в урок, сохраняется и общей кнопкой товара внизу
 * страницы, а не только кнопкой в карточке курса (02.11.2026 продавец вписал
 * YouTube, нажал нижнее «Сохранить» — ссылка пропала).
 */
test("ссылка урока сохраняется общей кнопкой «Сохранить» товара", async ({ browser }) => {
  const teacher = await browser.newPage();
  await teacher.goto("/admin/login");
  await teacher.locator('input[name="username"]').fill(F.SCHOOL_SELLER_LOGIN);
  await teacher.locator('input[name="password"]').fill(F.SCHOOL_SELLER_PASSWORD);
  await teacher.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(teacher).toHaveURL(/\/admin$/);
  await teacher.goto(`/admin/products/${F.SCHOOL_COURSE_ID}`);
  const link = teacher.locator(`#lesson-link-${F.SCHOOL_LESSON_2}`);
  await expect(link).toBeVisible();
  await link.fill("https://youtu.be/AbCdEfGhIjK");

  // Нижняя панель «Сохранить / Отменить» (липкая; на телефоне над нижним меню).
  // Клик событием: у длинной формы курса Playwright на телефоне промахивается
  // по липкой панели при прокрутке, хотя кнопка видна (проверено скриншотом).
  const bar = teacher.getByTestId("product-savebar");
  await expect(bar.getByRole("button", { name: "Сохранить", exact: true })).toBeInViewport();
  await bar.getByRole("button", { name: "Сохранить", exact: true }).dispatchEvent("click");
  await expect(teacher).toHaveURL(/\/admin\/products$/);

  await teacher.goto(`/admin/products/${F.SCHOOL_COURSE_ID}`);
  await expect(teacher.locator(`#lesson-link-${F.SCHOOL_LESSON_2}`)).toHaveValue(
    "https://youtu.be/AbCdEfGhIjK",
  );
  await teacher.close();
});
