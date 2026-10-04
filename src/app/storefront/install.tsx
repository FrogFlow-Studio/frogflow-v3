import { useEffect, useRef, useState } from "react";
import { useStorefrontLocale } from "@/app/storefront/locale";
import {
  countVisit,
  parseInstallMemory,
  shouldOfferInstall,
  swPath,
  type InstallMemory,
} from "@/core/storefront/pwa";

/** Событие Chrome/Android «можно установить»; в стандартные типы TypeScript оно не входит. */
type InstallEvent = Event & { prompt: () => Promise<void> };

const key = (slug: string) => `ff-install-${slug}`;

function read(slug: string): InstallMemory {
  try {
    return parseInstallMemory(localStorage.getItem(key(slug)));
  } catch {
    return parseInstallMemory(null);
  }
}

function write(slug: string, m: InstallMemory) {
  try {
    localStorage.setItem(key(slug), JSON.stringify(m));
  } catch {
    /* приватный режим: подсказка просто не запомнится */
  }
}

const standalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

const iosSafari = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);

/**
 * Витрина как приложение: подключает service worker (страница «нет сети») и со
 * второго визита предлагает «Добавить на главный экран». В Telegram Mini App и в уже
 * установленном приложении подсказки нет. После «Не сейчас» молчим 30 дней.
 */
export function InstallPrompt({ slug, enabled }: { slug: string; enabled: boolean }) {
  const { t } = useStorefrontLocale();
  const [show, setShow] = useState(false);
  const event = useRef<InstallEvent | null>(null);
  const [ios, setIos] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    if ("serviceWorker" in navigator)
      void navigator.serviceWorker.register(swPath(slug), { scope: `/s/${slug}` }).catch(() => {});
    // Визит — одно открытие сайта в браузере, а не каждая страница.
    let mem = read(slug);
    try {
      if (!sessionStorage.getItem(key(slug))) {
        sessionStorage.setItem(key(slug), "1");
        mem = countVisit(mem);
        write(slug, mem);
      }
    } catch {
      /* без sessionStorage визит не считаем повторно */
    }
    const eligible = shouldOfferInstall(mem, standalone(), Date.now());
    if (!eligible) return;
    if (iosSafari()) {
      setIos(true);
      setShow(true);
      return;
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      event.current = e as InstallEvent;
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, [slug, enabled]);
  if (!show) return null;
  const close = () => {
    write(slug, { ...read(slug), dismissedAt: Date.now() });
    setShow(false);
  };
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface-2 px-4 py-3 text-sm">
      <div>
        <p className="font-medium">{t("pwa.installTitle")}</p>
        <p className="text-xs text-muted">{ios ? t("pwa.iosHint") : t("pwa.installText")}</p>
      </div>
      <div className="flex gap-2">
        {!ios && (
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              const e = event.current;
              event.current = null;
              setShow(false);
              void e?.prompt().catch(() => {});
            }}
          >
            {t("pwa.install")}
          </button>
        )}
        <button type="button" className="btn-secondary" onClick={close}>
          {t("pwa.later")}
        </button>
      </div>
    </div>
  );
}
