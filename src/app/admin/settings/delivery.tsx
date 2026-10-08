import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import {
  deleteDeliveryZoneFn,
  saveDeliveryZoneFn,
  deliveryZonesFn,
} from "@/app/admin/delivery-zones.functions";
import { saveSettingsFn } from "@/app/admin/settings.functions";
import { Badge, Card, ErrorBox, Field, useAction } from "@/app/ui";
import { adminT } from "@/app/i18n/admin";
import { settingsRoute } from "./route";
import { parseSlots } from "@/core/fulfillment/slots";
import {
  parseClosedDates,
  parseClosedWeekdays,
  serializeClosedDates,
  unparsedClosedDates,
} from "@/core/fulfillment/closed-days";

export function FulfillmentCard({ settings }: { settings: Record<string, string> }) {
  const router = useRouter();
  const { shop } = settingsRoute.useRouteContext();
  const t = adminT(shop.locale);
  const [saved, setSaved] = useState(false);
  const save = useAction(async (f: FormData) => {
    setSaved(false);
    const closed = [1, 2, 3, 4, 5, 6, 7].filter((d) => f.get(`closed${d}`) === "on");
    if (closed.length === 7) throw new Error(t("settings.ful.closedAll"));
    const datesRaw = String(f.get("closed_dates") ?? "");
    const bad = unparsedClosedDates(datesRaw);
    if (bad.length) throw new Error(`${t("settings.ful.closedDates")}: ${bad.join("; ")}`);
    await saveSettingsFn({
      data: {
        fulfillment_pickup_enabled: f.get("pickup") === "on" ? "true" : "false",
        fulfillment_delivery_enabled: f.get("delivery") === "on" ? "true" : "false",
        payment_mode: String(f.get("payment_mode")),
        deposit_percent: String(f.get("deposit_percent") || "30"),
        // Слоты — по строке, чистит parseSlots (core/fulfillment/slots).
        fulfillment_slots: parseSlots(String(f.get("slots") ?? "")).join("\n"),
        fulfillment_day_limit: String(f.get("day_limit") ?? "").trim(),
        fulfillment_slot_limit: String(f.get("slot_limit") ?? "").trim(),
        fulfillment_closed_weekdays: closed.join(","),
        fulfillment_closed_dates: serializeClosedDates(parseClosedDates(datesRaw)),
      },
    });
    setSaved(true);
    await router.invalidate();
  });
  const [mode, setMode] = useState(settings.payment_mode ?? "full");
  return (
    <Card title={t("settings.ful.title")}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save.run(new FormData(e.currentTarget)).catch(() => {});
        }}
      >
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="pickup"
              defaultChecked={settings.fulfillment_pickup_enabled !== "false"}
            />{" "}
            {t("settings.ful.pickup")}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="delivery"
              defaultChecked={settings.fulfillment_delivery_enabled !== "false"}
            />{" "}
            {t("settings.ful.delivery")}
          </label>
        </div>
        <Field label={t("settings.ful.paymentMode")}>
          <select
            className="input"
            name="payment_mode"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
            <option value="full">{t("settings.ful.full")}</option>
            <option value="deposit">{t("settings.ful.deposit")}</option>
            <option value="on_receipt">{t("settings.ful.onReceipt")}</option>
          </select>
        </Field>
        {mode === "deposit" && (
          <Field label={t("settings.ful.depositPercent")}>
            <input
              className="input w-32"
              name="deposit_percent"
              type="number"
              min={1}
              max={100}
              defaultValue={settings.deposit_percent ?? "30"}
            />
          </Field>
        )}
        <Field label={t("settings.ful.slots")} hint={t("settings.ful.slotsHint")}>
          <textarea
            className="input"
            name="slots"
            rows={3}
            placeholder={"10:00–12:00\n12:00–14:00"}
            defaultValue={settings.fulfillment_slots ?? ""}
          />
        </Field>
        <Field label={t("settings.ful.closedWeekdays")}>
          <div className="flex flex-wrap gap-3 text-sm">
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <label key={d} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  name={`closed${d}`}
                  defaultChecked={parseClosedWeekdays(
                    settings.fulfillment_closed_weekdays,
                  ).includes(d)}
                />{" "}
                {t(`settings.ful.wd${d}` as Parameters<typeof t>[0])}
              </label>
            ))}
          </div>
        </Field>
        <Field label={t("settings.ful.closedDates")} hint={t("settings.ful.closedDatesHint")}>
          <textarea
            className="input"
            name="closed_dates"
            rows={3}
            placeholder={"31.12.2026\n30.12.2026–03.01.2027"}
            defaultValue={settings.fulfillment_closed_dates ?? ""}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("settings.ful.dayLimit")} hint={t("settings.ful.limitHint")}>
            <input
              className="input w-32"
              name="day_limit"
              type="number"
              min={1}
              max={1000}
              step={1}
              defaultValue={settings.fulfillment_day_limit ?? ""}
            />
          </Field>
          <Field label={t("settings.ful.slotLimit")}>
            <input
              className="input w-32"
              name="slot_limit"
              type="number"
              min={1}
              max={1000}
              step={1}
              defaultValue={settings.fulfillment_slot_limit ?? ""}
            />
          </Field>
        </div>
        {settings.fulfillment_slot_limit && !settings.fulfillment_slots?.trim() && (
          <p className="text-xs text-warn">{t("settings.ful.slotLimitNoSlots")}</p>
        )}
        <div className="flex items-center gap-3">
          <button className="btn-secondary" disabled={save.busy}>
            {t("common.save")}
          </button>
          {saved && <span className="text-xs text-ok">{t("settings.saved")}</span>}
        </div>
        <ErrorBox error={save.error} />
      </form>
    </Card>
  );
}

