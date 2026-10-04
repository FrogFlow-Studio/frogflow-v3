import { canEdit } from "@/core/auth/roles";
import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import {
  addSupplierFn,
  removeSupplierFn,
  suppliersFn,
  updateSupplierFn,
} from "@/app/admin/warehouse.functions";
import { adminT, type AdminT } from "@/app/i18n/admin";
import { Card, ErrorBox, Field, PageTitle, useAction } from "@/app/ui";

export const Route = createFileRoute("/admin/_authed/warehouse/suppliers")({
  beforeLoad: ({ context }) => {
    if (!context.shop.modules.warehouse) throw redirect({ to: "/admin" });
  },
  loader: () => suppliersFn(),
  component: SuppliersPage,
});

type Row = Awaited<ReturnType<typeof suppliersFn>>["items"][number];

function SuppliersPage() {
  const { rev, items, products } = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const canWrite = canEdit(shop.role);
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  // После любой записи (и после «список изменился») берём список заново: rev — свежий.
  const save = useAction(async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setAdding(false);
      setEditing(null);
    } finally {
      await router.invalidate();
    }
  });
  const run = (fn: () => Promise<unknown>) => void save.run(fn).catch(() => {});
  return (
    <>
      <PageTitle
        title={t("suppliers.title")}
        subtitle={t("suppliers.subtitle")}
        actions={
          <>
            <Link to="/admin/warehouse" className="btn-ghost">
              {t("warehouse.back")}
            </Link>
            {canWrite && !adding && (
              <button className="btn-primary" onClick={() => setAdding(true)}>
                {t("suppliers.add")}
              </button>
            )}
          </>
        }
      />
      <div className="space-y-3">
        <ErrorBox error={save.error} />
        {adding && (
          <SupplierForm
            t={t}
            busy={save.busy}
            onCancel={() => setAdding(false)}
            onSave={(supplier) => run(() => addSupplierFn({ data: { rev, supplier } }))}
          />
        )}
        {items.length === 0 && !adding && (
          <p className="text-sm text-muted">{t("suppliers.empty")}</p>
        )}
        {items.map((s) =>
          editing === s.id ? (
            <SupplierForm
              key={s.id}
              t={t}
              busy={save.busy}
              initial={s}
              onCancel={() => setEditing(null)}
              onSave={(supplier) =>
                run(() => updateSupplierFn({ data: { rev, id: s.id, supplier } }))
              }
            />
          ) : (
            <Card
              key={s.id}
              title={s.name}
              actions={
                canWrite ? (
                  <div className="flex gap-2">
                    <button className="btn-ghost text-xs" onClick={() => setEditing(s.id)}>
                      {t("suppliers.edit")}
                    </button>
                    <button
                      className="btn-ghost text-xs"
                      disabled={save.busy}
                      onClick={() => {
                        if (
                          confirm(
                            t("suppliers.removeConfirm", { name: s.name, n: products[s.id] ?? 0 }),
                          )
                        )
                          run(() => removeSupplierFn({ data: { rev, id: s.id } }));
                      }}
                    >
                      {t("suppliers.remove")}
                    </button>
                  </div>
                ) : null
              }
            >
              <SupplierInfo s={s} n={products[s.id] ?? 0} t={t} />
            </Card>
          ),
        )}
      </div>
    </>
  );
}

function SupplierInfo({ s, n, t }: { s: Row; n: number; t: AdminT }) {
  return (
    <div className="space-y-1 text-sm">
      {(s.contact || s.phone) && <div>{[s.contact, s.phone].filter(Boolean).join(" · ")}</div>}
      {s.note && <p className="whitespace-pre-line text-muted">{s.note}</p>}
      <div className="text-xs text-muted">{t("suppliers.products", { n })}</div>
    </div>
  );
}

function SupplierForm({
  t,
  busy,
  initial,
  onSave,
  onCancel,
}: {
  t: AdminT;
  busy: boolean;
  initial?: Row;
  onSave: (v: { name: string; contact: string; phone: string; note: string }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [contact, setContact] = useState(initial?.contact ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  return (
    <Card>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ name, contact, phone, note });
        }}
      >
        <Field label={t("suppliers.name")}>
          <input
            className="input"
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label={t("suppliers.contact")}>
          <input
            className="input"
            maxLength={120}
            value={contact}
            onChange={(e) => setContact(e.target.value)}
          />
        </Field>
        <Field label={t("suppliers.phone")}>
          <input
            className="input"
            maxLength={40}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>
        <Field label={t("suppliers.note")}>
          <textarea
            className="input"
            rows={2}
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <div className="flex gap-2 sm:col-span-2">
          <button className="btn-primary" disabled={busy}>
            {t("suppliers.save")}
          </button>
          <button type="button" className="btn-ghost" onClick={onCancel}>
            {t("suppliers.cancel")}
          </button>
        </div>
      </form>
    </Card>
  );
}
