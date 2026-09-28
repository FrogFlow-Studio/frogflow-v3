import { useEffect, useState } from "react";
import { Card, ErrorBox, useAction } from "@/app/ui";
import { apiKeyStatusFn, createApiKeyFn, revokeApiKeyFn } from "@/app/admin/api-key.functions";
import { adminT } from "@/app/i18n/admin";
import { settingsRoute } from "./route";

/** Ключ публичного API (core/api/public-api): создать, сменить, отозвать; показ один раз. */
export function ApiKeyCard() {
  const { shop } = settingsRoute.useRouteContext();
  const t = adminT(shop.locale);
  const [status, setStatus] = useState<Awaited<ReturnType<typeof apiKeyStatusFn>> | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    setOrigin(window.location.origin);
    void apiKeyStatusFn().then(setStatus);
  }, []);
  const create = useAction(async () => {
    if (status?.exists && !window.confirm(t("settings.api.rotateConfirm"))) return;
    const r = await createApiKeyFn();
    setToken(r.token);
    setStatus({ exists: true, last4: r.last4, createdAt: r.createdAt });
  });
  const revoke = useAction(async () => {
    if (!window.confirm(t("settings.api.revokeConfirm"))) return;
    await revokeApiKeyFn();
    setToken(null);
    setStatus({ exists: false });
  });
  if (!status) return null;
  return (
    <Card title={t("settings.api.title")} className="lg:col-span-2">
      <div className="space-y-3 text-sm">
        <p className="text-muted">{t("settings.api.intro")}</p>
        <p>
          {status.exists
            ? t("settings.api.active", {
                last4: status.last4 ?? "",
                date: status.createdAt ? status.createdAt.slice(0, 10) : "",
              })
            : t("settings.api.none")}
        </p>
        {token && (
          <div className="space-y-1 rounded-md bg-surface-2 p-3">
            <p className="text-xs font-medium">{t("settings.api.copyNow")}</p>
            <code className="block break-all text-xs">{token}</code>
          </div>
        )}
        <pre className="overflow-x-auto rounded-md bg-surface-2 p-3 text-xs">
          {`curl -H "Authorization: Bearer ${token ?? "ffk_…"}" \\\n  ${origin}/api/v1/orders?limit=10\n\nGET   /api/v1/orders?status=&updated_since=&limit=&before_id=\nGET   /api/v1/orders/<id>\nGET   /api/v1/products\nPATCH /api/v1/products/<id>  {"stock": 5, "price": 1000, "active": true}`}
        </pre>
        <p className="text-xs text-muted">{t("settings.api.webhooks")}</p>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" disabled={create.busy} onClick={() => void create.run()}>
            {status.exists ? t("settings.api.rotate") : t("settings.api.create")}
          </button>
          {status.exists && (
            <button className="btn-danger" disabled={revoke.busy} onClick={() => void revoke.run()}>
              {t("settings.api.revoke")}
            </button>
          )}
        </div>
        <ErrorBox error={create.error ?? revoke.error} />
      </div>
    </Card>
  );
}
