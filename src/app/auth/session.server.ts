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
  /** role нет у сессий, выданных до появления ролей — это владелец. */
  admin?: { botId: string; username: string; role?: AdminRole };
};

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
