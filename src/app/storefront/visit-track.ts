import { webSource } from "@/core/storefront/web-source";

/**
 * Визиты витрины в браузере (У1): раз за сессию «зашёл» и раз «посмотрел товар».
 * Метка из ссылки и адрес, откуда пришли, запоминаются в sessionStorage на время вкладки
 * (никаких cookie и постоянных идентификаторов); просмотр товара берёт тот же источник,
 * что и визит. Хранилище может быть закрыто — тогда ничего не отправляется.
 */
export type VisitSend = (p: {
  stage: "visit" | "product";
  source: string | null;
  referrer: string | null;
}) => void;

const visitKey = (slug: string) => `ff-visit:${slug}`;
const productKey = (slug: string) => `ff-visit-p:${slug}`;

export function trackVisit(
  slug: string,
  search: string,
  referrer: string,
  storage: Pick<Storage, "getItem" | "setItem">,
  send: VisitSend,
): void {
  try {
    if (storage.getItem(visitKey(slug))) return;
    const p = new URLSearchParams(search);
    const source =
      webSource({
        utm_source: p.get("utm_source") ?? undefined,
        utm_campaign: p.get("utm_campaign") ?? undefined,
        ref: p.get("ref") ?? undefined,
      }) ?? null;
    const ref = referrer.slice(0, 300) || null;
    storage.setItem(visitKey(slug), JSON.stringify({ source, referrer: ref }));
    send({ stage: "visit", source, referrer: ref });
  } catch {
    /* хранилище закрыто — визит не считаем */
  }
}

export function trackProductView(
  slug: string,
  storage: Pick<Storage, "getItem" | "setItem">,
  send: VisitSend,
): void {
  try {
    if (storage.getItem(productKey(slug))) return;
    const raw = storage.getItem(visitKey(slug));
    const seen = raw ? (JSON.parse(raw) as { source?: unknown; referrer?: unknown }) : {};
    storage.setItem(productKey(slug), "1");
    send({
      stage: "product",
      source: typeof seen.source === "string" ? seen.source : null,
      referrer: typeof seen.referrer === "string" ? seen.referrer : null,
    });
  } catch {
    /* хранилище закрыто или запись повреждена — просмотр не считаем */
  }
}

/** Отправка на сервер; ошибка счётчика покупателю не мешает. */
export function sendVisit(slug: string): VisitSend {
  return (p) => {
    void import("./visit.functions")
      .then((m) => m.trackStoreVisitFn({ data: { slug, ...p } }))
      .catch(() => {});
  };
}
