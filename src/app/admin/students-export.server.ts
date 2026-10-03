import type { TenantContext } from "@/core/tenant/resolve.server";
import { toCsv, shopDateTime } from "@/core/export/csv";
import { courseStudents } from "@/core/courses/progress.server";
import { courseProducts } from "./students.server";

/**
 * Выгрузка учеников курса в CSV (Excel): строка на покупку — курс, поток,
 * тариф, прогресс, задания, кто отстаёт, срок доступа, вступил ли в канал.
 * Прогресс берётся из `courseStudents` — он идёт постранично, без обрезки.
 * Один курс (`productId`) или все курсы магазина.
 */
export const STUDENT_COLUMNS = [
  "Курс",
  "Заказ №",
  "Покупатель",
  "Куплено",
  "Поток",
  "Тариф",
  "Начато",
  "Уроков всего",
  "Открыто",
  "Пройдено",
  "ДЗ принято",
  "ДЗ ждёт проверки",
  "ДЗ на доработке",
  "Тестов пройдено",
  "Попыток теста",
  "Отстаёт",
  "Доступ до",
  "Доступ закончился",
  "В канале",
  "Канал закрыт",
];

export async function studentsCsv(
  ctx: TenantContext,
  productId: string | null,
  now = new Date(),
): Promise<{ csv: string; count: number }> {
  const yes = (v: boolean) => (v ? "да" : "нет");
  const courses = (await courseProducts(ctx))
    .filter((p) => !productId || p.id === productId)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const rows: unknown[][] = [];
  for (const c of courses) {
    const { total, students } = await courseStudents(ctx, c.id, now);
    for (const s of students)
      rows.push([
        c.name,
        s.orderNo,
        s.buyer ?? "",
        shopDateTime(s.boughtAt, ctx.timezone),
        s.cohort ?? "",
        s.tariff ?? "",
        shopDateTime(s.startedAt, ctx.timezone),
        total,
        s.open,
        s.done,
        s.homework.accepted,
        s.homework.submitted,
        s.homework.revise,
        s.quiz.passed,
        s.quiz.attempts,
        yes(s.behind),
        s.expiresAt ? shopDateTime(s.expiresAt, ctx.timezone) : "",
        yes(s.expired),
        yes(s.inChannel),
        yes(s.channelRevoked),
      ]);
  }
  return { csv: toCsv(STUDENT_COLUMNS, rows), count: rows.length };
}
