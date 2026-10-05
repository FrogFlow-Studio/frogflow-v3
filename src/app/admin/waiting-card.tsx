import { Link } from "@tanstack/react-router";
import type { AdminT } from "@/app/i18n/admin";
import { Card, Empty } from "@/app/ui";
import type { WaitingTile } from "./waiting";

const TONE: Record<WaitingTile["tone"], string> = {
  accent: "bg-accent/10 text-accent",
  warn: "bg-amber-100 text-amber-800",
  danger: "bg-red-100 text-red-700",
};

/** «Ждёт вас» (Ж1): плитки очередей, число ведёт сразу в очередь. На телефоне — одна колонка. */
export function WaitingCard({ tiles, t }: { tiles: WaitingTile[]; t: AdminT }) {
  return (
    <Card title={t("waiting.title")} className="mb-6">
      {tiles.length === 0 ? (
        <Empty>{t("waiting.empty")}</Empty>
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" data-waiting>
          {tiles.map((tile) => (
            <li key={tile.key} className="min-w-0">
              <Link
                to={tile.to as "/admin/orders"}
                search={tile.search as never}
                className="flex items-center justify-between gap-3 rounded-md border border-line p-3 text-sm hover:bg-surface-2"
              >
                <span className="min-w-0 truncate">{t(tile.label)}</span>
                {tile.count === null ? (
                  <span className="shrink-0 text-xs text-red-700">{t("waiting.failed")}</span>
                ) : (
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${TONE[tile.tone]}`}
                  >
                    {tile.count}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
