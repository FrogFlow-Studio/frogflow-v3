import { createFileRoute, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { assistReviewReplyFn, replyToReviewFn, reviewsFn } from "@/app/admin/reviews.functions";
import { adminT, intlLocale, type AdminT } from "@/app/i18n/admin";
import { Empty, ErrorBox, PageTitle, useAction } from "@/app/ui";
import { REVIEW_REPLY_MAX, reviewStats, type AdminReview } from "@/core/reviews/admin";

export const Route = createFileRoute("/admin/_authed/reviews")({
  validateSearch: z.object({
    rating: z.coerce.number().int().min(1).max(5).optional(),
    text: z.coerce.boolean().optional(),
  }),
  beforeLoad: ({ context }) => {
    if (!context.shop.modules.review_request) throw redirect({ to: "/admin" });
  },
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => reviewsFn({ data: { rating: deps.rating, withComment: deps.text } }),
  component: ReviewsPage,
});

const stars = (n: number) => "★".repeat(n) + "☆".repeat(Math.max(0, 5 - n));

function ReviewsPage() {
  const rows = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const search = Route.useSearch();
  const navigate = useNavigate();
  const stats = reviewStats(rows);
  const canWrite = shop.role !== "viewer";
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
          stats.avg != null && !search.rating && !search.text
            ? t("reviews.avg", { avg: stats.avg, n: stats.count })
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
              search: { ...search, rating: e.target.value ? Number(e.target.value) : undefined },
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
                search: { ...search, text: e.target.checked || undefined },
              })
            }
          />
          {t("reviews.withComment")}
        </label>
      </div>
      {rows.length === 0 ? (
        <Empty>{t("reviews.empty")}</Empty>
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
