import { describe, expect, it } from "vitest";
import {
  authorCard,
  cleanLinks,
  cleanProfile,
  communityState,
  shownInCommunity,
  takesPartInCommunity,
} from "./profile";
import type { TenantSettings } from "@/core/tenant/types";

const t = (settings: TenantSettings) => ({ settings });
const on = { enabled: true, name: "Мастерская Ани" };

describe("сообщество: профиль и согласие", () => {
  it("по умолчанию выключено: не виден, ничего не читает и не пишет", () => {
    const s = t({ served_by: "v2" });
    expect(communityState(s)).toBe("off");
    expect(shownInCommunity(s)).toBe(false);
    expect(takesPartInCommunity(s)).toBe(false);
    expect(authorCard(s)).toBeNull();
  });

  it("включено без названия остаётся выключенным", () => {
    expect(communityState(t({ served_by: "v2", community: { enabled: true } }))).toBe("off");
  });

  it("включённый автор на v2 виден; карточка без лишних полей", () => {
    const s = t({ served_by: "v2", community: { ...on, city: " Алматы ", niche: "Открытки" } });
    expect(communityState(s)).toBe("visible");
    expect(authorCard(s)).toEqual({
      name: "Мастерская Ани",
      niche: "Открытки",
      city: "Алматы",
      about: "",
      links: [],
    });
  });

  it("магазин клиента прежней платформы в сообществе не участвует", () => {
    expect(communityState(t({ community: on }))).toBe("off");
    expect(communityState(t({ served_by: "v1", community: on }))).toBe("off");
  });

  it("оператор скрыл: автора не видно, но он ещё читает и пишет", () => {
    const s = t({ served_by: "v2", community: on, community_mod: { status: "hidden" } });
    expect(communityState(s)).toBe("hidden");
    expect(shownInCommunity(s)).toBe(false);
    expect(authorCard(s)).toBeNull();
    expect(takesPartInCommunity(s)).toBe(true);
  });

  it("оператор заблокировал: не виден нигде, не читает и не пишет", () => {
    const s = t({ served_by: "v2", community: on, community_mod: { status: "blocked" } });
    expect(communityState(s)).toBe("blocked");
    expect(shownInCommunity(s)).toBe(false);
    expect(takesPartInCommunity(s)).toBe(false);
    expect(authorCard(s)).toBeNull();
  });

  it("блок действует и когда автор выключил профиль, и пустое решение его снимает", () => {
    expect(communityState(t({ served_by: "v2", community_mod: { status: "blocked" } }))).toBe(
      "blocked",
    );
    expect(
      communityState(
        t({ served_by: "v2", community: on, community_mod: null as unknown as undefined }),
      ),
    ).toBe("visible");
  });

  it("чистка: обрезает, схлопывает пробелы, ссылки только http(s) и без повторов", () => {
    const p = cleanProfile({
      enabled: "yes",
      name: "  A   B ",
      about: "x".repeat(900),
      links: ["javascript:alert(1)", "https://a.kz", "https://a.kz", "ftp://x", "http://b.kz/p"],
    });
    expect(p.enabled).toBe(false);
    expect(p.name).toBe("A B");
    expect(p.about).toHaveLength(600);
    expect(p.links).toEqual(["https://a.kz", "http://b.kz/p"]);
    expect(cleanLinks(Array.from({ length: 9 }, (_, i) => `https://s${i}.kz`))).toHaveLength(5);
    expect(cleanLinks("не массив")).toEqual([]);
  });
});
