import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import { setEnvForTests } from "@/config/env";
import { PREVIEW_AI_OFF } from "@/lib/preview";

const db = fakeDb();
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));
const create = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create };
  },
}));

afterEach(() => {
  setEnvForTests(undefined);
  create.mockReset();
});

describe("лиды в предпросмотре: ИИ не вызывается, причина понятна", () => {
  it("оценка, черновик и автопоиск отвечают PREVIEW_AI_OFF и не доходят до модели", async () => {
    setEnvForTests({ PREVIEW_READONLY: "1", ANTHROPIC_API_KEY: "k" });
    db.tables.sales_leads = [{ id: "7b0c1c2e-0000-4000-8000-000000000001", business_name: "А" }];
    const srv = await import("./leads.server");
    const hunt = await import("./hunt.server");
    await expect(srv.scoreLead("7b0c1c2e-0000-4000-8000-000000000001", "a")).rejects.toThrow(
      PREVIEW_AI_OFF,
    );
    await expect(srv.draftLead("7b0c1c2e-0000-4000-8000-000000000001", "a")).rejects.toThrow(
      PREVIEW_AI_OFF,
    );
    await expect(hunt.huntLeads({ niche: "кофейни", city: "" }, "a")).rejects.toThrow(
      PREVIEW_AI_OFF,
    );
    expect(create).not.toHaveBeenCalled();
  });
});
