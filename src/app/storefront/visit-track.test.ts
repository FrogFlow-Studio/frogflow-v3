import { describe, expect, it } from "vitest";
import { sendVisit, trackProductView, trackVisit, type VisitSend } from "./visit-track";

function memory(): Pick<Storage, "getItem" | "setItem"> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

describe("визиты витрины в браузере (У1)", () => {
  it("визит — раз за сессию, с меткой из ссылки и реферером", () => {
    const st = memory();
    const sent: Parameters<VisitSend>[0][] = [];
    const send: VisitSend = (p) => sent.push(p);
    trackVisit("shop", "?utm_source=vesna", "https://www.google.com/", st, send);
    trackVisit("shop", "?utm_source=vesna", "https://www.google.com/", st, send);
    expect(sent).toEqual([
      { stage: "visit", source: "site:vesna", referrer: "https://www.google.com/" },
    ]);
  });

  it("просмотр товара — раз за сессию и с тем же источником, что у визита", () => {
    const st = memory();
    const sent: Parameters<VisitSend>[0][] = [];
    const send: VisitSend = (p) => sent.push(p);
    trackVisit("shop", "?utm_source=vesna", "", st, send);
    trackProductView("shop", st, send);
    trackProductView("shop", st, send);
    expect(sent.map((s) => [s.stage, s.source])).toEqual([
      ["visit", "site:vesna"],
      ["product", "site:vesna"],
    ]);
  });

  it("сессии разных магазинов не мешают друг другу", () => {
    const st = memory();
    const sent: Parameters<VisitSend>[0][] = [];
    trackVisit("a", "", "", st, (p) => sent.push(p));
    trackVisit("b", "", "", st, (p) => sent.push(p));
    expect(sent).toHaveLength(2);
  });

  it("хранилище закрыто — ничего не отправляется и не падает", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    const sent: unknown[] = [];
    expect(() => trackVisit("shop", "", "", broken, (p) => sent.push(p))).not.toThrow();
    expect(() => trackProductView("shop", broken, (p) => sent.push(p))).not.toThrow();
    expect(sent).toEqual([]);
  });

  it("в сессию пишутся только метка и реферер: ни адреса страницы, ни идентификатора", () => {
    const st = memory();
    trackVisit("shop", "?utm_source=vesna&email=a@b.c", "", st, () => {});
    expect(JSON.parse(st.data.get("ff-visit:shop")!)).toEqual({
      source: "site:vesna",
      referrer: null,
    });
    expect(typeof sendVisit("shop")).toBe("function");
  });
});
