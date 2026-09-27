import { canEdit } from "@/core/auth/roles";
import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { createLeadFn, pipelineFn, updateLeadFn } from "@/app/admin/pipeline.functions";
import { adminT, intlLocale, type AdminT } from "@/app/i18n/admin";
import { ErrorBox, Field, PageTitle, useAction } from "@/app/ui";
import { formatMoney } from "@/core/money/money";
import type { BoardCard } from "@/core/pipeline/board";
import { PIPELINE_STAGES, type PipelineStage } from "@/core/pipeline/stages";

export const Route = createFileRoute("/admin/_authed/pipeline")({
  beforeLoad: ({ context }) => {
    if (!context.shop.modules.crm_pipeline) throw redirect({ to: "/admin" });
  },
  loader: () => pipelineFn(),
  component: PipelinePage,
});

/** Сумма колонки — по валютам: складывать тенге с рублями нельзя. */
function columnSum(cards: BoardCard[]): string {
  const by = new Map<string, number>();
  for (const c of cards)
    if (c.amount && c.currency) by.set(c.currency, (by.get(c.currency) ?? 0) + c.amount);
  return [...by].map(([cur, n]) => formatMoney(n, cur)).join(" + ");
}

function PipelinePage() {
  const { board, team } = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const canWrite = canEdit(shop.role);
  const [adding, setAdding] = useState(false);
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString(intlLocale(shop.locale), { dateStyle: "short" });
  return (
    <>
      <PageTitle
        title={t("pipeline.title")}
        subtitle={t("pipeline.subtitle")}
        actions={
          canWrite && !adding ? (
            <button className="btn-primary" onClick={() => setAdding(true)}>
              {t("pipeline.add")}
            </button>
          ) : null
        }
      />
      {adding && <NewLead t={t} onDone={() => setAdding(false)} />}
      <div className="-mx-4 overflow-x-auto px-4 pb-2">
        <div className="grid min-w-[1100px] grid-cols-6 gap-3">
          {board.columns.map((col) => {
            const sum = columnSum(col.cards);
            return (
              <section key={col.stage} className="flex min-w-0 flex-col gap-2">
                <header className="px-1">
                  <h2 className="text-sm font-semibold">{t(`pipeline.stage.${col.stage}`)}</h2>
                  <p className="text-xs text-muted">
                    {sum ? t("pipeline.total", { n: col.cards.length, sum }) : col.cards.length}
                  </p>
                </header>
                {col.cards.length === 0 ? (
                  <p className="rounded-md border border-dashed border-line p-3 text-center text-xs text-muted">
                    {t("pipeline.empty")}
                  </p>
                ) : (
                  col.cards.map((c) =>
                    c.kind === "order" ? (
                      <OrderCard key={`o${c.id}`} card={c} t={t} when={fmt(c.createdAt)} />
                    ) : (
                      <LeadCard
                        key={`l${c.id}`}
                        card={c}
                        t={t}
                        when={fmt(c.createdAt)}
                        team={team}
                        canWrite={canWrite}
                      />
                    ),
                  )
                )}
              </section>
            );
          })}
        </div>
      </div>
      <p className="mt-3 text-xs text-muted">{t("pipeline.closedHint")}</p>
    </>
  );
}

function Amount({ card }: { card: BoardCard }) {
  return card.amount && card.currency ? (
    <div className="text-sm font-medium tabular-nums">
      {formatMoney(card.amount, card.currency)}
    </div>
  ) : null;
}

function OrderCard({ card: c, t, when }: { card: BoardCard; t: AdminT; when: string }) {
  return (
    <Link
      to="/admin/orders/$id"
      params={{ id: c.id }}
      className="card block p-3 text-left hover:border-accent"
    >
      <div className="truncate text-sm font-medium">{c.title}</div>
      <Amount card={c} />
      <div className="mt-1 text-xs text-muted">
        {t("pipeline.order", { no: c.orderNo ?? c.id })} · {c.platform} · {when}
      </div>
    </Link>
  );
}

