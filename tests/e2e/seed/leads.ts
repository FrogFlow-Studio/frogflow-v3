/** Воронка лидов оператора: два лида на разных стадиях. */
import type { StubDb } from "../pg-stub.ts";
import { add } from "./util.ts";

export const LEAD_COFFEE = "E2E Кофейня Север";
export const LEAD_BAKERY = "E2E Пекарня Юг";

export function seedLeads(db: StubDb, now: string) {
  add(db, "sales_leads", [
    {
      id: "5a1d0000-0000-4000-8000-000000000001",
      business_name: LEAD_COFFEE,
      city: "Астана",
      instagram_handle: "e2e.sever",
      stage: "new",
      source: "manual",
      created_at: now,
      updated_at: now,
    },
    {
      id: "5a1d0000-0000-4000-8000-000000000002",
      business_name: LEAD_BAKERY,
      city: "Алматы",
      phone: "77051112233",
      stage: "replied",
      source: "pipeline",
      score: 77,
      created_at: now,
      updated_at: now,
    },
  ]);
}
