import { useEffect, useState } from "react";
import { Card, ErrorBox, useAction } from "@/app/ui";
import { saveStoreDesignFn, storeDesignFn } from "@/app/admin/design.functions";
import { adminT } from "@/app/i18n/admin";
import {
  STORE_BLOCKS,
  STORE_THEMES,
  themeClass,
  type StoreBlock,
  type StoreTheme,
} from "@/core/storefront/design";
import { settingsRoute } from "./route";

/**
 * Оформление витрины: тема, обложка и порядок блоков главной. Внизу — живой
 * предпросмотр выбранной темы; блоки показываются в выбранном порядке.
 */
export function DesignCard() {
  const { shop } = settingsRoute.useRouteContext();
  const t = adminT(shop.locale);
  const [theme, setTheme] = useState<StoreTheme>("fresh");
  const [cover, setCover] = useState(false);
  const [blocks, setBlocks] = useState<StoreBlock[]>([]);
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void storeDesignFn().then((d) => {
      setTheme(d.theme);
      setCover(d.cover);
      setBlocks(d.blocks);
      setReady(true);
    });
  }, []);
  const owner = shop.role === "owner";
  const locked = !owner || !ready;
  const save = useAction(async () => {
    await saveStoreDesignFn({ data: { theme, cover, blocks } });
    setSaved(true);
  });
  const toggle = (b: StoreBlock) => {
    setSaved(false);
    setBlocks((cur) => (cur.includes(b) ? cur.filter((x) => x !== b) : [...cur, b]));
  };
  const move = (b: StoreBlock, d: -1 | 1) => {
    setSaved(false);
    setBlocks((cur) => {
      const i = cur.indexOf(b);
      const j = i + d;
      if (i < 0 || j < 0 || j >= cur.length) return cur;
      const next = cur.slice();
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  };
  // Порядок: сначала выбранные (как поставил продавец), затем остальные.
  const rows = [...blocks, ...STORE_BLOCKS.filter((b) => !blocks.includes(b))];
  return (
    <Card title={t("settings.design.title")}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(false);
          void save.run().catch(() => {});
        }}
      >
        <p className="text-sm text-muted">{t("settings.design.intro")}</p>
        <fieldset className="space-y-2" disabled={locked}>
          <legend className="label">{t("settings.design.theme")}</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {STORE_THEMES.map((k) => (
              <label key={k} className="cursor-pointer">
                <input
                  type="radio"
                  name="theme"
                  className="peer sr-only"
                  checked={theme === k}
                  onChange={() => {
                    setSaved(false);
                    setTheme(k);
                  }}
                />
                <span
                  className={`${themeClass(k)} block rounded-lg border-2 border-line bg-bg p-3 text-sm peer-checked:border-accent`}
                  data-testid={`theme-${k}`}
                >
                  <span className="block font-medium text-fg">
                    {t(`settings.design.theme.${k}`)}
                  </span>
                  <span className="mt-2 flex gap-1">
                    <span className="h-5 w-8 rounded bg-surface-2" />
                    <span className="h-5 w-8 rounded bg-accent" />
                    <span className="h-5 w-8 rounded border border-line bg-surface" />
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={cover}
            disabled={locked}
            onChange={(e) => {
              setSaved(false);
              setCover(e.currentTarget.checked);
            }}
          />
          <span>
            {t("settings.design.cover")}
            <span className="block text-xs text-muted">{t("settings.design.coverHint")}</span>
          </span>
        </label>
        <div>
          <div className="label">{t("settings.design.blocks")}</div>
          <p className="mb-2 text-xs text-muted">{t("settings.design.blocksHint")}</p>
          <ul className="space-y-1">
            {rows.map((b) => {
              const on = blocks.includes(b);
              return (
                <li key={b} className="flex items-center gap-2 text-sm">
                  <label className="flex flex-1 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={locked}
                      onChange={() => toggle(b)}
                    />
                    {t(`settings.design.block.${b}`)}
                  </label>
                  {on && (
                    <>
                      <button
                        type="button"
                        className="btn-ghost px-2 py-0.5"
                        disabled={locked || blocks.indexOf(b) === 0}
                        aria-label={t("settings.design.up", {
                          name: t(`settings.design.block.${b}`),
                        })}
                        onClick={() => move(b, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn-ghost px-2 py-0.5"
                        disabled={locked || blocks.indexOf(b) === blocks.length - 1}
                        aria-label={t("settings.design.down", {
                          name: t(`settings.design.block.${b}`),
                        })}
                        onClick={() => move(b, 1)}
                      >
                        ↓
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
        <div className="flex items-center gap-3">
          {owner ? (
            <button className="btn-primary" disabled={save.busy || !ready}>
              {t("common.save")}
            </button>
          ) : (
            <span className="text-xs text-muted">{t("settings.design.ownerOnly")}</span>
          )}
          {saved && <span className="text-sm text-ok">{t("settings.saved")}</span>}
        </div>
        <ErrorBox error={save.error} />
      </form>
    </Card>
  );
}
