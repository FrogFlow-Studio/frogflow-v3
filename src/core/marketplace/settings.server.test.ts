import { describe, expect, it } from "vitest";
import { marketplaceView } from "./settings.server";
import { settingsFromJson } from "@/core/tenant/directory";
import type { Tenant } from "@/core/tenant/types";

const tenant = (raw: Record<string, unknown>) =>
  ({ vertical: "shop", settings: settingsFromJson(raw) }) as unknown as Tenant;

describe("вид площадки в настройках", () => {
  it("по умолчанию выключено, подписи пустые", () => {
    const v = marketplaceView({ tenant: tenant({ served_by: "v2" }) });
    expect(v).toMatchObject({ state: "off", listed: false, hidden: false, category: "", city: "" });
  });
  it("согласие без одобрения — «ждёт», оператор скрыл — «скрыт» с причиной", () => {
    expect(
      marketplaceView({ tenant: tenant({ served_by: "v2", marketplace: { listed: true } }) }).state,
    ).toBe("pending");
    const hidden = marketplaceView({
      tenant: tenant({
        served_by: "v2",
        marketplace: { listed: true, approved: true, hidden: true, hidden_reason: "жалоба" },
      }),
    });
    expect(hidden).toMatchObject({ state: "hidden", hiddenReason: "жалоба" });
  });
});
