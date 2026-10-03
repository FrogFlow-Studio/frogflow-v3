import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  addLeadFn,
  leadEventsFn,
  leadsFn,
  saveLeadNoteFn,
  scoreLeadFn,
  setLeadStageFn,
} from "@/app/operator/operator.functions";
import type { LeadEventRow, LeadRow } from "@/app/operator/leads.server";
import {
  LEAD_STAGES,
  LEAD_STAGE_LABEL,
  funnelCounts,
  isLeadStage,
  leadMatches,
  type LeadStage,
} from "@/core/leads/leads";
import { Badge, Card, Empty, ErrorBox, Field, PageTitle, useAction } from "@/app/ui";

export const Route = createFileRoute("/operator/_authed/leads")({
  loader: () => leadsFn(),
  component: LeadsPage,
});

const TONE: Record<LeadStage, "neutral" | "ok" | "warn" | "danger" | "accent"> = {
  new: "neutral",
  qualified: "accent",
  contacted: "accent",
  replied: "ok",
  hot: "warn",
  converted: "ok",
  rejected: "danger",
  lost: "danger",
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("ru") : "—");
/** `datetime-local` отдаёт время без пояса: берём его как местное и сохраняем в ISO. */
const localToIso = (v: string) => (v ? new Date(v).toISOString() : null);
const isoToLocal = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

/**
 * Воронка лидов отдела продаж FrogFlow (таблица общая с v1). Здесь ведут лидов
 * вручную: стадия, заметки, следующий шаг, журнал. Автопоиск, ИИ-оценка и
 * автоматическая рассылка v1 сюда не перенесены.
 */
function LeadsPage() {
  const { leads, aiAvailable } = Route.useLoaderData();
  const router = useRouter();
  const [stage, setStage] = useState<LeadStage | "all">("all");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const counts = useMemo(() => funnelCounts(leads), [leads]);
  const shown = leads.filter(
    (l) =>
      (stage === "all" || (isLeadStage(l.stage) ? l.stage : "new") === stage) &&
      leadMatches(l, query),
  );
  const add = useAction(async (f: FormData) => {
    const r = await addLeadFn({
      data: {
        businessName: String(f.get("businessName") ?? ""),
        niche: String(f.get("niche") ?? ""),
        city: String(f.get("city") ?? ""),
        websiteUrl: String(f.get("websiteUrl") ?? ""),
        instagramHandle: String(f.get("instagramHandle") ?? ""),
        phone: String(f.get("phone") ?? ""),
        email: String(f.get("email") ?? ""),
        signals: String(f.get("signals") ?? ""),
      },
    });
    setNotice(r.ok ? "Лид добавлен" : `Такой лид уже есть: ${r.duplicate}`);
    await router.invalidate();
    return r.ok;
  });
  return (
    <>
      <PageTitle
        title="Лиды"
        subtitle="Воронка продаж FrogFlow: кого нашли, кому написали, кто ответил. Данные общие с v1."
      />
      {notice && <p className="mb-3 text-sm text-ok">{notice}</p>}
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Стадии">
        <button
          className={stage === "all" ? "btn-primary" : "btn-secondary"}
          onClick={() => setStage("all")}
        >
          {`Все · ${leads.length}`}
        </button>
        {LEAD_STAGES.map((s) => (
          <button
            key={s}
            className={stage === s ? "btn-primary" : "btn-secondary"}
            onClick={() => setStage(s)}
          >
            {`${LEAD_STAGE_LABEL[s]} · ${counts[s]}`}
          </button>
        ))}
      </div>
      <input
        className="input mb-4 max-w-md"
        type="search"
        placeholder="Поиск: название, город, контакт, заметка"
        aria-label="Поиск по лидам"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        {shown.length === 0 && <Empty>Лидов с такими условиями нет.</Empty>}
        {shown.map((l) => (
          <LeadCard key={l.id} lead={l} aiAvailable={aiAvailable} onChanged={(m) => setNotice(m)} />
        ))}
        <Card title="Новый лид">
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              setNotice(null);
              const form = e.currentTarget;
              void add
                .run(new FormData(form))
                .then((ok) => ok && form.reset())
                .catch(() => {});
            }}
          >
            <Field label="Название">
              <input className="input" name="businessName" required maxLength={120} />
            </Field>
            <Field label="Ниша">
              <input className="input" name="niche" maxLength={80} />
            </Field>
            <Field label="Город">
              <input className="input" name="city" maxLength={80} />
            </Field>
            <Field label="Instagram">
              <input className="input" name="instagramHandle" placeholder="@name или ссылка" />
            </Field>
            <Field label="Телефон / WhatsApp">
              <input className="input" name="phone" inputMode="tel" />
            </Field>
            <Field label="Почта">
              <input className="input" name="email" type="email" />
            </Field>
            <Field label="Сайт">
              <input className="input" name="websiteUrl" />
            </Field>
            <Field label="Что заметили" hint="Почему он подходит: сигналы из профиля или сайта.">
              <input className="input" name="signals" maxLength={1000} />
            </Field>
            <div className="sm:col-span-2">
              <button className="btn-primary" disabled={add.busy}>
                Добавить лид
              </button>
            </div>
            <ErrorBox error={add.error} />
          </form>
        </Card>
      </div>
    </>
  );
}

