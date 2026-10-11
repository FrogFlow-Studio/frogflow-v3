import { useState } from "react";
import { addProductMediaFn, deleteProductMediaFn } from "../pricelist.functions";
import { Card, ErrorBox, Field, useAction } from "@/app/ui";
import { mediaMatchesProduct } from "@/core/consultant/pricelist/media";
import type { ConsultantProduct } from "@/core/consultant/pricelist/catalog";
import { type CardProps } from "./shared";
import { HelpTip } from "@/app/admin/help-panel";

/** Фото и видео к позициям прайса. */

export function MediaCard({
  t,
  data,
  canEdit,
  onDone,
  showMatches = false,
}: CardProps & { showMatches?: boolean }) {
  const [match, setMatch] = useState("");
  const [color, setColor] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [anyway, setAnyway] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  // То же правило, что при ответе покупателю (mediaMatchesProduct): опечатка видна до сохранения.
  const fits = match.trim()
    ? data.mediaCandidates.filter((p) =>
        mediaMatchesProduct({ id: "", match, color, path: "", kind: "image", createdAt: "" }, {
          ...p,
        } as ConsultantProduct),
      ).length
    : null;
  const models = [...new Set(data.mediaCandidates.map((p) => p.name))];
  const add = useAction(async () => {
    if (!file || !match.trim()) return;
    if (fits === 0 && !anyway) {
      setAnyway(true);
      return;
    }
    const { uploadFile } = await import("@/app/admin/upload-client");
    const key = await uploadFile("consultantMedia", file, t, (status) =>
      t("pricelist.uploadFailed", { status }),
    );
    await addProductMediaFn({
      data: { key, match, color: color || undefined, name: file.name },
    });
    setMatch("");
    setColor("");
    setFile(null);
    setAnyway(false);
    await onDone();
  });
  const remove = useAction(async (id: string) => {
    await deleteProductMediaFn({ data: { id } });
    setConfirmDelete(null);
    await onDone();
  });
  return (
    <Card
      title={
        <span className="flex items-center gap-1.5">
          {t("pricelist.media.title")}
          <HelpTip article="pricelist" anchor="media" />
        </span>
      }
    >
      <p className="mb-3 text-sm text-muted">{t("pricelist.media.hint")}</p>
      {data.media.length === 0 ? (
        <p className="text-sm">{t("pricelist.media.empty")}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {data.media.map((m) => (
            <li key={m.id} className="rounded-md border border-line p-2 text-xs">
              {m.kind === "video" ? (
                <div className="flex h-24 items-center justify-center bg-surface-2">
                  {t("pricelist.media.video")}
                </div>
              ) : (
                <img src={m.url} alt={m.match} className="h-24 w-full object-cover" />
              )}
              <div className="mt-1 font-medium">{m.match}</div>
              {m.color && <div className="text-muted">{m.color}</div>}
              {showMatches && (
                <div className={m.matches > 0 ? "text-ok" : "text-danger"}>
                  {m.matches > 0 ? t("ws.media.matches", { n: m.matches }) : t("ws.media.noMatch")}
                </div>
              )}
              {canEdit &&
                (confirmDelete === m.id ? (
                  <div className="mt-1 flex flex-wrap gap-2">
                    <button
                      className="btn-danger text-xs"
                      disabled={remove.busy}
                      onClick={() => void remove.run(m.id).catch(() => {})}
                    >
                      {t("pricelist.media.deleteConfirm")}
                    </button>
                    <button className="btn-ghost text-xs" onClick={() => setConfirmDelete(null)}>
                      {t("common.cancel")}
                    </button>
                  </div>
                ) : (
                  <button
                    className="btn-ghost mt-1 text-xs text-danger"
                    onClick={() => setConfirmDelete(m.id)}
                  >
                    {t("pricelist.delete")}
                  </button>
                ))}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label={t("pricelist.media.match")}>
            <input
              className="input"
              value={match}
              placeholder="Uchino Zero Twist"
              list="pricelist-media-models"
              onChange={(e) => {
                setMatch(e.target.value);
                setAnyway(false);
              }}
            />
            <datalist id="pricelist-media-models">
              {models.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            {fits !== null && (
              <p className={`mt-1 text-xs ${fits > 0 ? "text-ok" : "text-danger"}`}>
                {fits > 0 ? t("ws.media.matches", { n: fits }) : t("ws.media.noMatch")}
              </p>
            )}
          </Field>
          <Field label={t("pricelist.media.color")}>
            <input
              className="input"
              value={color}
              onChange={(e) => {
                setColor(e.target.value);
                setAnyway(false);
              }}
            />
          </Field>
          <Field label={t("pricelist.media.file")}>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </Field>
          <div className="flex items-end">
            <button
              className="btn-primary"
              disabled={add.busy || !file || !match.trim()}
              onClick={() => void add.run().catch(() => {})}
            >
              {anyway ? t("pricelist.media.addAnyway") : t("pricelist.media.add")}
            </button>
          </div>
        </div>
      )}
      <ErrorBox error={add.error ?? remove.error} />
    </Card>
  );
}
