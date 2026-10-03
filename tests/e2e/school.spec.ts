import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";

/**
 * Онлайн-школа на собранном приложении: карточка курса на витрине — как
 * лендинг (программа, поток, что входит); страница курса по подписанной
 * ссылке — открытый урок с заданием и сдача ответа. База — подставная
 * (seed/school.ts).
 */
const token = (itemId: string) =>
  createHmac("sha256", F.SECRETS_KEY)
    .update(`course:${F.SCHOOL_ID}:${itemId}`)
    .digest("base64url")
    .slice(0, 22);

test("карточка курса: программа, поток и что входит", async ({ page }) => {
  await page.goto(`/s/${F.SCHOOL_SLUG}/p/${F.SCHOOL_COURSE_ID}`);
  await expect(
    page.getByRole("heading", { name: F.SCHOOL_COURSE_NAME, exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Программа курса · уроков: 2")).toBeVisible();
  await expect(page.getByText(/Поток «Октябрь» — старт/)).toBeVisible();
  await expect(page.getByText("✓ Проверка домашних заданий")).toBeVisible();
  await expect(page.getByText("Кисти и краски")).toBeVisible();
});

test("страница курса: урок открыт, задание сдаётся; чужая подпись — не найдено", async ({
  page,
}, info) => {
  const item = F.SCHOOL_ITEM_IDS[info.project.name === "desktop" ? 0 : 1]!;
  const bad = await page.goto(`/s/${F.SCHOOL_SLUG}/course/${item}?k=${"x".repeat(22)}`);
  expect(bad?.status()).toBe(404);

  await page.goto(`/s/${F.SCHOOL_SLUG}/course/${item}?k=${token(item)}`);
  await expect(page.getByText("Разбираем инструменты.")).toBeVisible();
  await expect(page.getByText("Нарисуйте круг и пришлите фото.")).toBeVisible();
  // Ссылка на YouTube — встроенный плеер, а не только кнопка.
  await expect(page.locator("iframe").first()).toHaveAttribute(
    "src",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  );
  await page.getByPlaceholder("Ответ или комментарий к работе").first().fill("Круг готов");
  await page.getByRole("button", { name: "Отправить на проверку", exact: true }).click();
  await expect(page.getByText("Отправлено. Преподаватель проверит и ответит.")).toBeVisible();
});
