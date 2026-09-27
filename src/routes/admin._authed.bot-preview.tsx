import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { z } from "zod";
import { botPreviewFn, botPreviewProductsFn } from "@/app/admin/bot-preview.functions";
import { TgText } from "@/app/admin/tg-html";
import { adminT } from "@/app/i18n/admin";
import { Card, Empty, ErrorBox, Field, PageTitle, useAction } from "@/app/ui";
import { localeFlags, localeNames, SUPPORTED_LOCALES } from "@/core/i18n/locale";

export const Route = createFileRoute("/admin/_authed/bot-preview")({
  validateSearch: z.object({
    lang: z.enum(SUPPORTED_LOCALES).optional(),
    product: z.string().uuid().optional(),
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => botPreviewFn({ data: { locale: deps.lang, productId: deps.product } }),
  component: BotPreviewPage,
});

type Buttons = Array<Array<{ text: string }>>;

function Bubble({ children, buttons }: { children: ReactNode; buttons?: Buttons }) {
  return (
    <div className="max-w-sm">
      <div className="rounded-2xl rounded-bl-sm border border-line bg-surface px-3 py-2 text-sm">
        {children}
      </div>
      {buttons && buttons.length > 0 && (
        <div className="mt-1 space-y-1">
          {buttons.map((row, i) => (
            <div key={i} className="flex gap-1">
              {row.map((b, j) => (
                <span
                  key={j}
                  className="flex-1 truncate rounded-lg bg-surface-2 px-2 py-1.5 text-center text-xs"
                >
                  {b.text}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Step({ children }: { children: ReactNode }) {
  return <div className="py-1 text-center text-xs text-muted">{children}</div>;
}

function BotPreviewPage() {
  const data = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Array<{ id: string; name: string }> | null>(null);
  const find = useAction(async () => {
    setFound(await botPreviewProductsFn({ data: { q } }));
  });
  const go = (patch: { lang?: typeof search.lang; product?: string }) =>
    void navigate({ to: "/admin/bot-preview", search: { ...search, ...patch } });
  const p = data.product;
  return (
    <>
      <PageTitle title={t("botPreview.title")} subtitle={t("botPreview.subtitle")} />
      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <Card className="self-start">
          <div className="space-y-4">
            {data.locales.length > 1 && (
              <Field label={t("botPreview.language")}>
                <select
                  className="input"
                  value={data.locale}
                  onChange={(e) => go({ lang: e.target.value as typeof search.lang })}
                >
                  {data.locales.map((l) => (
                    <option key={l} value={l}>
                      {localeFlags[l]} {localeNames[l]}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label={t("botPreview.product")} hint={p ? p.name : undefined}>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (q.trim()) void find.run().catch(() => {});
                }}
              >
                <input
                  className="input"
                  value={q}
                  maxLength={100}
                  placeholder={t("botPreview.search")}
                  onChange={(e) => setQ(e.target.value)}
                />
                <button className="btn-secondary" disabled={find.busy || !q.trim()}>
                  🔍
                </button>
              </form>
            </Field>
            {found && found.length === 0 && (
              <p className="text-xs text-muted">{t("botPreview.searchEmpty")}</p>
            )}
            {found && found.length > 0 && (
              <ul className="space-y-1 text-sm">
                {found.map((f) => (
                  <li key={f.id}>
                    <button
                      className={`w-full truncate rounded px-2 py-1 text-left hover:bg-surface-2 ${f.id === p?.id ? "text-accent" : ""}`}
                      onClick={() => go({ product: f.id })}
                    >
                      {f.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <ErrorBox error={find.error} />
          </div>
        </Card>
        <div className="card flex flex-col gap-2 bg-surface-2/40 p-4">
          {data.languageChoice && (
            <>
              <Step>{t("botPreview.chooseLanguage")}</Step>
              <Bubble buttons={data.languageChoice.buttons}>
                <TgText html={data.languageChoice.text} />
              </Bubble>
            </>
          )}
          <Step>{t("botPreview.start")}</Step>
          <Bubble>
            <TgText html={data.welcome} />
          </Bubble>
          <Step>{t("botPreview.openProduct")}</Step>
          {p ? (
            <Bubble buttons={p.keyboard.inline_keyboard}>
              {p.photo && (
                <img
                  src={p.photo}
                  alt={t("botPreview.photoAlt")}
                  className="-mx-3 -mt-2 mb-2 aspect-square w-[calc(100%+1.5rem)] max-w-none rounded-t-2xl object-cover"
                />
              )}
              <TgText html={p.photo ? p.caption.slice(0, 1024) : p.caption} />
            </Bubble>
          ) : (
            <Empty>{t("botPreview.noProducts")}</Empty>
          )}
          {p && <p className="text-xs text-muted">{t("botPreview.priceNote")}</p>}
          <div className="mt-4 border-t border-line pt-3">
            <div className="mb-2 text-xs text-muted">{t("botPreview.menu")}</div>
            <div className="space-y-1">
              {data.menu.keyboard.map((row, i) => (
                <div key={i} className="flex gap-1">
                  {row.map((b, j) => (
                    <span
                      key={j}
                      className="flex-1 truncate rounded-lg border border-line bg-surface px-2 py-2 text-center text-sm"
                    >
                      {b.text}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
