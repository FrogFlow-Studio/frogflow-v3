/** Ответить вебхуку сразу, доделать после — на Vercel через waitUntil. */
export async function runInBackground(task: () => Promise<void>): Promise<void> {
  try {
    const { waitUntil } = await import("@vercel/functions");
    waitUntil(task());
  } catch {
    await task();
  }
}
