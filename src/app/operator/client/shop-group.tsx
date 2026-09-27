/** Карточка клиента у оператора: связанные магазины одного продавца. */
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { shopGroupFn, linkShopsFn, unlinkShopFn } from "@/app/operator/operator.functions";
import { Card, ErrorBox, useAction } from "@/app/ui";
import type { C } from "./types";

type ShopGroup = Awaited<ReturnType<typeof shopGroupFn>>;

/**
 * «Несколько ботов»: магазины одного продавца. Связь ставит только оператор;
 * владелец переключается между ними в своей админке, если у магазинов
 * включён модуль и они на v2 (core/tenant/shop-group).
 */
export function ShopGroupCard({ c }: { c: C }) {
  const [v, setV] = useState<ShopGroup | null>(null);
  const [other, setOther] = useState("");
  const load = useAction(async () => setV(await shopGroupFn({ data: { botId: c.id } })));
  useEffect(() => {
    void load.run().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id]);
  const link = useAction(async () => {
    await linkShopsFn({ data: { botId: c.id, otherId: other } });
    setOther("");
    await load.run();
  });
  const unlink = useAction(async () => {
    await unlinkShopFn({ data: { botId: c.id } });
    await load.run();
  });
  return (
    <Card title="Магазины продавца">
      <p className="mb-3 text-sm text-muted">
        Связанные магазины открываются владельцу по одному логину. Товары, заказы и покупатели у
        каждого свои. Переключение работает, когда у магазинов включён модуль «Несколько ботов» и
        они на v2.
      </p>
      {v && v.members.length > 0 ? (
        <ul className="mb-3 space-y-1 text-sm">
          {v.members.map((m) => (
            <li key={m.id}>
              {m.id === c.id ? (
                <strong>{m.name}</strong>
              ) : (
                <Link to="/operator/clients/$botId" params={{ botId: m.id }}>
                  {m.name}
                </Link>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 text-sm text-muted">Магазин ни с кем не связан.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <select
          className="input max-w-xs"
          value={other}
          onChange={(e) => setOther(e.target.value)}
          disabled={!v || link.busy}
        >
          <option value="">Выберите магазин…</option>
          {v?.candidates.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <button
          className="btn-secondary"
          disabled={!other || link.busy}
          onClick={() => void link.run().catch(() => {})}
        >
          Связать
        </button>
        {v?.group && (
          <button
            type="button"
            className="btn-ghost"
            disabled={unlink.busy}
            onClick={() => void unlink.run().catch(() => {})}
          >
            Отвязать этот магазин
          </button>
        )}
      </div>
      <ErrorBox error={load.error ?? link.error ?? unlink.error} />
    </Card>
  );
}
