import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";

/**
 * Мастер «Новый курс» (02.11.2026, продавцу сложно: «сначала сохраните товар,
 * потом добавляйте уроки»): название, цена и уроки списком с модулями на одном
 * экране — после «Создать курс» открывается карточка, уроки в ней уже есть.
 */
test("мастер «Новый курс»: курс с модулями и ссылками создаётся с одного экрана", async ({
  browser,
}) => {
  const teacher = await browser.newPage();
  await teacher.goto("/admin/login");
  await teacher.locator('input[name="username"]').fill(F.SCHOOL_SELLER_LOGIN);
  await teacher.locator('input[name="password"]').fill(F.SCHOOL_SELLER_PASSWORD);
  await teacher.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(teacher).toHaveURL(/\/admin$/);
  await teacher.goto("/admin/products");
  await teacher.getByRole("link", { name: "+ Новый курс", exact: true }).click();
  await expect(teacher).toHaveURL(/\/admin\/products\/new-course$/);

  await teacher.locator('input[name="name"]').fill("Мастер-курс e2e");
  await teacher.locator('input[name="price"]').fill("10000");
  const lessons = teacher.locator("#course-wizard-lessons");
  await lessons.fill(
    "Модуль 1. Основы:\nМатериалы — https://youtu.be/m1\nПлохой — http://example.com/x\nБез видео",
  );
  // Плохие строки не пропадают молча: причина видна, курс не создаётся.
  await expect(teacher.getByText("Строка 3: ссылка должна начинаться с https://")).toBeVisible();
  await expect(
    teacher.getByText("Строка 4: нет ссылки на видео — урок без неё не сохранится"),
  ).toBeVisible();
  await teacher.getByRole("button", { name: "Создать курс", exact: true }).click();
  await expect(teacher).toHaveURL(/\/admin\/products\/new-course$/);

  await lessons.fill(
    "Модуль 1. Основы:\nМатериалы — https://youtu.be/m1\nРабочее место — https://vimeo.com/7\n\nМодуль 2:\nКлассика — https://youtu.be/m2",
  );
  await expect(teacher.getByText("Уроков: 3. Модулей: 2.", { exact: true })).toBeVisible();
  await teacher.getByRole("button", { name: "Создать курс", exact: true }).click();

  await expect(teacher).toHaveURL(/\/admin\/products\/[0-9a-f-]{36}$/);
  const titles = teacher.locator('input[id^="lesson-title-"]');
  await expect(titles).toHaveCount(3);
  await expect(titles.nth(0)).toHaveValue("Модуль 1. Основы · Материалы");
  await expect(titles.nth(1)).toHaveValue("Модуль 1. Основы · Рабочее место");
  await expect(titles.nth(2)).toHaveValue("Модуль 2 · Классика");
  const links = teacher.locator('input[id^="lesson-link-"]');
  await expect(links.nth(0)).toHaveValue("https://youtu.be/m1");
  await expect(links.nth(1)).toHaveValue("https://vimeo.com/7");
  await expect(links.nth(2)).toHaveValue("https://youtu.be/m2");
  await expect(teacher.locator('input[name="name"]')).toHaveValue("Мастер-курс e2e");
  await teacher.close();
});
