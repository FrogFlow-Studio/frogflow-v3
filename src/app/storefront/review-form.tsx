import { useEffect, useState, type ChangeEvent } from "react";
import { useStorefrontLocale } from "./locale";
import { webReviewFn, webReviewStateFn } from "./reviews.functions";
import { TgLoginBox, useTgLogin } from "./tg-login";
import { ErrorBox, useAction } from "@/app/ui";
import { REVIEW_PHOTOS_MAX } from "@/core/reviews/photos";

type State = Awaited<ReturnType<typeof webReviewStateFn>>;

/** Снимок с телефона весит мегабайты, а тело запроса ограничено: уменьшаем до 1280 px и сжимаем в JPEG. */
async function shrink(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bmp.width * k));
  canvas.height = Math.max(1, Math.round(bmp.height * k));
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.8));
  if (!blob) throw new Error("photo");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * «Оставить отзыв» на странице товара: вошедшему через Telegram покупателю с выданным
 * заказом этого товара — оценка, текст и до трёх фото; остальным — подсказка, что нужно.
 * Отзыв ждёт решения магазина, как и из бота.
 */
export function ReviewForm({
  slug,
  productId,
  hasReviews,
}: {
  slug: string;
  productId: string;
  hasReviews: boolean;
}) {
  const { t } = useStorefrontLocale();
  const login = useTgLogin(slug);
  const me = Boolean(login.state?.me);
  const [state, setState] = useState<State | null>(null);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState(false);
  const load = () =>
    webReviewStateFn({ data: { slug, productId } })
      .then(setState)
      .catch(() => setState(null));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, productId, me]);
  const send = useAction(async () => {
    const r = await webReviewFn({
      data: { slug, productId, rating, comment, photos: await Promise.all(photos.map(shrink)) },
    });
    setNote(
      r.photosRejected > 0
        ? `${t("review.sent")} ${t("review.sentPhotosSkipped", { n: r.photosRejected })}`
        : t("review.sent"),
    );
    setPhotos([]);
    setComment("");
    setEditing(false);
    await load();
  });
  if (!state?.loginAvailable) return null;
  if (!state.loggedIn)
    return hasReviews ? (
      <div className="mb-4 space-y-1 text-sm">
        <p className="text-muted">{t("review.needLogin")}</p>
        <TgLoginBox login={login} hint={false} />
      </div>
    ) : null;
  const mine = state.mine;
  if (!state.canReview && !mine)
    return hasReviews ? (
      <p className="mb-4 text-sm text-muted">{t("review.needPurchase")}</p>
    ) : null;
  return (
    <div className="mb-4 space-y-3 text-sm">
      {note && <p className="rounded-md bg-ok/10 px-3 py-2 text-ok">{note}</p>}
      {mine && !editing && (
        <div className="card space-y-1 p-4">
          <p className="font-medium">
            {t("review.mine")}: <span className="text-accent">{"★".repeat(mine.rating)}</span>
          </p>
          {mine.comment && <p className="whitespace-pre-line">{mine.comment}</p>}
          <p className="text-xs text-muted">
            {t(`review.status.${mine.status}` as "review.status.pending")}
          </p>
          {state.canReview && (
            <button
              type="button"
              className="text-accent hover:underline"
              onClick={() => setEditing(true)}
            >
              {t("review.edit")}
            </button>
          )}
        </div>
      )}
      {state.canReview && (!mine || editing) && (
        <form
          className="card space-y-3 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            setNote("");
            void send.run().catch(() => {});
          }}
        >
          <p className="font-medium">{t("review.write")}</p>
          <div className="flex gap-1" role="radiogroup" aria-label={t("review.rate")}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={rating === n}
                aria-label={`${n}/5`}
                className={`text-2xl leading-none ${n <= rating ? "text-accent" : "text-muted"}`}
                onClick={() => setRating(n)}
              >
                ★
              </button>
            ))}
          </div>
          <textarea
            className="input min-h-20"
            maxLength={1000}
            value={comment}
            placeholder={t("review.textPlaceholder")}
            aria-label={t("review.text")}
            onChange={(e) => setComment(e.target.value)}
          />
          <div>
            <label className="block text-xs text-muted">
              {t("review.addPhotos", { n: REVIEW_PHOTOS_MAX })}
            </label>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="mt-1 block text-sm"
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setPhotos(Array.from(e.currentTarget.files ?? []).slice(0, REVIEW_PHOTOS_MAX))
              }
            />
          </div>
          <ErrorBox error={send.error} />
          <button className="btn-primary" disabled={send.busy}>
            {t("review.send")}
          </button>
        </form>
      )}
    </div>
  );
}
