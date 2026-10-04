import { canEdit } from "@/core/auth/roles";
import { createFileRoute, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import {
  approveLegacyReviewsFn,
  assistReviewReplyFn,
  replyToReviewFn,
  reviewsFn,
  setReviewStatusFn,
} from "@/app/admin/reviews.functions";
import { adminT, intlLocale, type AdminT } from "@/app/i18n/admin";
import { Empty, ErrorBox, PageTitle, useAction } from "@/app/ui";
import { REVIEW_REPLY_MAX, type AdminReview } from "@/core/reviews/admin";

export const Route = createFileRoute("/admin/_authed/reviews")({
  validateSearch: z.object({
    rating: z.coerce.number().int().min(1).max(5).optional(),
    text: z.coerce.boolean().optional(),
    noreply: z.coerce.boolean().optional(),
    pending: z.coerce.boolean().optional(),
    product: z.string().min(1).max(64).optional(),
    page: z.coerce.number().int().min(1).max(10_000).optional(),
  }),
  beforeLoad: ({ context }) => {
    if (!context.shop.modules.review_request) throw redirect({ to: "/admin" });
  },
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) =>
    reviewsFn({
      data: {
        rating: deps.rating,
        withComment: deps.text,
        noReply: deps.noreply,
        pending: deps.pending,
        productId: deps.product,
        page: deps.page,
      },
    }),
  component: ReviewsPage,
});

const stars = (n: number) => "★".repeat(n) + "☆".repeat(Math.max(0, 5 - n));

function ReviewsPage() {
  const { items: rows, stats, page, pages, products, total } = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const search = Route.useSearch();
  const navigate = useNavigate();
  const canWrite = canEdit(shop.role);
  const router = useRouter();
  const [legacyDone, setLegacyDone] = useState<number | null>(null);
  const legacy = useAction(async () => {
    if (!confirm(t("reviews.approveLegacyConfirm"))) return;
    const { approved } = await approveLegacyReviewsFn();
    setLegacyDone(approved);
    await router.invalidate();
  });
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(intlLocale(shop.locale), {
      dateStyle: "short",
      timeStyle: "short",
    });
  return (
    <>
      <PageTitle
        title={t("reviews.title")}
        subtitle={
          stats.avg != null
            ? `${t("reviews.avg", { avg: stats.avg, n: stats.count })} · ${t("reviews.counts", { p: stats.pending, r: stats.noReply })}`
            : t("reviews.subtitle")
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          className="input w-40"
          value={search.rating ?? ""}
          onChange={(e) =>
            void navigate({
              to: "/admin/reviews",
              search: {
                ...search,
                page: undefined,
                rating: e.target.value ? Number(e.target.value) : undefined,
              },
            })
          }
        >
          <option value="">{t("reviews.filterAll")}</option>
          {[5, 4, 3, 2, 1].map((n) => (
            <option key={n} value={n}>
              {t("reviews.filterStars", { n })}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(search.text)}
            onChange={(e) =>
              void navigate({
                to: "/admin/reviews",
                search: { ...search, page: undefined, text: e.target.checked || undefined },
              })
            }
          />
          {t("reviews.withComment")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(search.noreply)}
            onChange={(e) =>
              void navigate({
                to: "/admin/reviews",
                search: { ...search, page: undefined, noreply: e.target.checked || undefined },
              })
            }
          />
          {t("reviews.noReply")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(search.pending)}
            onChange={(e) =>
              void navigate({
                to: "/admin/reviews",
                search: { ...search, page: undefined, pending: e.target.checked || undefined },
              })
            }
          />
          {t("reviews.pending")}
        </label>
        {products.length > 1 && (
          <select
            className="input w-48"
            aria-label={t("reviews.allProducts")}
            value={search.product ?? ""}
            onChange={(e) =>
              void navigate({
                to: "/admin/reviews",
                search: { ...search, page: undefined, product: e.target.value || undefined },
              })
            }
          >
            <option value="">{t("reviews.allProducts")}</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name ?? t("reviews.productDeleted")}
              </option>
            ))}
          </select>
        )}
      </div>
      {canWrite && rows.some((r) => r.legacy) && (
        <div className="card mb-4 flex flex-wrap items-center gap-3 p-3 text-sm">
          <span className="min-w-0 flex-1 text-muted">{t("reviews.legacyHint")}</span>
          <button
            className="btn-secondary text-xs"
            disabled={legacy.busy}
            onClick={() => void legacy.run().catch(() => {})}
          >
            {t("reviews.approveLegacy")}
          </button>
        </div>
      )}
      {legacyDone != null && (
        <p className="mb-4 text-xs text-ok">{t("reviews.approveLegacyDone", { n: legacyDone })}</p>
      )}
      {Boolean(legacy.error) && <ErrorBox error={legacy.error} />}
      {rows.length === 0 ? (
        <Empty>{stats.count === 0 ? t("reviews.empty") : t("reviews.noMatch")}</Empty>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <ReviewCard
              key={r.id}
              review={r}
              t={t}
              when={fmt(r.updatedAt)}
              canWrite={canWrite}
              lang={shop.locale}
            />
          ))}
        </div>
      )}
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <button
            className="btn-secondary text-xs"
            disabled={page <= 1}
            onClick={() =>
              void navigate({ to: "/admin/reviews", search: { ...search, page: page - 1 } })
            }
          >
            {t("reviews.prev")}
          </button>
          <span className="text-muted" data-total={total}>
            {t("reviews.page", { p: page, n: pages })}
          </span>
          <button
            className="btn-secondary text-xs"
            disabled={page >= pages}
            onClick={() =>
              void navigate({ to: "/admin/reviews", search: { ...search, page: page + 1 } })
            }
          >
            {t("reviews.next")}
          </button>
        </div>
      )}
    </>
  );
}

