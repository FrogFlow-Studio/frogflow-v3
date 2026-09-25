import { describe, expect, it } from "vitest";
import { tenantFromRow, type TenantRow } from "./directory";
import { diffZernioSnapshots, foreignZernioAccounts, zernioAccountOwners } from "./zernio-accounts";

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
