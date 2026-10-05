import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { AdminT } from "@/app/i18n/admin";
import { Badge, Card } from "@/app/ui";
import { aiBalanceCardFn } from "./ai-balance.functions";

export const aiUsdText = (usd: number) =>
  `${usd < 0 ? "−" : ""}$${Math.abs(usd).toFixed(Math.abs(usd) < 0.01 && usd !== 0 ? 4 : 2)}`;

/** Состояние баланса для подписи: те же пороги, что на странице «ИИ-баланс». */
export function aiBalanceLevel(usd: number, started: boolean): "ok" | "low" | "empty" {
  if (!started) return "ok";
  if (usd <= 0) return "empty";
  return usd < 1 ? "low" : "ok";
}

/** «ИИ-баланс» в правой колонке главной (Ж2): только владельцу; сбой чтения — «не удалось загрузить». */
export function AiBalanceCard({ t }: { t: AdminT }) {
  const [s, setS] = useState<Awaited<ReturnType<typeof aiBalanceCardFn>> | "failed" | null>(null);
  useEffect(() => {
    void aiBalanceCardFn().then(setS, () => setS("failed"));
  }, []);
  if (!s) return null;
  const level = s === "failed" ? "ok" : aiBalanceLevel(s.usd, s.started);
  return (
    <Card title={t("aiBalance.title")} className="mb-6">
      {s === "failed" ? (
        <p className="text-sm text-danger">{t("waiting.failed")}</p>
      ) : (
        <Link to="/admin/ai-balance" className="block hover:underline">
          <div className="text-xs text-muted">{t("aiBalance.left")}</div>
          <div className="text-xl font-semibold tabular-nums">{aiUsdText(s.usd)}</div>
          {level !== "ok" && (
            <Badge tone={level === "empty" ? "danger" : "warn"}>{t(`aiBalance.${level}`)}</Badge>
          )}
        </Link>
      )}
    </Card>
  );
}