function LeadCard({
  lead,
  aiAvailable,
  onChanged,
}: {
  lead: LeadRow;
  aiAvailable: boolean;
  onChanged: (msg: string) => void;
}) {
  const router = useRouter();
  const current: LeadStage = isLeadStage(lead.stage) ? lead.stage : "new";
  const [events, setEvents] = useState<LeadEventRow[] | null>(null);
  const move = useAction(async (to: LeadStage) => {
    const lostReason =
      to === "lost" ? (window.prompt("Почему потерян? (можно оставить пустым)") ?? null) : null;
    if (to === "lost" && lostReason === null) return;
    const r = await setLeadStageFn({ data: { id: lead.id, from: lead.stage, to, lostReason } });
    onChanged(
      r.ok
        ? `${lead.business_name}: ${LEAD_STAGE_LABEL[to]}`
        : "Лид уже изменили в другом месте — список обновлён, повторите",
    );
    setEvents(null);
    await router.invalidate();
  });
  const save = useAction(async (f: FormData) => {
    await saveLeadNoteFn({
      data: {
        id: lead.id,
        notes: String(f.get("notes") ?? "") || null,
        nextAction: String(f.get("nextAction") ?? "") || null,
        nextActionAt: localToIso(String(f.get("nextActionAt") ?? "")),
      },
    });
    onChanged(`${lead.business_name}: заметка сохранена`);
    await router.invalidate();
  });
  const score = useAction(async () => {
    const r = await scoreLeadFn({ data: { id: lead.id } });
    onChanged(
      !r.ok
        ? r.reason === "not_found"
          ? "Лид уже удалён — список обновлён"
          : "ИИ ответил непонятно — оценка не записана, попробуйте ещё раз"
        : `${lead.business_name}: оценка ${r.score}${
            r.movedTo ? ` → ${LEAD_STAGE_LABEL[r.movedTo]}` : ""
          }`,
    );
    setEvents(null);
    await router.invalidate();
  });
  const log = useAction(async () => {
    setEvents((await leadEventsFn({ data: { id: lead.id } })).events);
  });
  const links = [
    lead.instagram_handle && {
      href: `https://instagram.com/${lead.instagram_handle}`,
      text: `@${lead.instagram_handle}`,
    },
    lead.phone && { href: `https://wa.me/${lead.phone}`, text: `+${lead.phone}` },
    lead.email && { href: `mailto:${lead.email}`, text: lead.email },
    lead.website_url && { href: `https://${lead.website_url}`, text: lead.website_url },
  ].filter((x): x is { href: string; text: string } => Boolean(x));
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          {lead.business_name} <Badge tone={TONE[current]}>{LEAD_STAGE_LABEL[current]}</Badge>
        </span>
      }
    >
      <div className="space-y-3 text-sm">
        <div className="text-muted">
          {[lead.niche, lead.city].filter(Boolean).join(" · ") || "Ниша и город не указаны"}
          {typeof lead.score === "number" ? ` · оценка ${lead.score}` : ""}
        </div>
        {lead.score_reason && <p className="text-muted">{lead.score_reason}</p>}
        {links.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {links.map((x) => (
              <a
                key={x.href}
                className="text-accent underline"
                href={x.href}
                target="_blank"
                rel="noreferrer"
              >
                {x.text}
              </a>
            ))}
          </div>
        )}
        {lead.signals && <p>{lead.signals}</p>}
        {lead.stage === "lost" && lead.lost_reason && (
          <p className="text-muted">Причина: {lead.lost_reason}</p>
        )}
        <label className="block">
          <span className="label">Стадия</span>
          <select
            className="input"
            value={current}
            disabled={move.busy}
            onChange={(e) => {
              const to = e.target.value;
              if (isLeadStage(to)) void move.run(to).catch(() => {});
            }}
          >
            {LEAD_STAGES.map((s) => (
              <option key={s} value={s}>
                {LEAD_STAGE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save.run(new FormData(e.currentTarget)).catch(() => {});
          }}
        >
          <textarea
            className="input"
            name="notes"
            rows={2}
            maxLength={4000}
            placeholder="Заметки"
            aria-label="Заметки"
            defaultValue={lead.notes ?? ""}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className="input"
              name="nextAction"
              maxLength={300}
              placeholder="Следующий шаг"
              aria-label="Следующий шаг"
              defaultValue={lead.next_action ?? ""}
            />
            <input
              className="input"
              name="nextActionAt"
              type="datetime-local"
              aria-label="Когда"
              defaultValue={isoToLocal(lead.next_action_at)}
            />
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary" disabled={save.busy}>
              Сохранить заметку
            </button>
            {aiAvailable && (
              <button
                type="button"
                className="btn-secondary"
                disabled={score.busy}
                onClick={() => void score.run().catch(() => {})}
              >
                {score.busy ? "Оцениваю…" : "Оценить"}
              </button>
            )}
            <button
              type="button"
              className="text-xs text-muted underline"
              onClick={() => void log.run().catch(() => {})}
            >
              Журнал
            </button>
          </div>
        </form>
        {events && (
          <ul className="grid gap-1 text-xs text-muted">
            {events.length === 0 && <li>Событий пока нет</li>}
            {events.map((ev) => (
              <li key={ev.id}>
                {when(ev.created_at)} · {ev.actor} · {ev.detail ?? ev.kind}
              </li>
            ))}
          </ul>
        )}
        <ErrorBox error={move.error ?? save.error ?? score.error ?? log.error} />
      </div>
    </Card>
  );
}
