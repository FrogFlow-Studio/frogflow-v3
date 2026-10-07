import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { consultantFn, consultantTestFn, saveConsultantFn } from "@/app/admin/admin.functions";
import {
  deleteStoryTagFn,
  storyProductsFn,
  storyTagsFn,
  upsertStoryTagFn,
} from "@/app/admin/consultant.functions";
import { storyPostsFn } from "@/app/admin/instagram.functions";
import { PICKER_LIMIT } from "@/core/catalog/picker";
import { Badge, Card, ErrorBox, Field, PageTitle, Switch, useAction } from "@/app/ui";
import { adminT, intlLocale, type AdminKey, type AdminT } from "@/app/i18n/admin";
import { GOALS, TONES, type ConsultantProfile } from "@/core/consultant/profile";
import type { KnowledgeDoc } from "@/core/consultant/knowledge";
import { PAUSE_CHOICES, type PauseHours } from "@/core/consultant/pause";

/** Сколько товаров тега видно в списке до «ещё N». */
const TAG_PREVIEW = 3;

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
  const [pause, setPause] = useState<PauseHours>(data.pauseHours);
  const [saved, setSaved] = useState(false);
  const save = useAction(async () => {
    setSaved(false);
    await saveConsultantFn({
      data: {
        enabled,
        pauseHours: pause,
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
        <div className="min-w-0 space-y-4">
          <Card title={t("consultant.profile.title")}>
            <div className="mb-4 flex items-center gap-3">
              <Switch checked={enabled} onChange={setEnabled} label={t("consultant.enable")} />
              <span className="text-sm">
                {enabled ? t("consultant.enabledHint") : t("consultant.disabledHint")}
              </span>
            </div>
            <Field label={t("consultant.pause")} hint={t("consultant.pauseHint")}>
              <select
                className="input mb-4 w-auto"
                value={pause}
                onChange={(e) => setPause(Number(e.target.value) as PauseHours)}
              >
                {PAUSE_CHOICES.map((h) => (
                  <option key={h} value={h}>
                    {t(`consultant.pause.h${h}` as AdminKey)}
                  </option>
                ))}
              </select>
            </Field>
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

          {data.pricelist.on ? (
            <Card title={t("consultant.knowledge.title")}>
              <p className="text-sm">
                {t("consultant.knowledge.pricelist", { n: String(data.pricelist.articles) })}
              </p>
              <Link to="/admin/pricelist" className="btn-secondary mt-3 inline-block text-sm">
                {t("consultant.knowledge.openPricelist")}
              </Link>
            </Card>
          ) : (
            <>
              {(data.pricelist.articles > 0 || data.pricelist.hasCatalog) && (
                <div className="rounded-md border border-warn/40 bg-warn/15 px-3 py-2 text-sm">
                  {t("consultant.knowledge.pricelistOff", {
                    n: String(data.pricelist.articles),
                  })}
                </div>
              )}
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
            </>
          )}

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

        <div className="min-w-0 space-y-4">
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
type StoryItem = { id: string | null; name: string; price: number | null };
type StoryFound = Awaited<ReturnType<typeof storyProductsFn>>;
type StoryPost = Awaited<ReturnType<typeof storyPostsFn>>["posts"][number];

/**
 * Теги товаров на публикациях: покупатель ответил на сторис «сколько стоит?» —
 * консультант знает, какие товары на ней, и отвечает по делу. У консультанта
 * «по прайсу» товары ищутся в прайсе 1С — том же, что знает консультант.
 */
function StoriesCard({ t }: { t: AdminT }) {
  const [data, setData] = useState<StoryTags | null>(null);
  // Тег из v1 может держать десятки товаров: в списке — первые, остальные по кнопке.
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [story, setStory] = useState("");
  const [items, setItems] = useState<StoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<StoryFound | null>(null);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [notes, setNotes] = useState("");
  const [posts, setPosts] = useState<StoryPost[] | null>(null);
  const latest = useRef(0);
  const reload = async () => setData(await storyTagsFn());
  useEffect(() => {
    void reload();
  }, []);
  const search = useAction(async (q: string) => {
    const n = ++latest.current;
    const r = await storyProductsFn({ data: { q } });
    if (n === latest.current) setFound(r);
  });
  useEffect(() => {
    const timer = setTimeout(() => void search.run(query).catch(() => {}), 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  // Догрузить следующие товары прайса к уже найденным (тот же запрос).
  const more = useAction(async () => {
    if (!found) return;
    const n = latest.current;
    const r = await storyProductsFn({ data: { q: query, offset: found.items.length } });
    if (n === latest.current)
      setFound((prev) => (prev ? { ...r, items: [...prev.items, ...r.items] } : r));
  });
  const loadPosts = useAction(async () => setPosts((await storyPostsFn()).posts));
  const addItem = (item: StoryItem) =>
    setItems((prev) =>
      prev.length >= 10 ||
      prev.some((p) => (p.id ?? p.name.toLowerCase()) === (item.id ?? item.name.toLowerCase()))
        ? prev
        : [...prev, item],
    );
  const addManual = () => {
    if (!name.trim()) return;
    addItem({ id: null, name: name.trim(), price: price.trim() ? Number(price) : null });
    setName("");
    setPrice("");
  };
  const reset = () => {
    setStory("");
    setItems([]);
    setNotes("");
  };
  const edit = (tag: StoryTags["tags"][number]) => {
    setStory(tag.story_url ?? tag.story_id);
    setItems(tag.items);
    setNotes(tag.notes ?? "");
  };
  const add = useAction(async () => {
    await upsertStoryTagFn({ data: { story, products: items, notes: notes.trim() || null } });
    reset();
    await reload();
  });
  const del = useAction(async (id: string) => {
    await deleteStoryTagFn({ data: { id } });
    await reload();
  });
  const source = found?.source ?? data?.source;
  const money = (n: number | null) => (n != null ? ` · ${n.toLocaleString("ru-RU")}` : "");
  return (
    <Card title={t("consultant.stories.title")}>
      <p className="mb-3 text-sm text-muted">{t("consultant.stories.intro")}</p>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (items.length) void add.run().catch(() => {});
        }}
      >
        <div className="flex gap-2">
          <input
            className="input flex-1"
            placeholder={t("consultant.stories.storyPlaceholder")}
            value={story}
            onChange={(e) => setStory(e.target.value)}
            required
          />
          <button
            type="button"
            className="btn-ghost shrink-0 text-sm"
            disabled={loadPosts.busy}
            onClick={() => void loadPosts.run().catch(() => {})}
          >
            {t("consultant.stories.posts")}
          </button>
        </div>
        {posts && posts.length === 0 && (
          <p className="text-sm text-muted">{t("consultant.stories.postsEmpty")}</p>
        )}
        {posts && posts.length > 0 && (
          <div className="grid max-h-72 grid-cols-3 gap-2 overflow-auto sm:grid-cols-4">
            {posts.map((p) => (
              <button
                key={p.platformPostId}
                type="button"
                title={p.caption}
                className={`overflow-hidden rounded-md border text-left text-xs ${
                  story === p.permalink ? "border-accent" : "border-line"
                }`}
                onClick={() => setStory(p.permalink ?? "")}
              >
                {p.thumbnail ? (
                  <img src={p.thumbnail} alt="" className="aspect-square w-full object-cover" />
                ) : (
                  <div className="aspect-square w-full bg-surface-2" />
                )}
                <span className="block truncate px-1 py-0.5">{p.caption || p.kind}</span>
              </button>
            ))}
          </div>
        )}
        {items.length > 0 && (
          <ul className="space-y-1">
            {items.map((it, i) => (
              <li
                key={`${it.id ?? it.name}-${i}`}
                className="flex items-center gap-2 rounded-md border border-line px-2 py-1 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">
                  {it.name}
                  <span className="text-muted">{money(it.price)}</span>
                </span>
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => setItems((prev) => prev.filter((_, j) => j !== i))}
                >
                  {t("consultant.stories.remove")}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="space-y-1">
          <input
            className="input"
            type="search"
            aria-label={t("consultant.stories.pickProduct")}
            placeholder={
              source === "pricelist"
                ? t("consultant.stories.searchPricelist")
                : t("consultant.stories.searchCatalog")
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.preventDefault();
            }}
          />
          {source === "pricelist" && (
            <p className="text-xs text-muted">{t("consultant.stories.fromPricelist")}</p>
          )}
          {found && (
            <div className="max-h-56 overflow-auto rounded-md border border-line">
              {found.items.length === 0 ? (
                <p className="p-2 text-sm text-muted">{t("picker.nothing")}</p>
              ) : (
                found.items.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="block w-full truncate px-2 py-1.5 text-left text-sm hover:bg-surface-2"
                    onClick={() => addItem(p)}
                  >
                    {p.name}
                    <span className="text-muted">{money(p.price)}</span>
                  </button>
                ))
              )}
            </div>
          )}
          {found &&
            (found.total != null
              ? found.total > found.items.length && (
                  <div className="flex flex-wrap items-center gap-2 p-2 text-xs text-muted">
                    <span>
                      {t("consultant.stories.shown", {
                        n: String(found.items.length),
                        total: String(found.total),
                      })}
                    </span>
                    <button
                      type="button"
                      className="btn-ghost text-xs"
                      disabled={more.busy}
                      onClick={() => void more.run().catch(() => {})}
                    >
                      {t("consultant.stories.loadMore")}
                    </button>
                  </div>
                )
              : found.items.length >= PICKER_LIMIT && (
                  <p className="p-2 text-xs text-muted">{t("picker.more", { n: PICKER_LIMIT })}</p>
                ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_auto]">
          <input
            className="input"
            placeholder={t("consultant.stories.namePlaceholder")}
            value={name}
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
          <button
            type="button"
            className="btn-ghost text-sm"
            disabled={!name.trim()}
            onClick={addManual}
          >
            {t("consultant.stories.addManual")}
          </button>
        </div>
        <input
          className="input"
          placeholder={t("consultant.stories.notesPlaceholder")}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <button className="btn-secondary" disabled={add.busy || items.length === 0}>
          {t("consultant.stories.add")}
        </button>
        <ErrorBox error={add.error ?? del.error ?? search.error ?? more.error ?? loadPosts.error} />
      </form>
      {data && data.tags.length === 0 && (
        <p className="mt-3 text-sm text-muted">{t("consultant.stories.empty")}</p>
      )}
      {data && data.tags.length > 0 && (
        <ul className="mt-3 divide-y divide-line rounded-md border border-line text-sm">
          {data.tags.map((tag) => (
            <li key={tag.id} className="flex items-start justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                {(open.has(tag.id) ? tag.items : tag.items.slice(0, TAG_PREVIEW)).map((it, i) => (
                  <div key={`${it.id ?? it.name}-${i}`} className="font-medium">
                    {it.name}
                    <span className="text-muted">{money(it.price)}</span>
                  </div>
                ))}
                {tag.items.length > TAG_PREVIEW && (
                  <button
                    type="button"
                    className="btn-ghost px-0 text-xs"
                    onClick={() =>
                      setOpen((prev) => {
                        const next = new Set(prev);
                        if (next.has(tag.id)) next.delete(tag.id);
                        else next.add(tag.id);
                        return next;
                      })
                    }
                  >
                    {open.has(tag.id)
                      ? t("consultant.stories.less")
                      : t("consultant.stories.more", { n: String(tag.items.length - TAG_PREVIEW) })}
                  </button>
                )}
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
              <div className="flex shrink-0 gap-1">
                <button type="button" className="btn-ghost text-xs" onClick={() => edit(tag)}>
                  {t("consultant.stories.edit")}
                </button>
                <button
                  type="button"
                  className="btn-ghost text-xs text-danger"
                  disabled={del.busy}
                  onClick={() => void del.run(tag.id).catch(() => {})}
                >
                  {t("common.delete")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
