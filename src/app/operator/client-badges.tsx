import { Badge } from "@/app/ui";
export function StatusBadge({ status }: { status: string }) {
  if (status === "active") return <Badge tone="ok">активен</Badge>;
  if (status === "paused") return <Badge tone="warn">пауза</Badge>;
  return <Badge tone="danger">приостановлен</Badge>;
}

export function SubscriptionBadge({
  s,
  expiresAt,
}: {
  s: { state: string; daysLeft: number | null };
  expiresAt: string | null;
}) {
  const until = expiresAt ? new Date(expiresAt).toLocaleDateString("ru") : "";
  if (s.state === "no_data") return <Badge>не заведена</Badge>;
  if (s.state === "ok") return <Badge tone="ok">до {until}</Badge>;
  if (s.state === "expiring") return <Badge tone="warn">истекает через {s.daysLeft} дн.</Badge>;
  if (s.state === "overdue") return <Badge tone="warn">просрочена {-(s.daysLeft ?? 0)} дн.</Badge>;
  return <Badge tone="danger">просрочена {-(s.daysLeft ?? 0)} дн.</Badge>;
}

export function HealthBadge({
  h,
}: {
  h: { ok: boolean; at: string; error: string | null; pending: number | null } | null;
}) {
  if (!h) return <Badge>нет данных</Badge>;
  const when = new Date(h.at).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" });
  if (h.ok)
    return (
      <Badge tone="ok">
        работает{h.pending ? ` · очередь ${h.pending}` : ""} · {when}
      </Badge>
    );
  return (
    <Badge tone="danger">
      {h.error ? h.error.slice(0, 40) : "сбой"} · {when}
    </Badge>
  );
}
