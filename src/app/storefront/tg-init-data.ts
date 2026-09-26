/**
 * initData Telegram Mini App — откуда его взять, если SDK ещё не загрузился
 * или потерял параметры запуска. Telegram открывает Mini App с
 * `#tgWebAppData=…` в адресе; telegram-web-app.js кладёт те же параметры в
 * sessionStorage `__telegram__initParams`. В v1 без этого запаса «Мои заказы»
 * и оформление в части клиентов Telegram открывались как обычный сайт.
 */
export const SDK_PARAMS_KEY = "__telegram__initParams";
export const CAPTURE_KEY = "ff-tg-launch";

/** tgWebAppData из hash или query («#a=b&tgWebAppData=…», «?tgWebAppData=…»). */
export function initDataFromLaunchParams(raw: string | null | undefined): string {
  const s = (raw ?? "").replace(/^[#?]/, "");
  if (!s) return "";
  const at = s.indexOf("tgWebAppData=");
  if (at < 0) return "";
  // Внутренний query initData бывает не закодирован целиком: «tgWebAppData=query_id=1&user=…
  // &auth_date=…&hash=…&tgWebAppVersion=7.0». Берём всё до следующего параметра tgWebApp*.
  const rest = s.slice(at + "tgWebAppData=".length);
  const end = rest.search(/&tgWebApp[A-Z]/);
  const value = end < 0 ? rest : rest.slice(0, end);
  // Незакодированный внутренний query уже в том виде, что подписал Telegram:
  // повторная раскодировка испортила бы поле user и подпись не сошлась бы.
  if (/[=&]/.test(value)) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Из JSON, который пишет telegram-web-app.js; битый JSON — пустая строка. */
export function initDataFromSdkJson(raw: string | null | undefined): string {
  if (!raw) return "";
  try {
    const v = JSON.parse(raw) as { tgWebAppData?: unknown } | null;
    return typeof v?.tgWebAppData === "string" ? v.tgWebAppData : "";
  } catch {
    return "";
  }
}

/** Порядок: живой SDK, затем захваченное при запуске, затем текущий адрес. */
export function pickInitData(src: {
  sdk?: string | null;
  captured?: string | null;
  hash?: string | null;
  search?: string | null;
}): string {
  return (
    src.sdk?.trim() ||
    src.captured?.trim() ||
    initDataFromLaunchParams(src.hash) ||
    initDataFromLaunchParams(src.search) ||
    ""
  );
}

type Store = Pick<Storage, "getItem" | "setItem">;

/**
 * Запомнить параметры запуска до SDK и до смены адреса роутером. Ничего не
 * вызывает у Telegram (ни close, ни ready) — только читает и сохраняет.
 */
export function captureLaunchParams(loc: { hash: string; search: string }, store: Store): string {
  const found =
    initDataFromLaunchParams(loc.hash) ||
    initDataFromLaunchParams(loc.search) ||
    initDataFromSdkJson(safeGet(store, SDK_PARAMS_KEY));
  if (found) {
    try {
      store.setItem(CAPTURE_KEY, found);
    } catch {
      /* приватный режим */
    }
    return found;
  }
  return safeGet(store, CAPTURE_KEY) ?? "";
}

function safeGet(store: Store, key: string): string | null {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}
