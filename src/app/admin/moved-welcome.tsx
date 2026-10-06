import { Link, useRouter } from "@tanstack/react-router";
import { hideMovedWelcomeFn } from "@/app/admin/admin.functions";
import { movedRows } from "@/app/admin/setup";
import type { AdminT } from "@/app/i18n/admin";
import { Card, ErrorBox, useAction } from "@/app/ui";

/**
 * Карточка на «Обзоре» для продавца, которого перевели с прежней панели:
 * что где теперь, что проверить и тестовый заказ на себя. Показывается,
 * пока продавец её не закроет (showMovedWelcome в setup.ts). Консультанту
 * без продаж (`sells: false`) — без заказов, каталога, оплаты и тестового заказа.
 */
export function MovedWelcome({
  t,
  modules,
  payment,
  notifications,
  testOrder,
  sells = true,
}: {
  t: AdminT;
  modules: Record<string, boolean | undefined>;
  payment: boolean;
  notifications: boolean;
  testOrder: { url: string } | { missing: "telegram" | "products" };
  sells?: boolean;
}) {
  const router = useRouter();
  const hide = useAction(async () => {
    await hideMovedWelcomeFn();
    await router.invalidate();
  });
  const rows = movedRows(modules, sells);
  const checks = [
    { key: "payment", to: "/admin/settings", ok: payment },
    { key: "texts", to: "/admin/bot-preview", ok: null },
    { key: "chat", to: "/admin/settings", ok: notifications },
  ] as const;
  const shown = sells ? checks : checks.filter((c) => c.key !== "payment");
  return (
    <div data-testid="moved-welcome" className="mb-6">
      <Card title={t("overview.moved.title")}>
        <p className="mb-4 text-sm text-muted">
          {t(sells ? "overview.moved.intro" : "overview.moved.introNoSales")}
        </p>
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-sm font-medium">{t("overview.moved.where")}</p>
            <ul className="space-y-1 text-sm">
              {rows.map((r) => (
                <li key={r.from} className="flex flex-wrap gap-x-2">
                  <span className="text-muted">{t(`overview.moved.from.${r.from}`)}</span>
                  <span aria-hidden>→</span>
                  <Link to={r.to} className="text-accent hover:underline">
                    {t(r.nav)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">
              {t(sells ? "overview.moved.check" : "overview.moved.checkNoSales")}
            </p>
            <ol className="space-y-2 text-sm">
              {shown.map((c) => (
                <li key={c.key} className="flex gap-2">
                  <span className={c.ok === false ? "text-warn" : "text-muted"} aria-hidden>
                    {c.ok ? "✓" : c.ok === false ? "!" : "•"}
                  </span>
                  <span>
                    {t(`overview.moved.check.${c.key}`)}{" "}
                    <Link to={c.to} className="text-accent hover:underline">
                      {t("overview.moved.open")}
                    </Link>
                  </span>
                </li>
              ))}
            </ol>
            {sells && (
              <div className="mt-4">
                {"url" in testOrder ? (
                  <>
                    <a
                      href={testOrder.url}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-secondary inline-block text-sm"
                    >
                      {t("overview.testOrder.open")}
                    </a>
                    <p className="mt-1 text-xs text-muted">{t("overview.testOrder.how")}</p>
                  </>
                ) : (
                  <p className="text-sm text-muted">
                    {t(
                      testOrder.missing === "telegram"
                        ? "overview.testOrder.needTelegram"
                        : "overview.testOrder.needProducts",
                    )}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <button
            className="btn-ghost text-sm"
            disabled={hide.busy}
            onClick={() => void hide.run().catch(() => {})}
          >
            {t("overview.moved.done")}
          </button>
        </div>
        <ErrorBox error={hide.error} />
      </Card>
    </div>
  );
}
