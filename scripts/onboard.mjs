#!/usr/bin/env node
/**
 * Подключить клиента к v2 — одной командой вместо проекта Vercel.
 *
 *   APP_URL=https://www.frogflow.tech OPERATOR_USERNAME=… OPERATOR_PASSWORD=… \
 *   node scripts/onboard.mjs --bot-id <uuid> --token <telegram-token> --serve v2
 *
 * Новый клиент:  --name "Магазин" --owner slug --vertical digital --token … --serve v2
 * Откат на v1:   --bot-id <uuid> --serve v1   (затем снять паузу с проекта Vercel клиента в v1)
 *
 * Перевод на v2 идёт через предполётную проверку: при блокирующих пунктах
 * ответ 409 со списком, клиент остаётся на v1. --force — перевести всё равно.
 */
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const list = (name) =>
  opt(name)
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const { APP_URL, OPERATOR_USERNAME, OPERATOR_PASSWORD } = process.env;
if (!APP_URL || !OPERATOR_USERNAME || !OPERATOR_PASSWORD) {
  console.error("Нужны APP_URL, OPERATOR_USERNAME, OPERATOR_PASSWORD в окружении");
  process.exit(1);
}

const body = {
  bot_id: opt("--bot-id"),
  bot_name: opt("--name"),
  owner_id: opt("--owner"),
  vertical: opt("--vertical"),
  telegram_token: opt("--token"),
  slug: opt("--slug"),
  hosts: list("--hosts"),
  zernio_account_ids: list("--zernio"),
  served_by: opt("--serve"),
  force: args.includes("--force") ? true : undefined,
};
for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];

const res = await fetch(`${APP_URL.replace(/\/$/, "")}/api/operator/bots`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization:
      "Basic " + Buffer.from(`${OPERATOR_USERNAME}:${OPERATOR_PASSWORD}`).toString("base64"),
  },
  body: JSON.stringify(body),
});
const text = await res.text();
console.log(res.status, text);
process.exit(res.ok ? 0 : 1);
