import { reportError } from "@/lib/errors";

/** Ответить вебхуку сразу, доделать после — на Vercel через waitUntil. */
export async function runInBackground(
  task: () => Promise<void>,
  where = "background",
): Promise<void> {
  // Ответ уже ушёл: упавшую фоновую задачу больше некому показать, кроме учёта ошибок.
  const guarded = () => task().catch((e: unknown) => reportError(e, { where }));
  try {
    const { waitUntil } = await import("@vercel/functions");
    waitUntil(guarded());
  } catch {
    await guarded();
  }
}