type LeadPatch = {
  stage?: PipelineStage;
  note?: string | null;
  owner?: string | null;
};

function LeadCard({
  card: c,
  t,
  when,
  team,
  canWrite,
}: {
  card: BoardCard;
  t: AdminT;
  when: string;
  team: string[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(c.note ?? "");
  const save = useAction(async (patch: LeadPatch) => {
    await updateLeadFn({ data: { id: c.id, ...patch } });
    setEditing(false);
    await router.invalidate();
  });
  const patch = (p: LeadPatch) => void save.run(p).catch(() => {});
  return (
    <div className="card p-3">
      <div className="truncate text-sm font-medium">{c.title}</div>
      {c.contact && c.contact !== c.title && (
        <div className="truncate text-xs text-muted">{c.contact}</div>
      )}
      <Amount card={c} />
      <div className="mt-1 text-xs text-muted">
        {t("pipeline.lead")} · {t(`pipeline.source.${c.source ?? "manual"}`)} · {when}
      </div>
      {c.note && !editing && <p className="mt-2 text-xs whitespace-pre-line">{c.note}</p>}
      {canWrite ? (
        <div className="mt-2 space-y-2">
          <select
            className="input text-xs"
            aria-label={t("pipeline.moveTo")}
            value={c.stage}
            disabled={save.busy}
            onChange={(e) => patch({ stage: e.target.value as PipelineStage })}
          >
            {PIPELINE_STAGES.map((s) => (
              <option key={s} value={s}>
                {t(`pipeline.stage.${s}`)}
              </option>
            ))}
          </select>
          <select
            className="input text-xs"
            aria-label={t("pipeline.owner")}
            value={c.owner ?? ""}
            disabled={save.busy}
            onChange={(e) => patch({ owner: e.target.value || null })}
          >
            <option value="">{t("pipeline.noOwner")}</option>
            {team.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
          {editing ? (
            <>
              <textarea
                className="input text-xs"
                rows={3}
                maxLength={1000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <div className="flex gap-2">
                <button
                  className="btn-primary text-xs"
                  disabled={save.busy}
                  onClick={() => patch({ note: note.trim() || null })}
                >
                  {t("pipeline.save")}
                </button>
                <button className="btn-ghost text-xs" onClick={() => setEditing(false)}>
                  {t("pipeline.cancel")}
                </button>
              </div>
            </>
          ) : (
            <button className="btn-ghost text-xs" onClick={() => setEditing(true)}>
              {t("pipeline.editNote")}
            </button>
          )}
          <ErrorBox error={save.error} />
        </div>
      ) : (
        c.owner && (
          <div className="mt-1 text-xs text-muted">
            {t("pipeline.owner")}: {c.owner}
          </div>
        )
      )}
    </div>
  );
}

function NewLead({ t, onDone }: { t: AdminT; onDone: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const create = useAction(async () => {
    const n = Number(amount.replace(",", "."));
    await createLeadFn({
      data: { name, contact, note, amount: Number.isFinite(n) && n > 0 ? n : null },
    });
    onDone();
    await router.invalidate();
  });
  return (
    <div className="card mb-4 grid gap-3 p-4 sm:grid-cols-2">
      <Field label={t("pipeline.name")}>
        <input
          className="input"
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label={t("pipeline.contact")}>
        <input
          className="input"
          maxLength={120}
          value={contact}
          onChange={(e) => setContact(e.target.value)}
        />
      </Field>
      <Field label={t("pipeline.amount")}>
        <input
          className="input"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </Field>
      <Field label={t("pipeline.note")}>
        <input
          className="input"
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <div className="flex gap-2 sm:col-span-2">
        <button
          className="btn-primary"
          disabled={create.busy || !(name.trim() || contact.trim())}
          onClick={() => void create.run().catch(() => {})}
        >
          {t("pipeline.save")}
        </button>
        <button className="btn-ghost" onClick={onDone}>
          {t("pipeline.cancel")}
        </button>
      </div>
      <div className="sm:col-span-2">
        <ErrorBox error={create.error} />
      </div>
    </div>
  );
}
