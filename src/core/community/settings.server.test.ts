import { beforeEach, describe, expect, it, vi } from "vitest";

const patched: Array<[string, Record<string, unknown>]> = [];
vi.mock("@/core/tenant/resolve.server", () => ({
  patchTenantSettings: async (id: string, p: Record<string, unknown>) => void patched.push([id, p]),
}));

const { saveCommunityProfile, setCommunityMod, communityView } = await import("./settings.server");

const ctx = (settings: Record<string, unknown>) => ({ tenant: { id: "b1", settings } }) as never;

beforeEach(() => {
  patched.length = 0;
});

describe("сообщество: сохранение профиля и решение оператора", () => {
  it("пишет только ключ community через patchTenantSettings (рев растит он)", async () => {
    const v = await saveCommunityProfile(ctx({ served_by: "v2" }), {
      enabled: true,
      name: "Ани",
      links: ["https://a.kz"],
    });
    expect(patched).toEqual([
      [
        "b1",
        {
          community: {
            enabled: true,
            name: "Ани",
            niche: "",
            city: "",
            about: "",
            links: ["https://a.kz"],
          },
        },
      ],
    ]);
    expect(v.state).toBe("visible");
  });

  it("включить без названия нельзя, ничего не пишется", async () => {
    await expect(
      saveCommunityProfile(ctx({ served_by: "v2" }), { enabled: true, name: "  " }),
    ).rejects.toThrow("укажите название");
    expect(patched).toEqual([]);
  });

  it("клиент прежней платформы профиль не сохраняет", async () => {
    await expect(saveCommunityProfile(ctx({}), { enabled: false, name: "A" })).rejects.toThrow(
      "новой платформе",
    );
    expect(patched).toEqual([]);
  });

  it("профиль не затирает решение оператора: это другой ключ", async () => {
    const c = ctx({ served_by: "v2", community_mod: { status: "blocked", reason: "спам" } });
    const v = await saveCommunityProfile(c, { enabled: true, name: "Ани" });
    expect(Object.keys(patched[0]![1])).toEqual(["community"]);
    expect(v.state).toBe("blocked");
    expect(communityView(c).mod?.reason).toBe("спам");
  });

  it("оператор: ставит и снимает решение, причина обрезается", async () => {
    await setCommunityMod("b1", "hidden", `  ${"я".repeat(500)} `);
    await setCommunityMod("b1", null, "");
    const first = patched[0]![1].community_mod as { status: string; reason: string; at: string };
    expect(first.status).toBe("hidden");
    expect(first.reason).toHaveLength(300);
    expect(first.at).toMatch(/^\d{4}-/);
    expect(patched[1]).toEqual(["b1", { community_mod: null }]);
  });
});
