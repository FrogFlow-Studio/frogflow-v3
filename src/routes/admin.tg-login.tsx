import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { adminTgLoginConsume } from "@/app/admin/admin-auth.functions";
import { adminT } from "@/app/i18n/admin";
import { useAction } from "@/app/ui";

/**
 * Ссылка входа от бота магазина. Вход — по кнопке, а не при загрузке:
 * предпросмотр ссылки в Telegram открывает её GET-запросом и погасил бы
 * одноразовый токен раньше владельца.
 */
export const Route = createFileRoute("/admin/tg-login")({
  validateSearch: z.object({ b: z.string().optional(), t: z.string().optional() }),
  component: TgLoginPage,
});

function TgLoginPage() {
  const { b, t: token } = Route.useSearch();
  const tr = adminT("ru");
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  const { run, busy } = useAction(async () => {
    const r = await adminTgLoginConsume({ data: { b: b ?? "", t: token ?? "" } }).catch(() => ({
      ok: false as const,
    }));
    if (!r.ok) return setFailed(true);
    await navigate({ to: "/admin" });
  });
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <div className="card space-y-4 p-6 text-center">
        <h1 className="text-xl font-semibold">🐸 {tr("login.tg.title")}</h1>
        {failed ? (
          <>
            <p className="text-sm text-danger">{tr("login.tg.expired")}</p>
            <Link to="/admin/login" className="btn-secondary w-full">
              {tr("login.submit")}
            </Link>
          </>
        ) : (
          <button
            className="btn-primary w-full"
            disabled={busy || !b || !token}
            onClick={() => void run().catch(() => setFailed(true))}
          >
            {tr("login.tg.enter")}
          </button>
        )}
      </div>
    </main>
  );
}
