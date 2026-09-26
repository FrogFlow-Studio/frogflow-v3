import { createHash } from "node:crypto";
import { useSession } from "@tanstack/react-start/server";
import { env } from "@/config/env";
import type { AdminRole } from "@/core/auth/roles";
import { SESSION_MAX_AGE_S } from "./session-id";

/**
 * Одна cookie на всю платформу. Оператор и продавец — разные роли в ней:
 * оператор входит по учётке платформы, продавец — по логину своего
 * магазина (bots.settings.admin), и в сессии лежит его bot_id.
 */
export type AppSession = {
  operator?: boolean;
  /** Отпечаток учётки оператора на момент входа — см. credentialStamp. */
  operatorStamp?: string;
  /** Номер и время входа оператора — для отзыва при выходе (session-id.ts). */
  operatorSid?: string;
  operatorIat?: number;
  /**
   * role в cookie — только подсказка интерфейсу: права каждый раз берутся из
   * bots.settings.admin (guards.server). stamp — отпечаток хеша пароля.
   */
  admin?: {
    botId: string;
    username: string;
    role?: AdminRole;
    stamp?: string;
    /** Номер и время входа — для отзыва при выходе (session-id.ts). */
    sid?: string;
    iat?: number;
  };
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
    maxAge: SESSION_MAX_AGE_S,
    cookie: { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/" },
  };
}

export function appSession() {
  return useSession<AppSession>(sessionConfig());
}
