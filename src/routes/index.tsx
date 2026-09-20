import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: () => (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-3xl font-semibold">FrogFlow</h1>
      <p className="mt-3 text-neutral-600">
        Платформа магазинов в Telegram, Instagram и WhatsApp. Один деплой, много клиентов.
      </p>
    </main>
  ),
});
