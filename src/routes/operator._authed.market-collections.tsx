import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  deleteMarketCollectionFn,
  marketCollectionsFn,
  saveMarketCollectionFn,
  searchCollectionItemsFn,
} from "@/app/operator/market-collections.functions";
import { Badge, Card, Empty, ErrorBox, Field, PageTitle, useAction } from "@/app/ui";
import type { MarketItem } from "@/core/marketplace/items";

export const Route = createFileRoute("/operator/_authed/market-collections")({
  component: MarketCollectionsPage,
});

type View = Awaited<ReturnType<typeof marketCollectionsFn>>;
type Col = Extract<View, { ready: true }>["collections"][number];

const LANGS = [
  ["ru", "Название (русский, обязательно)"],
  ["kk", "Қазақша"],
  ["en", "English"],
  ["uz", "O‘zbekcha"],
] as const;

type Draft = {
  id?: string;
  rev?: number;
  title: Record<string, string>;
  published: boolean;
  position: number;
  items: Array<{ shopId: string; productId: string; name: string | null }>;
};

const draftOf = (c: Col): Draft => ({
  id: c.id,
  rev: c.rev,
  title: { ...c.title } as Record<string, string>,
  published: c.published,
  position: c.position,
  items: c.items.map((i, n) => ({ ...i, name: c.names[n] ?? null })),
});

/** Подборки площадки: оператор собирает «Для школы», «Подарки»…; на главной площадки они видны всем. */
function MarketCollectionsPage() {
  const [view, setView] = useState<View | null>(null);
  const load = useAction(async () => setView(await marketCollectionsFn()));
  useEffect(() => {
    void load.run().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [fresh, setFresh] = useState(false);
  return (
    <>
      <PageTitle
        title="Подборки площадки"
        subtitle="До 24 товаров в подборке. Показываются на главной площадки, когда подборка опубликована; товар, которого на площадке нет (скрыт, закончился, удалён), из показа пропадает сам."
      />
      <ErrorBox error={load.error} />
      {view && !view.ready && <Empty>Скоро: таблица подборок ещё не подключена.</Empty>}
      {view?.ready && (
        <div className="space-y-4">
          {view.collections.length === 0 && !fresh && <Empty>Подборок пока нет.</Empty>}
          {fresh && (
            <Editor
              key="new"
              start={{ title: { ru: "" }, published: false, position: 0, items: [] }}
              onDone={() => {
                setFresh(false);
                void load.run().catch(() => {});
              }}
            />
          )}
          {view.collections.map((c) => (
            <Editor
              key={`${c.id}:${c.rev}`}
              start={draftOf(c)}
              onDone={() => void load.run().catch(() => {})}
            />
          ))}
          {!fresh && (
            <button className="btn-secondary" onClick={() => setFresh(true)}>
              Новая подборка
            </button>
          )}
        </div>
      )}
    </>
  );
}

function Editor({ start, onDone }: { start: Draft; onDone: () => void }) {
  const [d, setD] = useState<Draft>(start);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<MarketItem[]>([]);
  const [saved, setSaved] = useState(false);
  const search = useAction(async () => setFound(await searchCollectionItemsFn({ data: { q } })));
  const save = useAction(async () => {
    await saveMarketCollectionFn({
      data: {
        id: d.id,
        rev: d.rev,
        title: Object.fromEntries(Object.entries(d.title).filter(([, v]) => v.trim())),
        items: d.items.map((i) => ({ shopId: i.shopId, productId: i.productId })),
        published: d.published,
        position: d.position,
      },
    });
    setSaved(true);
    onDone();
  });
  const remove = useAction(async () => {
    if (d.id) await deleteMarketCollectionFn({ data: { id: d.id } });
    onDone();
  });
  const add = (i: MarketItem) =>
    setD((p) =>
      p.items.length >= 24 || p.items.some((x) => x.productId === i.id)
        ? p
        : { ...p, items: [...p.items, { shopId: i.shopId, productId: i.id, name: i.name }] },
    );
  return (
    <Card title={d.title.ru || "Новая подборка"}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          {LANGS.map(([l, label]) => (
            <Field key={l} label={label}>
              <input
                className="input w-full"
                maxLength={60}
                value={d.title[l] ?? ""}
                onChange={(e) =>
                  setD((p) => ({ ...p, title: { ...p.title, [l]: e.target.value } }))
                }
              />
            </Field>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={d.published}
              onChange={(e) => setD((p) => ({ ...p, published: e.target.checked }))}
            />
            Опубликована
          </label>
          <label className="flex items-center gap-2">
            Порядок
            <input
              className="input w-20"
              type="number"
              min={0}
              value={d.position}
              onChange={(e) => setD((p) => ({ ...p, position: Number(e.target.value) || 0 }))}
            />
          </label>
          <Badge tone="neutral">{d.items.length} из 24</Badge>
        </div>
        <ul className="space-y-1 text-sm">
          {d.items.map((i) => (
            <li key={i.productId} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">{i.name ?? "Товара на площадке сейчас нет"}</span>
              <button
                className="btn-ghost shrink-0"
                onClick={() =>
                  setD((p) => ({ ...p, items: p.items.filter((x) => x.productId !== i.productId) }))
                }
              >
                Убрать
              </button>
            </li>
          ))}
        </ul>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void search.run().catch(() => {});
          }}
        >
          <input
            className="input min-w-0 flex-1"
            placeholder="Найти товар на площадке"
            aria-label="Найти товар на площадке"
            value={q}
            maxLength={80}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="btn-secondary" disabled={search.busy || q.trim().length < 2}>
            Найти
          </button>
        </form>
        {found.length > 0 && (
          <ul className="space-y-1 text-sm">
            {found.map((i) => (
              <li key={`${i.shopId}:${i.id}`} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">
                  {i.name} <span className="text-muted">· {i.shopName}</span>
                </span>
                <button className="btn-ghost shrink-0" onClick={() => add(i)}>
                  Добавить
                </button>
              </li>
            ))}
          </ul>
        )}
        <ErrorBox error={search.error ?? save.error ?? remove.error} />
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="btn-primary"
            disabled={save.busy || !(d.title.ru ?? "").trim()}
            onClick={() => void save.run().catch(() => {})}
          >
            Сохранить
          </button>
          {d.id && (
            <button
              className="btn-secondary text-danger"
              disabled={remove.busy}
              onClick={() => void remove.run().catch(() => {})}
            >
              Удалить подборку
            </button>
          )}
          {saved && <span className="text-sm text-ok">Сохранено</span>}
        </div>
      </div>
    </Card>
  );
}
