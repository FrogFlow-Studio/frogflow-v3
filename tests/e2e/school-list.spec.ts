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
