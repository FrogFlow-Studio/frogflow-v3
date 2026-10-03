/** Фильтры витрины (shop4-filters.spec.ts): у демо-магазина включён модуль «Склад». */
import type { StubDb } from "../pg-stub.ts";
import { shopBot } from "./util.ts";

export function seedShop4Filters(db: StubDb) {
  const bot = shopBot(db);
  bot.modules = { ...(bot.modules as object), stock: true };
}
