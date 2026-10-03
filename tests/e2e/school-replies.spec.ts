import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";

/** «Домашние задания»: быстрые ответы куратора (А35) — добавить, сохранить, увидеть после обновления. */
test("быстрые ответы куратора: сохраняются и остаются после обновления страницы", async ({
  browser,
}) => {
  const teacher = await browser.newPage();
  await teacher.goto("/admin/login");
  await teacher.locator('input[name="username"]').fill(F.SCHOOL_SELLER_LOGIN);
  await teacher.locator('input[name="password"]').fill(F.SCHOOL_SELLER_PASSWORD);
  await teacher.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(teacher).toHaveURL(/\/admin$/);
  await teacher.goto("/admin/homework");
  // Телефон и компьютер идут параллельно на одной подставной базе: если ответы уже есть,
  // блок раскрыт сам, и клик по заголовку его бы закрыл.
  const add = teacher.getByRole("button", { name: "+ быстрый ответ", exact: true });
  await expect(teacher.getByText(/Быстрые ответы/).first()).toBeVisible();
  if (!(await add.isVisible())) {
    await teacher
      .getByText(/Быстрые ответы/)
      .first()
      .click();
  }
  await add.click();
  await teacher.getByPlaceholder("Название").last().fill("Молодец");
  await teacher
    .getByPlaceholder("Текст комментария")
    .last()
    .fill("Отлично, {name}! Работа принята.");
  await teacher.getByRole("button", { name: "Сохранить быстрые ответы", exact: true }).click();
  await expect(teacher.getByText("Быстрые ответы сохранены.")).toBeVisible();

  await teacher.reload();
  // Телефон и компьютер идут параллельно на одной подставной базе: считаем «не меньше одного».
  await expect(teacher.getByText(/Быстрые ответы · [1-9]/)).toBeVisible();
  await expect(teacher.getByPlaceholder("Название").first()).toHaveValue("Молодец");
  await teacher.close();
});
