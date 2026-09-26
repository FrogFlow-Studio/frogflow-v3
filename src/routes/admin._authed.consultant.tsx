import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { consultantFn, consultantTestFn, saveConsultantFn } from "@/app/admin/admin.functions";
import { deleteStoryTagFn, storyTagsFn, upsertStoryTagFn } from "@/app/admin/consultant.functions";
import { Badge, Card, ErrorBox, Field, PageTitle, Switch, useAction } from "@/app/ui";
import { adminT, intlLocale, type AdminKey, type AdminT } from "@/app/i18n/admin";
import { GOALS, TONES, type ConsultantProfile } from "@/core/consultant/profile";
import type { KnowledgeDoc } from "@/core/consultant/knowledge";

export const Route = createFileRoute("/admin/_authed/consultant")({
  loader: () => consultantFn(),
  component: ConsultantPage,
});

function ConsultantPage() {
  const data = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const loc = intlLocale(shop.locale);
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
      <PageTitle title={t("consultant.title")} subtitle={t("consultant.subtitle")} />
      {!data.configured && (
        <div className="mb-4 rounded-md border border-warn/40 bg-warn/15 px-3 py-2 text-sm">
          {t("consultant.notConfigured")}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="space-y-4">
          <Card title={t("consultant.profile.title")}>
            <div className="mb-4 flex items-center gap-3">
              <Switch checked={enabled} onChange={setEnabled} label={t("consultant.enable")} />
              <span className="text-sm">
                {enabled ? t("consultant.enabledHint") : t("consultant.disabledHint")}
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("consultant.brandName")}>
                <input
                  className="input"
                  value={profile.brand_name}
                  onChange={(e) => set("brand_name", e.target.value)}
                />
              </Field>
              <Field label={t("consultant.website")} hint={t("consultant.optional")}>
                <input
                  className="input"
                  value={profile.website_url ?? ""}
                  onChange={(e) => set("website_url", e.target.value || undefined)}
                  placeholder="https://"
                />
              </Field>
              <Field label={t("consultant.goal")}>
                <select
                  className="input"
                  value={profile.goal}
                  onChange={(e) => set("goal", e.target.value as ConsultantProfile["goal"])}
                >
                  {GOALS.map((g) => (
                    <option key={g} value={g}>
                      {t(`consultant.goal.${g}` as AdminKey)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("consultant.tone")}>
                <select
                  className="input"
                  value={profile.tone}
                  onChange={(e) => set("tone", e.target.value as ConsultantProfile["tone"])}
                >
                  {TONES.map((tone) => (
                    <option key={tone} value={tone}>
                      {t(`consultant.tone.${tone}` as AdminKey)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("consultant.language")} hint={t("consultant.languageHint")}>
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
              <Field label={t("consultant.currency")}>
                <input
                  className="input"
                  value={profile.currency}
                  maxLength={3}
                  onChange={(e) => set("currency", e.target.value.toUpperCase())}
                />
              </Field>
              <Field label={t("consultant.countries")} hint={t("consultant.countriesHint")}>
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
              <Field label={t("consultant.about")} hint={t("consultant.aboutHint")}>
                <textarea
                  className="input min-h-20"
                  value={profile.about ?? ""}
                  onChange={(e) => set("about", e.target.value || undefined)}
                />
              </Field>
              <Field label={t("consultant.delivery")}>
                <textarea
                  className="input min-h-16"
                  value={profile.delivery_info ?? ""}
                  onChange={(e) => set("delivery_info", e.target.value || undefined)}
                  placeholder={t("consultant.deliveryPlaceholder")}
                />
              </Field>
              <Field label={t("consultant.payment")}>
                <textarea
                  className="input min-h-16"
                  value={profile.payment_info ?? ""}
                  onChange={(e) => set("payment_info", e.target.value || undefined)}
                  placeholder={t("consultant.paymentPlaceholder")}
                />
              </Field>
              <Field label={t("consultant.instructions")} hint={t("consultant.instructionsHint")}>
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
                {t("consultant.medicalDisclaimer")}
              </label>
            </div>
          </Card>

          <Card
            title={t("consultant.knowledge.title")}
            actions={
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() =>
                  setDocs((ds) => [...ds, { id: `doc${Date.now()}`, title: "", content: "" }])
                }
              >
                {t("consultant.knowledge.add")}
              </button>
            }
          >
            <p className="mb-3 text-sm text-muted">{t("consultant.knowledge.intro")}</p>
            {docs.length === 0 && (
              <p className="text-sm text-muted">{t("consultant.knowledge.empty")}</p>
            )}
            <div className="space-y-4">
              {docs.map((d, i) => (
                <div key={d.id} className="rounded-md border border-line p-3">
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                    <input
                      className="input"
                      placeholder={t("consultant.knowledge.docTitle")}
                      value={d.title}
                      onChange={(e) => setDoc(i, { title: e.target.value })}
                    />
                    <input
                      className="input sm:w-40"
                      placeholder={t("consultant.knowledge.category")}
                      value={d.category ?? ""}
                      onChange={(e) => setDoc(i, { category: e.target.value })}
                    />
                    <button
                      type="button"
                      className="btn-ghost text-xs text-danger"
                      onClick={() => setDocs((ds) => ds.filter((_, j) => j !== i))}
                    >
                      {t("common.delete")}
                    </button>
                  </div>
                  <textarea
                    className="input mt-2 min-h-24"
                    placeholder={t("consultant.knowledge.content")}
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
              {save.busy ? t("consultant.saving") : t("common.save")}
            </button>
            {saved && <span className="text-sm text-ok">{t("consultant.saved")}</span>}
          </div>
          <ErrorBox error={save.error} />
        </div>

        <div className="space-y-4">
          <TestChat configured={data.configured} t={t} />
          {shop.modules.instagram && <StoriesCard t={t} />}
          <Card title={t("consultant.usage.title")}>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-muted">{t("consultant.usage.count")}</dt>
              <dd className="tabular-nums">{data.usage.count}</dd>
              <dt className="text-muted">{t("consultant.usage.cost")}</dt>
              <dd className="tabular-nums">${data.usage.usd.toFixed(4)}</dd>
              <dt className="text-muted">{t("consultant.usage.tokens")}</dt>
              <dd className="tabular-nums">
                {data.usage.inputTokens.toLocaleString(loc)} /{" "}
                {data.usage.outputTokens.toLocaleString(loc)}
              </dd>
            </dl>
            {data.lastError && (
              <p className="mt-3 text-xs text-danger">
                {t("consultant.usage.lastError", { error: data.lastError })}
              </p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function TestChat({ configured, t }: { configured: boolean; t: AdminT }) {
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
    <Card title={t("consultant.test.title")}>
      <p className="mb-3 text-sm text-muted">{t("consultant.test.intro")}</p>
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
                  · <Badge tone="warn">{t("consultant.test.handoff")}</Badge> {m.handoff}
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
          placeholder={t("consultant.test.placeholder")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          disabled={!configured}
        />
        <button className="btn-secondary shrink-0" disabled={!configured || ask.busy || !q.trim()}>
          {ask.busy ? "…" : t("consultant.test.ask")}
        </button>
      </form>
      <ErrorBox error={ask.error} />
    </Card>
  );
}

type StoryTags = Awaited<ReturnType<typeof storyTagsFn>>;

/**
 * Теги товаров на сторис: покупатель ответил на сторис «сколько стоит?» —
 * консультант знает, какой товар на ней, и отвечает по делу.
 */
function StoriesCard({ t }: { t: AdminT }) {
  const [data, setData] = useState<StoryTags | null>(null);
  const [story, setStory] = useState("");
  const [productId, setProductId] = useState("");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [notes, setNotes] = useState("");
  const reload = async () => setData(await storyTagsFn());
  useEffect(() => {
    void reload();
  }, []);
  const add = useAction(async () => {
    const product = data?.products.find((p) => p.id === productId);
    await upsertStoryTagFn({
      data: {
        story,
        productId: productId || null,
        productName: (product?.name ?? name).trim(),
        price: price.trim() ? Number(price) : null,
        notes: notes.trim() || null,
      },
    });
    setStory("");
    setName("");
    setPrice("");
    setNotes("");
    await reload();
  });
  const del = useAction(async (id: string) => {
    await deleteStoryTagFn({ data: { id } });
    await reload();
  });
  return (
    <Card title={t("consultant.stories.title")}>
      <p className="mb-3 text-sm text-muted">{t("consultant.stories.intro")}</p>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add.run().catch(() => {});
        }}
      >
        <input
          className="input"
          placeholder={t("consultant.stories.storyPlaceholder")}
          value={story}
          onChange={(e) => setStory(e.target.value)}
          required
        />
        <div className="grid gap-2 sm:grid-cols-2">
          <select
            className="input"
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
          >
            <option value="">{t("consultant.stories.pickProduct")}</option>
            {(data?.products ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input
            className="input"
            placeholder={t("consultant.stories.namePlaceholder")}
            value={name}
            disabled={Boolean(productId)}
            required={!productId}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="input"
            type="number"
            min={0}
            placeholder={t("consultant.stories.pricePlaceholder")}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
          <input
            className="input"
            placeholder={t("consultant.stories.notesPlaceholder")}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <button className="btn-secondary" disabled={add.busy}>
          {t("consultant.stories.add")}
        </button>
        <ErrorBox error={add.error ?? del.error} />
      </form>
      {data && data.tags.length === 0 && (
        <p className="mt-3 text-sm text-muted">{t("consultant.stories.empty")}</p>
      )}
      {data && data.tags.length > 0 && (
        <ul className="mt-3 divide-y divide-line rounded-md border border-line text-sm">
          {data.tags.map((tag) => (
            <li key={tag.id} className="flex items-start justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <div className="font-medium">
                  {tag.product_name}
                  {tag.price != null && <span className="text-muted"> · {tag.price}</span>}
                </div>
                <div className="truncate text-xs text-muted">
                  {tag.story_url ? (
                    <a
                      href={tag.story_url}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:underline"
                    >
                      {tag.story_url}
                    </a>
                  ) : (
                    tag.story_id
                  )}
                  {tag.notes && ` · ${tag.notes}`}
                </div>
              </div>
              <button
                type="button"
                className="btn-ghost shrink-0 text-xs text-danger"
                disabled={del.busy}
                onClick={() => void del.run(tag.id).catch(() => {})}
              >
                {t("common.delete")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
