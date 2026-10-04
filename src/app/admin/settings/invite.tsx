import { useEffect, useState } from "react";
import { inviteCardFn } from "@/app/admin/admin.functions";
import { Card, ErrorBox, useAction } from "@/app/ui";
import { adminT } from "@/app/i18n/admin";
import { settingsRoute } from "./route";

/** «Пригласить автора»: ссылка-приглашение и сводка, только владельцу (core/invites). */
export function InviteCard() {
  const { shop } = settingsRoute.useRouteContext();
  const t = adminT(shop.locale);
  const [card, setCard] = useState<Awaited<ReturnType<typeof inviteCardFn>> | null>(null);
  const [copied, setCopied] = useState(false);
  const load = useAction(async () => setCard(await inviteCardFn()));
  useEffect(() => {
    void load.run().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Card title={t("invite.title")}>
      {card && (
        <div className="space-y-3 text-sm">
          <p className="text-muted">{t("invite.intro", { percent: card.discountPercent })}</p>
          <code className="block break-all rounded-md bg-surface-2 p-2 text-xs">{card.link}</code>
          <button
            className="btn-secondary text-sm"
            onClick={() => {
              void navigator.clipboard?.writeText(card.link).then(() => setCopied(true));
            }}
          >
            {copied ? t("invite.copied") : t("invite.copy")}
          </button>
          <ul className="space-y-0.5">
            <li>{t("invite.registered", { n: card.registered })}</li>
            <li>{t("invite.paid", { n: card.paid })}</li>
            <li>{t("invite.credited", { n: card.credited })}</li>
          </ul>
          <p className="text-xs text-muted">{t("invite.note")}</p>
        </div>
      )}
      <ErrorBox error={load.error} />
    </Card>
  );
}
