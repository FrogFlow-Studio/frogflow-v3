import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { consultantFn, consultantTestFn, saveConsultantFn } from "@/app/admin/admin.functions";
import { Badge, Card, ErrorBox, Field, PageTitle, Switch, useAction } from "@/app/ui";
import {
  GOAL_LABELS,
  GOALS,
  TONE_LABELS,
  TONES,
  type ConsultantProfile,
} from "@/core/consultant/profile";
import type { KnowledgeDoc } from "@/core/consultant/knowledge";

export const Route = createFileRoute("/admin/_authed/consultant")({
  loader: () => consultantFn(),
  component: ConsultantPage,
});

function ConsultantPage() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const [enabled, setEnabled] = useState(data.enabled);
  const [profile, setProfile] = useState<ConsultantProfile>(data.profile);
  const [docs, setDocs] = useState<KnowledgeDoc[]>(data.docs);
  const [saved, setSaved] = useState(false);
  const save = useAction(async () => {
    setSaved(false);
    await saveConsultantFn({
      data: {
        enabled,
        profile,
        docs: docs
          .filter((d) => d.title.trim() && d.content.trim())
          .map((d) => ({
            id: d.id,
            title: d.title.trim(),
            category: d.category?.trim() || undefined,
            content: d.content.trim(),
          })),
      },
    });
    setSaved(true);
    await router.invalidate();
  });
  const set = <K extends keyof ConsultantProfile>(k: K, v: ConsultantProfile[K]) =>
    setProfile((p) => ({ ...p, [k]: v }));
  const setDoc = (i: number, patch: Partial<KnowledgeDoc>) =>
    setDocs((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  return (
    <>
      <PageTitle
        title="ИИ-консультант"
        subtitle="Отвечает покупателям на свободные вопросы в боте по вашему профилю, базе знаний и каталогу. Сложное передаёт вам в «Чат» и присылает заявку в Telegram."
      />
      {!data.configured && (
        <div className="mb-4 rounded-md border border-warn/40 bg-warn/15 px-3 py-2 text-sm">
          На платформе не задан ключ Anthropic — консультант не ответит, пока оператор его не
          добавит. Настройки можно заполнить заранее.
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="space-y-4">
          <Card title="Профиль бизнеса">
            <div className="mb-4 flex items-center gap-3">
              <Switch checked={enabled} onChange={setEnabled} label="Включить консультанта" />
              <span className="text-sm">
                {enabled
                  ? "Отвечает на свободный текст в боте"
                  : "Выключен — на свободный текст бот показывает меню"}
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Название компании">
                <input
                  className="input"
                  value={profile.brand_name}
                  onChange={(e) => set("brand_name", e.target.value)}
                />
              </Field>
              <Field label="Сайт" hint="Необязательно">
                <input
                  className="input"
                  value={profile.website_url ?? ""}
                  onChange={(e) => set("website_url", e.target.value || undefined)}
                  placeholder="https://"
                />
              </Field>
              <Field label="Цель диалога">
                <select
                  className="input"
                  value={profile.goal}
                  onChange={(e) => set("goal", e.target.value as ConsultantProfile["goal"])}
                >
                  {GOALS.map((g) => (
                    <option key={g} value={g}>
                      {GOAL_LABELS[g]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Тон общения">
                <select
                  className="input"
                  value={profile.tone}
                  onChange={(e) => set("tone", e.target.value as ConsultantProfile["tone"])}
                >
                  {TONES.map((t) => (
                    <option key={t} value={t}>
                      {TONE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Основной язык" hint="Клиенту отвечает на его языке">
                <select
                  className="input"
                  value={profile.primary_language}
                  onChange={(e) =>
                    set("primary_language", e.target.value as ConsultantProfile["primary_language"])
                  }
                >
                  <option value="ru">Русский</option>
                  <option value="kk">Қазақша</option>
                  <option value="en">English</option>
                </select>
              </Field>
              <Field label="Валюта цен">
                <input
                  className="input"
                  value={profile.currency}
                  maxLength={3}
                  onChange={(e) => set("currency", e.target.value.toUpperCase())}
                />
              </Field>
              <Field label="Страны" hint="Через запятую: KZ, RU">
                <input
                  className="input"
                  value={profile.countries.join(", ")}
                  onChange={(e) =>
                    set(
                      "countries",
                      e.target.value
                        .split(",")
                        .map((c) => c.trim().toUpperCase())
                        .filter(Boolean),
                    )
                  }
                />
              </Field>
            </div>
            <div className="mt-3 space-y-3">
              <Field
                label="О компании"
                hint="Что продаёте, кому, чем отличаетесь — 2–3 предложения"
              >
                <textarea
                  className="input min-h-20"
                  value={profile.about ?? ""}
                  onChange={(e) => set("about", e.target.value || undefined)}
                />
              </Field>
              <Field label="Условия доставки">
                <textarea
                  className="input min-h-16"
                  value={profile.delivery_info ?? ""}
                  onChange={(e) => set("delivery_info", e.target.value || undefined)}
                  placeholder="Курьер по Алматы в день заказа, СДЭК по стране…"
                />
              </Field>
              <Field label="Условия оплаты">
                <textarea
                  className="input min-h-16"
                  value={profile.payment_info ?? ""}
                  onChange={(e) => set("payment_info", e.target.value || undefined)}
                  placeholder="Kaspi QR, перевод, карта…"
                />
              </Field>
              <Field
                label="Особые указания"
                hint="Что говорить и чего не обещать. Например: «не называть сроки быстрее 2 дней», «предлагать открытку к букету»"
              >
                <textarea
                  className="input min-h-20"
                  value={profile.custom_instructions ?? ""}
                  onChange={(e) => set("custom_instructions", e.target.value || undefined)}
                />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(profile.medical_disclaimer)}
                  onChange={(e) => set("medical_disclaimer", e.target.checked)}
                />
                Добавлять дисклеймер про БАДы и консультацию врача
              </label>
            </div>
          </Card>

          <Card
            title="База знаний"
            actions={
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() =>
                  setDocs((ds) => [...ds, { id: `doc${Date.now()}`, title: "", content: "" }])
                }
              >
                + Документ
              </button>
            }
          >
            <p className="mb-3 text-sm text-muted">
              Условия, ответы на частые вопросы, описания услуг, регламенты. Консультант отвечает
              только по этим текстам и каталогу — чего здесь нет, того он не обещает.
            </p>
            {docs.length === 0 && (
              <p className="text-sm text-muted">
                Пока нет документов. Каталог товаров консультант видит и без них.
              </p>
            )}
            <div className="space-y-4">
              {docs.map((d, i) => (
                <div key={d.id} className="rounded-md border border-line p-3">
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                    <input
                      className="input"
                      placeholder="Название документа"
                      value={d.title}
                      onChange={(e) => setDoc(i, { title: e.target.value })}
                    />
                    <input
                      className="input sm:w-40"
                      placeholder="Раздел"
                      value={d.category ?? ""}
                      onChange={(e) => setDoc(i, { category: e.target.value })}
                    />
                    <button
                      type="button"
                      className="btn-ghost text-xs text-danger"
                      onClick={() => setDocs((ds) => ds.filter((_, j) => j !== i))}
                    >
                      Удалить
                    </button>
                  </div>
                  <textarea
                    className="input mt-2 min-h-24"
                    placeholder="Текст документа"
                    value={d.content}
                    onChange={(e) => setDoc(i, { content: e.target.value })}
                  />
                </div>
              ))}
            </div>
          </Card>

          <div className="flex items-center gap-3">
            <button
              className="btn-primary"
              disabled={save.busy}
              onClick={() => void save.run().catch(() => {})}
            >
              {save.busy ? "Сохраняем…" : "Сохранить"}
            </button>
            {saved && <span className="text-sm text-ok">Сохранено</span>}
          </div>
          <ErrorBox error={save.error} />
        </div>

        <div className="space-y-4">
          <TestChat configured={data.configured} />
          <Card title="Расход">
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-muted">Ответов всего</dt>
              <dd className="tabular-nums">{data.usage.count}</dd>
              <dt className="text-muted">Стоимость всего</dt>
              <dd className="tabular-nums">${data.usage.usd.toFixed(4)}</dd>
              <dt className="text-muted">Токенов вход / выход</dt>
              <dd className="tabular-nums">
                {data.usage.inputTokens.toLocaleString("ru")} /{" "}
                {data.usage.outputTokens.toLocaleString("ru")}
              </dd>
            </dl>
            {data.lastError && (
              <p className="mt-3 text-xs text-danger">Последняя ошибка: {data.lastError}</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function TestChat({ configured }: { configured: boolean }) {
  const [q, setQ] = useState("");
  const [log, setLog] = useState<
    Array<{ q: string; a: string; handoff: string | null; usd: number }>
  >([]);
  const ask = useAction(async () => {
    const r = await consultantTestFn({ data: { text: q } });
    setLog((l) => [
      ...l,
      {
        q,
        a: r.reply,
        handoff: r.handoff ? `${r.handoff.kind}: ${r.handoff.reason} — ${r.handoff.summary}` : null,
        usd: r.usage.usd,
      },
    ]);
    setQ("");
  });
  return (
    <Card title="Проверить ответы">
      <p className="mb-3 text-sm text-muted">
        Задайте вопрос как покупатель. Ответ считается по сохранённым настройкам; история здесь не
        ведётся.
      </p>
      <div className="mb-3 max-h-80 space-y-3 overflow-auto">
        {log.map((m, i) => (
          <div key={i} className="space-y-1 text-sm">
            <div className="ml-auto w-fit max-w-[90%] rounded-2xl rounded-br-sm bg-accent px-3 py-2 text-accent-fg">
              {m.q}
            </div>
            <div className="w-fit max-w-[90%] rounded-2xl rounded-bl-sm bg-surface-2 px-3 py-2 whitespace-pre-wrap">
              {m.a}
            </div>
            <div className="text-xs text-muted">
              ${m.usd.toFixed(4)}
              {m.handoff && (
                <>
                  {" "}
                  · <Badge tone="warn">передача менеджеру</Badge> {m.handoff}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask.run().catch(() => {});
        }}
      >
        <input
          className="input"
          placeholder="Например: есть ли доставка в Астану?"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          disabled={!configured}
        />
        <button className="btn-secondary shrink-0" disabled={!configured || ask.busy || !q.trim()}>
          {ask.busy ? "…" : "Спросить"}
        </button>
      </form>
      <ErrorBox error={ask.error} />
    </Card>
  );
}