function ReviewCard({
  review: r,
  t,
  when,
  canWrite,
  lang,
}: {
  review: AdminReview;
  t: AdminT;
  when: string;
  canWrite: boolean;
  lang: "ru" | "kk" | "en" | "uz";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const assist = useAction(async () => {
    const { text } = await assistReviewReplyFn({ data: { id: r.id, lang } });
    setText(text);
  });
  const decide = useAction(async (status: "approved" | "hidden") => {
    await setReviewStatusFn({ data: { id: r.id, status } });
    await router.invalidate();
  });
  const send = useAction(async () => {
    await replyToReviewFn({ data: { id: r.id, text } });
    setSent(true);
    setOpen(false);
    setText("");
    await router.invalidate();
  });
  const buyer =
    r.buyer.name ?? (r.buyer.username ? `@${r.buyer.username}` : t("reviews.buyerUnknown"));
  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <span className="text-accent" aria-label={`${r.rating}/5`}>
            {stars(r.rating)}
          </span>{" "}
          <span className="font-medium">{r.productName ?? t("reviews.productDeleted")}</span>
        </div>
        <div className="text-xs text-muted">
          {buyer}
          {r.buyer.name && r.buyer.username ? ` · @${r.buyer.username}` : ""} · {when}
        </div>
      </div>
      <p className={`mt-2 text-sm whitespace-pre-line ${r.comment ? "" : "text-muted"}`}>
        {r.comment ?? t("reviews.noComment")}
      </p>
      {r.photos.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {r.photos.map((src) => (
            <a key={src} href={src} target="_blank" rel="noreferrer">
              <img
                src={src}
                alt={t("reviews.photoAlt")}
                loading="lazy"
                className="h-20 w-20 rounded-md border border-line object-cover"
              />
            </a>
          ))}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span
          className={
            r.status === "approved" ? "text-ok" : r.status === "hidden" ? "text-muted" : "text-warn"
          }
        >
          {t(r.legacy ? "reviews.status.legacy" : `reviews.status.${r.status}`)}
        </span>
        {canWrite && r.status !== "approved" && (
          <button
            className="btn-secondary text-xs"
            disabled={decide.busy}
            onClick={() => void decide.run("approved").catch(() => {})}
          >
            {t("reviews.approve")}
          </button>
        )}
        {canWrite && r.status !== "hidden" && (
          <button
            className="btn-ghost text-xs"
            disabled={decide.busy}
            onClick={() => void decide.run("hidden").catch(() => {})}
          >
            {t("reviews.hide")}
          </button>
        )}
      </div>
      {Boolean(decide.error) && <ErrorBox error={decide.error} />}
      {sent && <p className="mt-2 text-xs text-ok">{t("reviews.sent")}</p>}
      {canWrite && !open && (
        <button className="btn-secondary mt-3 text-xs" onClick={() => setOpen(true)}>
          {t("reviews.reply")}
        </button>
      )}
      {canWrite && open && (
        <div className="mt-3 space-y-2">
          <textarea
            className="input"
            rows={4}
            maxLength={REVIEW_REPLY_MAX}
            placeholder={t("reviews.replyPlaceholder")}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="btn-primary text-xs"
              disabled={send.busy || !text.trim()}
              onClick={() => void send.run().catch(() => {})}
            >
              {t("reviews.send")}
            </button>
            <button
              className="btn-secondary text-xs"
              disabled={assist.busy}
              onClick={() => void assist.run().catch(() => {})}
            >
              ✨ {t("reviews.assist")}
            </button>
            <button className="btn-ghost text-xs" onClick={() => setOpen(false)}>
              {t("reviews.cancel")}
            </button>
          </div>
          <p className="text-xs text-muted">{t("reviews.assistHint")}</p>
          <ErrorBox error={assist.error ?? send.error} />
        </div>
      )}
    </div>
  );
}
