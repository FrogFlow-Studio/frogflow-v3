import { useEffect, useRef, useState } from "react";
import {
  deleteStoryTagFn,
  storyProductsFn,
  storyTagsFn,
  upsertStoryTagFn,
} from "@/app/admin/consultant.functions";
import { storyPostsFn } from "@/app/admin/instagram.functions";
import { PICKER_LIMIT } from "@/core/catalog/picker";
import { Card, ErrorBox, useAction } from "@/app/ui";
import { type AdminT } from "@/app/i18n/admin";
import { HelpTip } from "@/app/admin/help-panel";

/** Метки историй Instagram. */

/** Сколько товаров тега видно в списке до «ещё N». */
const TAG_PREVIEW = 3;

type StoryTags = Awaited<ReturnType<typeof storyTagsFn>>;

type StoryItem = { id: string | null; name: string; price: number | null };

type StoryFound = Awaited<ReturnType<typeof storyProductsFn>>;

type StoryPost = Awaited<ReturnType<typeof storyPostsFn>>["posts"][number];

/**
 * Теги товаров на публикациях: покупатель ответил на сторис «сколько стоит?» —
 * консультант знает, какие товары на ней, и отвечает по делу. У консультанта
 * «по прайсу» товары ищутся в прайсе 1С — том же, что знает консультант.
 */
export function StoriesCard({ t }: { t: AdminT }) {
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
    <Card
      title={
        <span className="flex items-center gap-1.5">
          {t("consultant.stories.title")}
          <HelpTip article="consultant" anchor="stories" />
        </span>
      }
    >
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
