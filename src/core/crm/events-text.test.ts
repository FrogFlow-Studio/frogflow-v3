import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { adminT } from "@/app/i18n/admin";
import { ru } from "@/app/i18n/admin/settings";
import { SUPPORTED_LOCALES } from "@/core/i18n/locale";
import { CRM_EVENTS } from "./webhook";

describe("описание событий вебхука совпадает с CRM_EVENTS", () => {
  it("у каждого события есть подпись на всех четырёх языках", () => {
    for (const l of SUPPORTED_LOCALES)
      for (const ev of CRM_EVENTS) {
        const key = `settings.crm.event.${ev}` as never;
        expect(adminT(l)(key), `${l}:${ev}`).not.toBe(key);
      }
  });

  it("в словаре нет подписей к несуществующим событиям", () => {
    const labelled = Object.keys(ru)
      .filter((k) => k.startsWith("settings.crm.event."))
      .map((k) => k.slice("settings.crm.event.".length))
      .sort();
    expect(labelled).toEqual([...CRM_EVENTS].sort());
  });

  it("документация перечисляет все события и проверочный ping", () => {
    const doc = readFileSync("docs/PUBLIC-API.md", "utf8");
    for (const ev of CRM_EVENTS) expect(doc, ev).toContain(`\`order.${ev}\``);
    expect(doc).toContain("`ping`");
  });

  it("настройки принимают только известные события", async () => {
    const { parseCrm } = await import("./webhook");
    const cfg = parseCrm(
      JSON.stringify({ url: "https://x.kz/h", events: [...CRM_EVENTS, "order.hack", "ping"] }),
    );
    expect(cfg?.events).toEqual([...CRM_EVENTS]);
  });
});