type Zone = Awaited<ReturnType<typeof deliveryZonesFn>>[number];

export function ZonesCard({ zones }: { zones: Zone[] }) {
  const router = useRouter();
  const { shop } = settingsRoute.useRouteContext();
  const t = adminT(shop.locale);
  const [editing, setEditing] = useState<Zone | "new" | null>(null);
  const save = useAction(async (f: FormData, id: string | null) => {
    await saveDeliveryZoneFn({
      data: {
        id,
        name: String(f.get("name")),
        price: Number(f.get("price")) || 0,
        isActive: f.get("isActive") === "on",
        sortOrder: Number(f.get("sortOrder")) || 0,
      },
    });
    setEditing(null);
    await router.invalidate();
  });
  const del = useAction(async (id: string) => {
    if (!confirm(t("settings.zones.deleteConfirm"))) return;
    await deleteDeliveryZoneFn({ data: { id } });
    await router.invalidate();
  });
  const cur = editing === "new" ? null : editing;
  return (
    <Card
      title={t("settings.zones.title")}
      actions={
        <button className="btn-secondary text-xs" onClick={() => setEditing("new")}>
          {t("settings.zones.add")}
        </button>
      }
    >
      <p className="mb-3 text-xs text-muted">{t("settings.zones.intro")}</p>
      {zones.length === 0 ? (
        <p className="text-sm text-muted">{t("settings.zones.empty")}</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {zones.map((z) => (
            <li key={z.id} className="flex items-center justify-between gap-3 py-2">
              <span>
                {z.name} <span className="text-muted">· {Number(z.price)}</span>{" "}
                {!z.is_active && <Badge>{t("settings.off")}</Badge>}
              </span>
              <span className="shrink-0">
                <button className="btn-ghost text-xs" onClick={() => setEditing(z)}>
                  {t("common.edit")}
                </button>
                <button
                  className="btn-ghost text-xs text-danger"
                  onClick={() => void del.run(z.id).catch(() => {})}
                >
                  {t("common.delete")}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <ErrorBox error={del.error} />
      {editing !== null && (
        <form
          key={cur?.id ?? "new"}
          className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-[1fr_120px_80px_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            void save.run(new FormData(e.currentTarget), cur?.id ?? null).catch(() => {});
          }}
        >
          <Field label={t("settings.name")}>
            <input
              className="input"
              name="name"
              defaultValue={cur?.name ?? ""}
              required
              maxLength={80}
              placeholder={t("settings.zones.namePlaceholder")}
            />
          </Field>
          <Field label={t("settings.zones.price")}>
            <input
              className="input"
              name="price"
              type="number"
              min={0}
              step="1"
              defaultValue={cur ? Number(cur.price) : 0}
            />
          </Field>
          <Field label={t("settings.order")}>
            <input
              className="input"
              name="sortOrder"
              type="number"
              defaultValue={cur?.sort_order ?? zones.length}
            />
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" name="isActive" defaultChecked={cur?.is_active ?? true} />{" "}
            {t("settings.zones.active")}
          </label>
          <div className="flex gap-2 sm:col-span-4">
            <button className="btn-primary" disabled={save.busy}>
              {t("common.save")}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>
              {t("common.cancel")}
            </button>
          </div>
          <ErrorBox error={save.error} />
        </form>
      )}
    </Card>
  );
}
