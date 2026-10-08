import type { getClientFn } from "@/app/operator/clients.functions";

/** Данные карточки клиента у оператора (getClientFn), общие для её разделов. */
export type C = Awaited<ReturnType<typeof getClientFn>>["client"];
export type W = Awaited<ReturnType<typeof getClientFn>>["webhook"];
export type M = Awaited<ReturnType<typeof getClientFn>>["migration"];
