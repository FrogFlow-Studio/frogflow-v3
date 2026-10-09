import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { pruneUpsellFn, upsellHealthFn } from "@/app/admin/upsell.functions";
import { type AdminT } from "@/app/i18n/admin";
import { Card, ErrorBox, useAction } from "@/app/ui";

/** Состояние допродаж в каталоге. */

/** Правила «С этим предлагать», которые не работают: скрытые и удалённые товары. */
export function UpsellHealthCard({ t, editable }: { t: AdminT; editable: boolean }) {
  const [health, setHealth] = useState<Awaited<ReturnType<typeof upsellHealthFn>> | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const load = useAction(async () => setHealth(await upsellHealthFn()));
  useEffect(() => {
    void load.run().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const prune = useAction(async () => {
    const r = await pruneUpsellFn();
    setDone(r.removed);
    await load.run();
  });
  const problems = health?.problems ?? [];
  if (!health && !load.error) return null;
  if (!load.error && !problems.length && done == null) return null;
  const hasDeleted = problems.some(
    (p) => p.trigger === "deleted" || p.dead.some((d) => d.state === "deleted"),
  );
  return (
    <Card className="mb-4">
      {load.error != null && <ErrorBox error={load.error} />}
      {prune.error != null && <ErrorBox error={prune.error} />}
      {done != null && (
        <p className="text-sm text-green-700">{t("upsell.health.pruned", { n: done })}</p>
      )}
      {problems.length > 0 && (
        <>
          <p className="font-medium">{t("upsell.health.title", { n: problems.length })}</p>
          <ul className="mt-2 space-y-1 text-sm">
            {problems.map((p) => (
              <li key={p.productId}>
                {p.trigger === "deleted" ? (
                  t("upsell.health.orphan")
                ) : (
                  <Link to="/admin/products/$id" params={{ id: p.productId }} className="underline">
                    {p.productName}
                  </Link>
                )}
                {": "}
                {p.dead
                  .map(
                    (d) =>
                      `${d.name ?? t("product.upsell.deletedName")} (${t(
                        d.state === "deleted" ? "product.upsell.deleted" : "product.upsell.hidden",
                      )})`,
                  )
                  .join(", ")}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-gray-500">{t("upsell.health.hint")}</p>
          {editable && hasDeleted && (
            <button
              className="btn-secondary mt-2"
              disabled={prune.busy}
              onClick={() => void prune.run().catch(() => undefined)}
            >
              {t("upsell.health.prune")}
            </button>
          )}
        </>
      )}
    </Card>
  );
}
