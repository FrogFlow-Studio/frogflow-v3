import { describe, expect, it } from "vitest";
import { tenantFromRow, type TenantRow } from "./directory";
import {
  diffZernioSnapshots,
  foreignZernioAccounts,
  zernioAccountOwners,
  zernioProfileOwner,
  zernioReconnects,
  zernioTwins,
} from "./zernio-accounts";

const row = (id: string, ids: string[], archived = false): TenantRow => ({
  id,
  bot_name: id,
  status: "active",
  vertical: "digital",
  modules: {},
  settings: { zernio: { account_ids: ids } },
  paused_message: null,
  owner_telegram_id: null,
  app_url: null,
  archived_at: archived ? "2026-01-01T00:00:00Z" : null,
  bot_token: null,
});

const a = tenantFromRow(row("a", ["ig-a", "wa-a"]));
const b = tenantFromRow(row("b", ["ig-b", "wa-a"]));
const gone = tenantFromRow(row("gone", ["ig-a"], true));

describe("владение аккаунтами Zernio на одном ключе", () => {
  it("находит владельцев без учёта регистра и без архивных клиентов", () => {
    expect(zernioAccountOwners([a, b, gone], "IG-A").map((t) => t.id)).toEqual(["a"]);
    expect(zernioAccountOwners([a, b], "wa-a").map((t) => t.id)).toEqual(["a", "b"]);
    expect(zernioAccountOwners([a, b], "  ")).toEqual([]);
  });

  it("чужие аккаунты в списке клиента — по одному на id, свои не считаются", () => {
    const f = foreignZernioAccounts([a, b], "b", ["wa-a", "ig-b", "new"]);
    expect(f.map((x) => [x.id, x.owner.id])).toEqual([["wa-a", "a"]]);
  });

  it("разница снимков: новые, пропавшие, отключившиеся и вернувшиеся", () => {
    const d = diffZernioSnapshots(
      [
        { id: "1", platform: "instagram" },
        { id: "2", platform: "whatsapp", expired: true },
        { id: "3", platform: "instagram" },
      ],
      [
        { id: "1", platform: "instagram", expired: true },
        { id: "2", platform: "whatsapp" },
        { id: "4", platform: "whatsapp" },
      ],
    );
    expect(d.expired.map((x) => x.id)).toEqual(["1"]);
    expect(d.restored.map((x) => x.id)).toEqual(["2"]);
    expect(d.added.map((x) => x.id)).toEqual(["4"]);
    expect(d.removed.map((x) => x.id)).toEqual(["3"]);
  });
});

describe("профиль Zernio у одного клиента", () => {
  const withProfile = (id: string, profile: string, archived = false) =>
    tenantFromRow({
      ...row(id, [], archived),
      settings: { zernio: { profile_id: profile, account_ids: [] } },
    });

  it("профиль v1 уже записан другому клиенту — владелец найден, себя и архив не считаем", () => {
    const x = withProfile("x", "p1");
    const old = withProfile("old", "p2", true);
    expect(zernioProfileOwner([x, old], "y", " p1 ")?.id).toBe("x");
    expect(zernioProfileOwner([x, old], "x", "p1")).toBeUndefined();
    expect(zernioProfileOwner([x, old], "y", "p2")).toBeUndefined();
    expect(zernioProfileOwner([x], "y", "  ")).toBeUndefined();
  });
});

describe("переподключение аккаунта: новый id той же страницы", () => {
  const ig = (id: string, username?: string, expired = false) => ({
    id,
    platform: "instagram",
    username,
    expired,
  });

  it("BOVI 07.10: тот же @username с новым id — переподключение, прежний пропал", () => {
    expect(zernioReconnects([ig("6aa5", "bovi.kz")], [ig("6ac6", "Bovi.KZ")])).toEqual([
      {
        platform: "instagram",
        username: "Bovi.KZ",
        name: undefined,
        oldId: "6aa5",
        newId: "6ac6",
        oldStillLive: false,
      },
    ]);
  });

  it("прежний ещё живой — помечается; отвязанный прежний живым не считается", () => {
    expect(
      zernioReconnects([ig("old", "shop")], [ig("old", "shop"), ig("new", "shop")])[0]
        ?.oldStillLive,
    ).toBe(true);
    expect(
      zernioReconnects([ig("old", "shop")], [ig("old", "shop", true), ig("new", "shop")])[0]
        ?.oldStillLive,
    ).toBe(false);
  });

  it("без имени — только замена единственного аккаунта канала", () => {
    expect(zernioReconnects([ig("old")], [ig("new", "shop")]).map((r) => r.oldId)).toEqual(["old"]);
    // Прежний на месте — это второй аккаунт, а не переподключение.
    expect(zernioReconnects([ig("old")], [ig("old"), ig("new")])).toEqual([]);
  });

  it("другая страница, другой канал, первый аккаунт и ничего нового — не переподключение", () => {
    expect(zernioReconnects([ig("old", "shop")], [ig("new", "other")])).toEqual([]);
    expect(
      zernioReconnects(
        [ig("old", "shop")],
        [ig("old", "shop"), { id: "wa", platform: "whatsapp" }],
      ),
    ).toEqual([]);
    expect(zernioReconnects([], [ig("new", "shop")])).toEqual([]);
    expect(zernioReconnects([ig("a", "shop")], [ig("a", "shop")])).toEqual([]);
  });

  it("два живых подключения одной страницы — пара; отвязанное и без имени не считаются", () => {
    expect(zernioTwins([ig("a", "Shop"), ig("b", "shop"), ig("c", "other")])).toEqual([
      { platform: "instagram", username: "Shop", ids: ["a", "b"] },
    ]);
    expect(zernioTwins([ig("a", "shop", true), ig("b", "shop")])).toEqual([]);
    expect(zernioTwins([ig("a"), ig("b")])).toEqual([]);
  });
});
