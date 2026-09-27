import { useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  connectTelegramAdminFn,
  syncZernioAccountsFn,
  zernioConnectLinkFn,
  zernioStateFn,
  telegramStateFn,
} from "@/app/admin/admin.functions";
import { Badge, Card, ErrorBox, Field, Switch, useAction } from "@/app/ui";
import { directBotSettingsFn, saveDirectBotSettingsFn } from "@/app/admin/channels.functions";
import { type DirectBotSettings } from "@/core/instagram/direct-bot-settings";
import { adminT, intlLocale } from "@/app/i18n/admin";
import { settingsRoute } from "./route";

type TelegramState = Awaited<ReturnType<typeof telegramStateFn>>;

export function TelegramCard({ telegram }: { telegram: TelegramState }) {
  const router = useRouter();
  const { shop } = settingsRoute.useRouteContext();
  const t = adminT(shop.locale);
  const [result, setResult] = useState<string | null>(null);
  const connect = useAction(async (token: string) => {
    const r = await connectTelegramAdminFn({ data: { token } });
    setResult(
      r.webhook?.ok
        ? t("settings.tg.connected", { username: r.username ?? "" })
        : t("settings.tg.webhookFailed", {
            error: r.webhook?.error ?? t("settings.tg.unknown"),
          }),
    );
    await router.invalidate();
  });
  const ok = telegram.connected && telegram.servedBy === "v2" && telegram.webhook?.ok;
  return (
    <Card
      title={t("settings.tg.title")}
      actions={
        telegram.connected ? (
          <Badge tone={ok ? "ok" : "warn"}>
            {ok
              ? t("settings.tg.working", { username: telegram.username ?? "" })
              : t("settings.tg.checkWebhook", {
                  username: telegram.username ?? t("settings.tg.botFallback"),
                })}
          </Badge>
        ) : (
          <Badge>{t("settings.tg.notConnected")}</Badge>
        )
      }
      className="lg:col-span-2"
    >
      <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-muted">
        <li>
          {t("settings.tg.step1Before")}{" "}
          <a
            className="text-accent hover:underline"
            href="https://t.me/BotFather"
            target="_blank"
            rel="noreferrer"
          >
            @BotFather
          </a>
          {t("settings.tg.step1Middle")} <code>/newbot</code>
          {t("settings.tg.step1After")}
        </li>
        <li>
          {t("settings.tg.step2Before")} <code>123456789:AA…</code> {t("settings.tg.step2After")}
        </li>
      </ol>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          void connect
            .run(String(new FormData(form).get("token")).trim())
            .then(() => form.reset())
            .catch(() => {});
        }}
      >
        <input
          className="input"
          name="token"
          placeholder={
            telegram.connected ? t("settings.tg.tokenNew") : t("settings.tg.tokenPlaceholder")
          }
          autoComplete="off"
          required
        />
        <button className="btn-primary shrink-0" disabled={connect.busy}>
          {telegram.connected ? t("settings.tg.replace") : t("settings.tg.connect")}
        </button>
      </form>
      {result && <p className="mt-2 text-sm text-muted">{result}</p>}
      <ErrorBox error={connect.error} />
      {telegram.connected && telegram.webhook && !telegram.webhook.ok && (
        <p className="mt-2 text-xs text-warn">
          {t("settings.tg.webhookNow", {
            url: telegram.webhook.url ?? t("settings.tg.webhookNone"),
          })}{" "}
          {telegram.servedBy !== "v2" ? t("settings.tg.legacy") : t("settings.tg.reinstall")}
        </p>
      )}
    </Card>
  );
}

type ZernioState = Awaited<ReturnType<typeof zernioStateFn>>;

const CHANNEL_LABEL: Record<string, string> = { instagram: "Instagram", whatsapp: "WhatsApp" };

