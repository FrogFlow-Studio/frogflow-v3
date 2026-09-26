import { createHash } from "node:crypto";
import { useSession } from "@tanstack/react-start/server";
import { env } from "@/config/env";
import type { AdminRole } from "@/core/auth/roles";

/**
 * Одна cookie на всю платформу. Оператор и продавец — разные роли в ней:
 * оператор входит по учётке платформы, продавец — по логину своего
 * магазина (bots.settings.admin), и в сессии лежит его bot_id.
 */
export type AppSession = {
  operator?: boolean;
  /** Отпечаток учётки оператора на момент входа — см. credentialStamp. */
  operatorStamp?: string;
  /**
   * role в cookie — только подсказка интерфейсу: права каждый раз берутся из
   * bots.settings.admin (guards.server). stamp — отпечаток хеша пароля.
   */
  admin?: { botId: string; username: string; role?: AdminRole; stamp?: string };
};

/**
 * Отпечаток учётных данных для cookie. Сменился пароль или логин — отпечаток
 * другой, и все сессии, выданные раньше, перестают действовать. В cookie
 * лежит не хеш пароля, а 16 байт sha256 от него.
 */
export function credentialStamp(...parts: Array<string | undefined>): string {
  return createHash("sha256")
    .update(`ff-session-stamp\0${parts.map((p) => p ?? "").join("\0")}`)
    .digest("hex")
    .slice(0, 32);
}

export function sessionConfig() {
  return {
    password: env().SESSION_SECRET,
    name: "ff-session",
    maxAge: 60 * 60 * 24 * 14,
    cookie: { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/" },
  };
}

export function appSession() {
  return useSession<AppSession>(sessionConfig());
}
