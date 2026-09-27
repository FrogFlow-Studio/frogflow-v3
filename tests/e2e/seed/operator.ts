/** Оператор платформы: вход и реквизиты для оплаты подписки. */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, hash } from "./util.ts";

export function seedOperator(db: StubDb) {
  add(db, "operator_settings", [
    { key: "operator_username", value: F.OPERATOR_LOGIN },
    { key: "operator_password_hash", value: hash(F.OPERATOR_PASSWORD) },
    { key: "payout_requisites", value: "Kaspi Gold 4400 0000 0000 0000, E2E" },
  ]);
}