export function ChannelsCard({
  zernio,
  instagram,
  whatsapp,
}: {
  zernio: ZernioState;
  instagram: boolean;
  whatsapp: boolean;
}) {
  const router = useRouter();
  const { shop } = settingsRoute.useRouteContext();
  const t = adminT(shop.locale);
  const [note, setNote] = useState<string | null>(null);
  const connect = useAction(async (platform: "instagram" | "whatsapp") => {
    const r = await zernioConnectLinkFn({ data: { platform } });
    window.location.assign(r.url);
  });
  const sync = useAction(async () => {
    const r = await syncZernioAccountsFn();
    setNote(
      r.accounts.length
        ? t("settings.ch.syncedCount", { n: r.accounts.length })
        : t("settings.ch.syncedNone"),
    );
    await router.invalidate();
  });
  // Возврат из авторизации Zernio: подтянуть аккаунты и убрать метку из адреса.
  useEffect(() => {
    if (!window.location.search.includes("zernio=connected")) return;
    window.history.replaceState(null, "", window.location.pathname);
    void sync.run().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const live = zernio.accounts.filter((a) => !a.expired).length;
  return (
    <Card
      title={t("settings.ch.title")}
      actions={
        live > 0 ? (
          <Badge tone="ok">
            {live === 1
              ? t("settings.ch.liveOne", { n: live })
              : t("settings.ch.liveMany", { n: live })}
          </Badge>
        ) : (
          <Badge>{t("settings.ch.notConnected")}</Badge>
        )
      }
      className="lg:col-span-2"
    >
      <p className="mb-3 text-sm text-muted">{t("settings.ch.intro")}</p>
      {!zernio.configured && (
        <p className="mb-3 rounded-md border border-warn/40 bg-warn/15 px-3 py-2 text-sm">
          {t("settings.ch.notConfigured")}
        </p>
      )}
      {(zernio.accounts.length > 0 || zernio.manualIds.length > 0) && (
        <ul className="mb-3 divide-y divide-line rounded-md border border-line text-sm">
          {zernio.accounts.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <span>
                <span className="font-medium">{CHANNEL_LABEL[a.platform] ?? a.platform}</span>{" "}
                <span className="text-muted">
                  {a.username ? `@${a.username}` : (a.name ?? a.id)}
                </span>
              </span>
              <Badge tone={a.expired ? "warn" : "ok"}>
                {a.expired ? t("settings.ch.expired") : t("settings.ch.working")}
              </Badge>
            </li>
          ))}
          {zernio.manualIds.map((id) => (
            <li key={id} className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="text-muted">{t("settings.ch.account", { id })}</span>
              <Badge>{t("settings.ch.byOperator")}</Badge>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        {instagram && (
          <button
            type="button"
            className="btn-primary"
            disabled={connect.busy || !zernio.configured}
            onClick={() => void connect.run("instagram").catch(() => {})}
          >
            {t("settings.ch.connectInstagram")}
          </button>
        )}
        {whatsapp && (
          <button
            type="button"
            className="btn-primary"
            disabled={connect.busy || !zernio.configured}
            onClick={() => void connect.run("whatsapp").catch(() => {})}
          >
            {t("settings.ch.connectWhatsapp")}
          </button>
        )}
        <button
          type="button"
          className="btn-secondary"
          disabled={sync.busy || !zernio.configured}
          onClick={() => void sync.run().catch(() => {})}
        >
          {t("settings.ch.refresh")}
        </button>
      </div>
      {note && <p className="mt-2 text-sm text-muted">{note}</p>}
      {zernio.syncedAt && (
        <p className="mt-2 text-xs text-muted">
          {t("settings.ch.updatedAt", {
            date: new Date(zernio.syncedAt).toLocaleString(intlLocale(shop.locale)),
          })}
        </p>
      )}
      <ErrorBox error={connect.error ?? sync.error} />
    </Card>
  );
}

/**
 * Автоответчик канала: тумблер, область ответов, слова-вызовы, ответ на
 * непонятное, что из магазина включено. Ключи те же, что в v1.
 */
export function DirectBotCard({ platform }: { platform: "instagram" | "whatsapp" }) {
  const { shop } = settingsRoute.useRouteContext();
  const t = adminT(shop.locale);
  const [s, setS] = useState<(DirectBotSettings & { triggersText: string }) | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void directBotSettingsFn({ data: { platform } }).then((r) =>
      setS({ ...r, triggersText: r.triggers.join(", ") }),
    );
  }, [platform]);
  const save = useAction(async () => {
    if (!s) return;
    await saveDirectBotSettingsFn({
      data: {
        platform,
        enabled: s.enabled,
        scope: s.scope,
        triggers: s.triggersText,
        script: s.script,
        features: s.features,
        ignoreExcluded: s.ignoreExcluded,
        notifyTemplate: s.notifyTemplate,
      },
    });
    setSaved(true);
  });
  const owner = shop.role === "owner";
  const feature = (k: keyof DirectBotSettings["features"], label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={s?.features[k] ?? true}
        disabled={!owner}
        onChange={(e) => s && setS({ ...s, features: { ...s.features, [k]: e.target.checked } })}
      />
      {label}
    </label>
  );
  return (
    <Card
      title={t("settings.dbot.title", { channel: CHANNEL_LABEL[platform] ?? platform })}
      actions={
        s && (
          <Switch
            checked={s.enabled}
            onChange={(on) => owner && setS({ ...s, enabled: on })}
            label={t("settings.dbot.enabled")}
          />
        )
      }
    >
      {!s ? (
        <p className="text-sm text-muted">…</p>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setSaved(false);
            void save.run().catch(() => {});
          }}
        >
          <p className="text-sm text-muted">{t("settings.dbot.intro")}</p>
          <Field label={t("settings.dbot.scope")}>
            <div className="space-y-1 text-sm">
              {(["purchases", "all"] as const).map((v) => (
                <label key={v} className="flex items-start gap-2">
                  <input
                    type="radio"
                    name={`scope-${platform}`}
                    checked={s.scope === v}
                    disabled={!owner}
                    onChange={() => setS({ ...s, scope: v })}
                  />
                  <span>
                    {t(`settings.dbot.scope.${v}`)}
                    <span className="block text-xs text-muted">
                      {t(`settings.dbot.scope.${v}Hint`)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </Field>
          <Field label={t("settings.dbot.triggers")} hint={t("settings.dbot.triggersHint")}>
            <input
              className="input"
              value={s.triggersText}
              disabled={!owner}
              placeholder={t("settings.dbot.triggersPlaceholder")}
              onChange={(e) => setS({ ...s, triggersText: e.target.value })}
            />
          </Field>
          <Field label={t("settings.dbot.script")} hint={t("settings.dbot.scriptHint")}>
            <textarea
              className="input min-h-20"
              value={s.script}
              disabled={!owner}
              placeholder={t("settings.dbot.scriptPlaceholder")}
              onChange={(e) => setS({ ...s, script: e.target.value })}
            />
          </Field>
          <Field label={t("settings.dbot.features")}>
            <div className="grid grid-cols-2 gap-1">
              {feature("catalog", t("settings.dbot.feature.catalog"))}
              {feature("search", t("settings.dbot.feature.search"))}
              {feature("cart", t("settings.dbot.feature.cart"))}
              {feature("checkout", t("settings.dbot.feature.checkout"))}
            </div>
          </Field>
          {platform === "whatsapp" && (
            <>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={s.ignoreExcluded}
                  disabled={!owner}
                  onChange={(e) => setS({ ...s, ignoreExcluded: e.target.checked })}
                />
                {t("settings.dbot.ignoreExcluded")}
              </label>
              <Field
                label={t("settings.dbot.notifyTemplate")}
                hint={t("settings.dbot.notifyTemplateHint")}
              >
                <input
                  className="input"
                  value={s.notifyTemplate}
                  disabled={!owner}
                  placeholder="order_update:ru"
                  onChange={(e) => setS({ ...s, notifyTemplate: e.target.value })}
                />
              </Field>
              <p className="text-xs text-muted">{t("settings.dbot.nativeCatalogHint")}</p>
            </>
          )}
          {owner && (
            <div className="flex items-center gap-3">
              <button className="btn-primary" disabled={save.busy}>
                {t("common.save")}
              </button>
              {saved && <span className="text-sm text-ok">{t("settings.saved")}</span>}
            </div>
          )}
          <ErrorBox error={save.error} />
        </form>
      )}
    </Card>
  );
}
