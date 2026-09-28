import { useEffect, useState } from "react";
import { Card, ErrorBox, useAction } from "@/app/ui";
import { pushConfigFn, removePushFn, savePushFn } from "@/app/admin/push.functions";
import { adminT } from "@/app/i18n/admin";
import { settingsRoute } from "./route";

type State = "unsupported" | "denied" | "off" | "on";

/**
 * Push на этом устройстве (core/push): уведомления о заказах приходят в
 * админку, установленную как приложение, — даже без бота Telegram.
 */
export function PushCard() {
  const { shop } = settingsRoute.useRouteContext();
  const t = adminT(shop.locale);
  const [key, setKey] = useState<string | null | undefined>(undefined);
  const [state, setState] = useState<State>("off");
  useEffect(() => {
    void pushConfigFn().then((r) => setKey(r.publicKey));
    if (!("serviceWorker" in navigator) || !("PushManager" in window))
      return setState("unsupported");
    if (Notification.permission === "denied") return setState("denied");
    void navigator.serviceWorker.getRegistration("/admin").then(async (reg) => {
      const s = await reg?.pushManager.getSubscription();
      setState(s ? "on" : "off");
    });
  }, []);
  const enable = useAction(async () => {
    if (!key) return;
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return setState(perm === "denied" ? "denied" : "off");
    const reg = await navigator.serviceWorker.register("/api/admin/sw", { scope: "/admin" });
    await navigator.serviceWorker.ready;
    const s = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
        c.charCodeAt(0),
      ),
    });
    const j = s.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
    await savePushFn({ data: { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth } });
    setState("on");
  });
  const disable = useAction(async () => {
    const reg = await navigator.serviceWorker.getRegistration("/admin");
    const s = await reg?.pushManager.getSubscription();
    if (s) {
      await removePushFn({ data: { endpoint: s.endpoint } });
      await s.unsubscribe();
    }
    setState("off");
  });
  if (!key) return null;
  return (
    <Card title={t("settings.push.title")}>
      <p className="mb-3 text-xs text-muted">{t("settings.push.intro")}</p>
      {state === "unsupported" && <p className="text-sm">{t("settings.push.unsupported")}</p>}
      {state === "denied" && <p className="text-sm">{t("settings.push.denied")}</p>}
      {state === "off" && (
        <button className="btn-primary" disabled={enable.busy} onClick={() => void enable.run()}>
          {t("settings.push.enable")}
        </button>
      )}
      {state === "on" && (
        <div className="flex items-center gap-3">
          <span className="text-sm text-ok">{t("settings.push.on")}</span>
          <button
            className="btn-secondary"
            disabled={disable.busy}
            onClick={() => void disable.run()}
          >
            {t("settings.push.disable")}
          </button>
        </div>
      )}
      <ErrorBox error={enable.error ?? disable.error} />
    </Card>
  );
}
