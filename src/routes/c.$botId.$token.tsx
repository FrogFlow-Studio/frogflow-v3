import { createFileRoute } from "@tanstack/react-router";
import { cabinetFn } from "@/app/cabinet/cabinet.functions";
import { CABINET_TEXTS, type CabinetLang } from "@/v4/cabinet/cabinet";

/** Кабинет покупателя v4 по ссылке из сообщения (решение 12). */
export const Route = createFileRoute("/c/$botId/$token")({
  head: () => ({ meta: [{ name: "robots", content: "noindex, nofollow" }] }),
  loader: ({ params }) => cabinetFn({ data: { botId: params.botId, token: params.token } }),
  component: CabinetPage,
});

const LOCALE: Record<CabinetLang, string> = { ru: "ru-RU", kk: "kk-KZ", en: "en-GB", uz: "uz-UZ" };

function CabinetPage() {
  const cab = Route.useLoaderData();
  const { botId, token } = Route.useParams();
  const lang: CabinetLang = cab?.lang ?? "ru";
  const t = (k: keyof typeof CABINET_TEXTS) => CABINET_TEXTS[k][lang];
  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold">{t("title")}</h1>
      {!cab ? (
        <p className="text-muted">{t("invalid")}</p>
      ) : (
        <ul className="space-y-4">
          {cab.entries.map((e) => (
            <li key={e.accessId} className="rounded-lg border border-line p-4">
              <div className="font-medium">{e.title}</div>
              {e.endsAt ? (
                <div className="text-sm text-muted">
                  {t("until")} {new Date(e.endsAt).toLocaleDateString(LOCALE[lang])}
                </div>
              ) : null}
              {e.files.length ? (
                <ul className="mt-2 space-y-1">
                  {e.files.map((f) => (
                    <li key={f.id}>
                      <a
                        className="text-accent underline"
                        href={`/api/c/${botId}/${token}/${f.id}`}
                        rel="nofollow"
                      >
                        {f.name}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : e.kind === "file" ? (
                <div className="mt-2 text-sm text-muted">{t("noFiles")}</div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
